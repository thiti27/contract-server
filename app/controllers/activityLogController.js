import { select } from '../../config/mysql.js';

// Settings > Activity Log — read side of the activity_logs audit trail (writes all go
// through app/utils/activityLog.js from wherever the action actually happens). Admin-
// only (see role.routes.js's own requireAdmin convention), same pagination shape as
// contractController.listContracts.
export async function listActivityLogs(req, res) {
  const { page = '1', pageSize = '20', action = '', emId = '', dateFrom = '', dateTo = '', search = '' } = req.query;

  const clauses = ['1 = 1'];
  const replacements = {};

  if (action) {
    clauses.push('action = :action');
    replacements.action = action;
  }
  if (emId) {
    clauses.push('em_id = :emId');
    replacements.emId = emId;
  }
  if (dateFrom) {
    clauses.push('created_at >= :dateFrom');
    replacements.dateFrom = dateFrom;
  }
  if (dateTo) {
    // dateTo comes in as a plain date (e.g. "2026-10-01") from the frontend's date
    // picker — treat it as end-of-day so that day's own rows aren't excluded.
    clauses.push('created_at <= :dateTo');
    replacements.dateTo = `${dateTo} 23:59:59`;
  }
  if (search) {
    clauses.push('(user_name LIKE :search OR em_id LIKE :search OR detail LIKE :search)');
    replacements.search = `%${search}%`;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 20));
  const offset = (pageNum - 1) * size;
  const where = clauses.join(' AND ');

  const [totalRows, items] = await Promise.all([
    select(`SELECT COUNT(*) AS count FROM activity_logs WHERE ${where}`, replacements),
    select(
      `SELECT id, em_id AS emId, user_name AS userName, action, entity_type AS entityType,
              entity_id AS entityId, detail, ip_address AS ipAddress, created_at AS createdAt
       FROM activity_logs
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ${size} OFFSET ${offset}`,
      replacements
    ),
  ]);

  res.json({ items, total: Number(totalRows[0].count), page: pageNum, pageSize: size });
}

// Distinct action values actually present — feeds the Settings > Activity Log filter
// dropdown so it only ever offers choices with real rows, without hardcoding the
// list of action names in two places (every logActivity() call site, and here).
export async function listActivityLogActions(_req, res) {
  const rows = await select(`SELECT DISTINCT action FROM activity_logs ORDER BY action ASC`);
  res.json(rows.map(r => r.action));
}
