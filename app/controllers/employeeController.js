import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Employees (approver / signature pickers) — sourced from eds_db.employee (the
// company-wide HR master), not contract_db.employees. Same cross-database query
// pattern already used by authController's employee login lookup: one Sequelize
// connection, schema-qualified table names, no second connection (see
// authController.js's "why not a new connection" note).
//
// eds_db.employee has no direct `department` column, and no active/deleted_at flags
// like contract_db.employees did:
//   - `department` is resolved via employee.sec_id -> eds_db.section -> its
//     dept_chart_id -> eds_db.dept_org_chart.name (the actual "department" concept
//     in eds_db — distinct from `section`, which authController's login response
//     maps to eds_db.section.name instead).
//   - the `active = 1 AND deleted_at IS NULL` filter is replaced with
//     `status_id = 1`, eds_db's own "Active" employment status (id 1, confirmed
//     against eds_db.status — the other ids are Resignation/Termination/Cancel/
//     Dismissal/Retirement/Death) — preserves the original "only show employees
//     who can currently be picked as an approver" behavior.
//
// Response shape (id/emId/firstName/lastName/department) and the /api/employees
// path are both unchanged — only the query params are new (`search`), so this still
// doubles as a plain "give me some employees" call for anything that doesn't pass one.
//
// Server-side search + a hard LIMIT 10 (added for the Approver AsyncSelect — see
// ApprovalSection.jsx): with eds_db.employee holding tens of thousands of rows,
// returning everything up front is exactly what this was changed to stop doing.
// `search` matches em_id, first name, or last name (LIKE, same 3 fields the request
// specified) and is optional — omitted, this just returns the first 10 active
// employees by first name, so the dropdown still shows something on first open.
export async function listEmployees(req, res) {
  const { search = '' } = req.query;

  const clauses = ['e.status_id = 1'];
  const replacements = {};

if (search) {
  clauses.push(`
    (
      e.firstname_en LIKE :search
      OR e.lastname_en LIKE :search
      OR e.em_id LIKE :search
    )
    AND (
      e.resignation_date IS NULL
      OR e.resignation_date >= CURRENT_DATE
    )
  `);

  replacements.search = `%${search}%`;
}

  const rows = await select(
    `SELECT e.id, e.em_id AS emId, e.firstname_en AS firstName, e.lastname_en AS lastName, d.name AS department
     FROM eds_db.employee e
     LEFT JOIN eds_db.section s ON s.id = e.sec_id
     LEFT JOIN eds_db.dept_org_chart d ON d.id = s.dept_chart_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY e.em_id
     LIMIT 3`,
    replacements
  );
  res.json(rows);
}
