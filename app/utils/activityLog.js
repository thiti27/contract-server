import { insert } from '../../config/mysql.js';

// Single write path for the activity_logs audit trail (see schema.sql) — every caller
// (login, request submission, approval/legal decisions, uploads, Settings changes)
// goes through this instead of its own INSERT, so there's exactly one place that
// decides the row shape. `req` supplies em_id/user_name/ip_address automatically from
// the authenticated session (req.user, set by the auth middleware) when the caller
// doesn't override them — login is the one case that must override both, since there
// is no req.user yet (and a failed login has no em_id to attach at all when the
// username didn't match anyone).
export async function logActivity(req, action, { emId, userName, entityType = null, entityId = null, detail = null } = {}) {
  const resolvedEmId = emId !== undefined ? emId : req?.user?.em_id || null;
  const resolvedUserName =
    userName !== undefined ? userName : req?.user ? `${req.user.first_name} ${req.user.last_name}`.trim() : null;
  const ipAddress = req?.ip || req?.socket?.remoteAddress || null;

  try {
    await insert(
      `INSERT INTO activity_logs (em_id, user_name, action, entity_type, entity_id, detail, ip_address)
       VALUES (:emId, :userName, :action, :entityType, :entityId, :detail, :ipAddress)`,
      { emId: resolvedEmId, userName: resolvedUserName, action, entityType, entityId, detail, ipAddress }
    );
  } catch (err) {
    // A logging failure must never break the real request it's attached to.
    console.error('Failed to write activity log:', err);
  }
}
