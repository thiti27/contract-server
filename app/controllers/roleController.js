import { select, exec, insert } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Settings > Role Management (/settings/role) — who's allowed to do what in this
// app, keyed by em_id. admin_users is looked up at login time (see authController's
// getPermissions) to decide a session's view/admin/legal flags; this is where an
// Admin user manages that table directly.
//
// Unlike contractTypeController's admin CRUD (which hardcodes created_by/updated_by
// as the literal string 'app'), this follows the same real-identity convention
// approvalController/legalController/signedContractController already use elsewhere:
// the frontend sends the acting user's own display name (`updatedName`, sourced from
// AuthContext — see RoleTab.jsx) and that's what actually lands in created_by/
// updated_by/deleted_by, not an em_id. That's also why this migration widened those
// three columns from the schema's original VARCHAR(6) (an em_id-sized default copied
// from every other table) — a real "Firstname Lastname" doesn't fit in 6 characters,
// see migrateAdminUsersAuditColumns in config/mysql.js.
// ---------------------------------------------------------------------------

export async function listRoles(req, res) {
  const { search = '', status = '' } = req.query;

  const clauses = ['deleted_at IS NULL'];
  const replacements = {};

  if (search) {
    clauses.push('(em_id LIKE :search OR first_name LIKE :search OR last_name LIKE :search)');
    replacements.search = `%${search}%`;
  }
  if (status === 'active') {
    clauses.push('active = 1');
  } else if (status === 'inactive') {
    clauses.push('active = 0');
  }

  const rows = await select(
    `SELECT id, em_id AS emId, first_name AS firstName, last_name AS lastName,
            view, admin, legal, active, updated_at AS updatedAt, updated_by AS updatedBy
     FROM admin_users
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC`,
    replacements
  );

  res.json(
    rows.map(r => ({
      ...r,
      view: !!r.view,
      admin: !!r.admin,
      legal: !!r.legal,
      active: !!r.active,
    }))
  );
}

export async function createRole(req, res) {
  const { emId = '', firstName = '', lastName = '', view = false, admin = false, legal = false, updatedName } = req.body || {};

  if (!emId.trim()) return res.status(400).json({ message: 'Employee is required.' });
  if (!firstName.trim() || !lastName.trim()) return res.status(400).json({ message: 'Employee name is required.' });

  const existing = await select(`SELECT id FROM admin_users WHERE em_id = :emId AND deleted_at IS NULL`, { emId });
  if (existing.length) {
    return res.status(400).json({ message: 'This employee already has a role assigned.' });
  }

  const id = await insert(
    `INSERT INTO admin_users (em_id, first_name, last_name, view, admin, legal, created_by)
     VALUES (:emId, :firstName, :lastName, :view, :admin, :legal, :createdBy)`,
    {
      emId,
      firstName,
      lastName,
      view: view ? 1 : 0,
      admin: admin ? 1 : 0,
      legal: legal ? 1 : 0,
      createdBy: updatedName || null,
    }
  );
  res.status(201).json({ id });
}

// Employee identity (em_id/first_name/last_name) is intentionally never accepted
// here — only permission flags and active can change once a role exists.
export async function updateRole(req, res) {
  const existing = await select(`SELECT id FROM admin_users WHERE id = :id AND deleted_at IS NULL`, { id: req.params.id });
  if (!existing.length) return res.status(404).json({ message: 'Role not found.' });

  const { view, admin, legal, active, updatedName } = req.body || {};
  const sets = ['updated_at = NOW()', 'updated_by = :updatedBy'];
  const replacements = { id: req.params.id, updatedBy: updatedName || null };

  if (view !== undefined) { sets.push('view = :view'); replacements.view = view ? 1 : 0; }
  if (admin !== undefined) { sets.push('admin = :admin'); replacements.admin = admin ? 1 : 0; }
  if (legal !== undefined) { sets.push('legal = :legal'); replacements.legal = legal ? 1 : 0; }
  if (active !== undefined) { sets.push('active = :active'); replacements.active = active ? 1 : 0; }

  await exec(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = :id`, replacements);
  res.json({ success: true });
}

export async function deleteRole(req, res) {
  const existing = await select(`SELECT id FROM admin_users WHERE id = :id AND deleted_at IS NULL`, { id: req.params.id });
  if (!existing.length) return res.status(404).json({ message: 'Role not found.' });

  const { updatedName } = req.body || {};
  await exec(
    `UPDATE admin_users SET deleted_at = NOW(), deleted_by = :deletedBy, active = 0 WHERE id = :id`,
    { id: req.params.id, deletedBy: updatedName || null }
  );
  res.json({ success: true });
}
