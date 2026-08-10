import bcrypt from 'bcrypt';
import { select } from '../../config/mysql.js';
import { sign } from '../../config/jwt.js';

// Step 1 of login: company employees, kept in eds_db (a separate database on the same
// MySQL server/connection — see the "why not a new connection" note in the refactor
// summary). Looked up by em_id, since employees log in with their em_id as username.
// Only the columns actually needed are selected (not `SELECT *`, per the Code Quality
// ask) — sec_id alone isn't a display-ready section name, so this also joins
// eds_db.section to resolve it, which the literal spec SQL didn't include but the
// required response shape (`section: "..."`) does. `id` is included for the JWT payload.
async function findEmployee(username) {
  const rows = await select(
    `SELECT e.id, e.em_id, e.firstname_en, e.lastname_en, e.password, s.name AS sectionName
     FROM eds_db.employee e
     LEFT JOIN eds_db.section s ON s.id = e.sec_id
     WHERE e.em_id = :username`,
    { username }
  );
  return rows[0] || null;
}

// Step 2 of login: existing app_users flow, byte-for-byte the same query and plain-text
// comparison the system already used before employee login existed.
async function findAppUser(username) {
  const rows = await select(
    'SELECT * FROM app_users WHERE username = :username AND active = 1 AND deleted_at IS NULL',
    { username }
  );
  return rows[0] || null;
}

// Permission lookup is identical regardless of which step authenticated the caller —
// unchanged from the original handler, including the exact default-on-no-match shape.
async function getPermissions(emId) {
  const rows = await select(
    'SELECT view, admin, legal FROM admin_users WHERE em_id = :em_id AND active = 1 AND deleted_at IS NULL',
    { em_id: emId }
  );
  return rows[0] || { view: 0, admin: 0, legal: 0 };
}

// Shared response shape for both login paths. `id` is the numeric primary key from
// whichever table authenticated the caller (eds_db.employee or app_users) — same
// field name in both, just a different source table. The JWT payload carries exactly
// what was specified (id, em_id, first_name, last_name, admin, legal, view); expiry
// comes from JWT_EXP via config/jwt.js's sign(), never set here.
function buildLoginResponse({ id, emId, firstName, lastName, section, permissions }) {
  const view = !!permissions.view;
  const admin = !!permissions.admin;
  const legal = !!permissions.legal;

  const token = sign({ id, em_id: emId, first_name: firstName, last_name: lastName, admin, legal, view });

  return {
    token,
    user: {
      name: `${firstName} ${lastName}`.trim(),
      first_name: firstName,
      last_name: lastName,
      view,
      admin,
      legal,
      section,
      em_id: emId,
    },
  };
}

export async function login(req, res) {
  const { username = '', password = '' } = req.body || {};

  try {
    // Step 1 — employee (eds_db.employee), bcrypt-hashed password. If an employee
    // record exists for this username, it owns the auth decision entirely: a wrong
    // password here returns 401 immediately and never falls through to Step 2.
    const employee = await findEmployee(username);
    if (employee) {
      const passwordMatches = employee.password ? await bcrypt.compare(password, employee.password) : false;
      if (!passwordMatches) {
        return res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง' });
      }

      const permissions = await getPermissions(employee.em_id);
      return res.json(
        buildLoginResponse({
          id: employee.id,
          emId: employee.em_id,
          firstName: employee.firstname_en,
          lastName: employee.lastname_en,
          section: employee.sectionName || null,
          permissions,
        })
      );
    }

    // Step 2 — no employee found, fall back to the original app_users flow, unchanged.
    const user = await findAppUser(username);
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง' });
    }

    // app_users only proves "can this person log in" — what they're allowed to do
    // comes from looking their em_id up in admin_users. No match (or inactive) just
    // means no special permissions, not a login failure.
    const permissions = await getPermissions(user.em_id);
    res.json(
      buildLoginResponse({
        id: user.id,
        emId: user.em_id,
        firstName: user.first_name,
        lastName: user.last_name,
        section: user.section,
        permissions,
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to process the request. Please try again.' });
  }
}
