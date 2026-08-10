import { select } from '../../config/mysql.js';
import { APPROVER_STAGE_MATCH } from './statusGroups.js';

// Counts non-deleted contract_requests matching a status list, optionally scoped to
// whoever created them — backs the "My Job" badge count in metaController.
export async function countByStatuses(statuses, createdBy) {
  const placeholders = statuses.map((_, i) => `:s${i}`).join(', ');
  const replacements = Object.fromEntries(statuses.map((s, i) => [`s${i}`, s]));
  let where = `deleted_at IS NULL AND status IN (${placeholders})`;
  if (createdBy) {
    where += ' AND created_by = :createdBy';
    replacements.createdBy = createdBy;
  }
  const rows = await select(`SELECT COUNT(*) AS count FROM contract_requests WHERE ${where}`, replacements);
  return Number(rows[0].count);
}

// Waiting Approve's badge count must reflect the exact same rows the Waiting Approve
// list shows — same APPROVER_STAGE_MATCH condition contractController applies.
export async function countWaitingApprove(emId) {
  if (!emId) return 0;
  const rows = await select(
    `SELECT COUNT(*) AS count FROM contract_requests WHERE deleted_at IS NULL AND ${APPROVER_STAGE_MATCH}`,
    { approverEmId: emId }
  );
  return Number(rows[0].count);
}

// Legal > Waiting is a role-wide queue (any legal user can review any request) —
// gated on whether the caller has the legal permission at all, rather than filtering
// rows by em_id like countWaitingApprove does.
export async function countLegalWaiting(legal) {
  if (!legal) return 0;
  const rows = await select(
    `SELECT COUNT(*) AS count FROM contract_requests
     WHERE deleted_at IS NULL AND legal_check = 0 AND status IN ('Drafted', 'Signed')`
  );
  return Number(rows[0].count);
}
