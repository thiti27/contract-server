import { select } from '../../config/mysql.js';
import { countByStatuses, countWaitingApprove, countLegalWaiting } from '../utils/contractCounters.js';
import { MY_JOB_STATUSES } from '../utils/statusGroups.js';

export async function getMeta(req, res) {
  const { createdBy = '', legal = '' } = req.query;
  // "My Job" is scoped to whoever's logged in (created_by); Waiting Approve is scoped
  // to the same logged-in em_id but matched against whichever approverN_em_id column
  // corresponds to the row's current stage (see countWaitingApprove); Waiting Check
  // is a role-wide queue (legal) — every legal user sees the same count, gated on
  // whether the caller has the legal permission at all (see countLegalWaiting).
  const [types, sections, years, statuses, myJob, waitingApprove, waitingCheck] = await Promise.all([
    select(`SELECT DISTINCT ct.name AS type FROM contract_requests c JOIN contract_types ct ON ct.id = c.contract_type_id WHERE c.deleted_at IS NULL`),
    select(`SELECT DISTINCT requestor_section AS section FROM contract_requests WHERE deleted_at IS NULL`),
    select(`SELECT DISTINCT contract_year AS year FROM contract_requests WHERE deleted_at IS NULL ORDER BY contract_year DESC`),
    select(`SELECT DISTINCT status FROM contract_requests WHERE deleted_at IS NULL`),
    countByStatuses(MY_JOB_STATUSES, createdBy),
    countWaitingApprove(createdBy),
    countLegalWaiting(legal),
  ]);

  res.json({
    types: types.map(r => r.type),
    sections: sections.map(r => r.section),
    years: years.map(r => String(r.year)),
    statuses: statuses.map(r => r.status),
    counts: { myJob, waitingApprove, waitingCheck },
  });
}
