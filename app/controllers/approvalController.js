import { sequelize, select, exec, insert } from '../../config/mysql.js';
import { updateEditableFields, insertComment } from '../../helpers/contractRequestHelper.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Approval workflow (Waiting Approve screen) — Approve / Return / Reject, each
// atomic (single Sequelize transaction: edited fields, comment, approval history,
// status transition, and — on Approve reaching Drafted — contract number
// generation all commit or roll back together).
// ---------------------------------------------------------------------------

// Approving Waiting Approver N moves the request to the next stage; Approver 3 is the
// last stage, so approving it drafts the contract (and mints a contract number).
// Approver 2 is optional per-request — if approver2_em_id wasn't set, Waiting Approver 1
// skips straight to Waiting Approver 3 instead of stalling on an approver that doesn't exist.
function resolveNextStatus(existing) {
  switch (existing.status) {
    case 'Waiting Approver 1':
      return existing.approver2_em_id ? 'Waiting Approver 2' : 'Waiting Approver 3';
    case 'Waiting Approver 2':
      return 'Waiting Approver 3';
    case 'Waiting Approver 3':
      return 'Drafted';
    default:
      return null;
  }
}

// Which stage just got approved, keyed by the status the request was AT before this
// call (i.e. "Waiting Approver 1" means approver1 is the one signing off right now).
const STAGE_COLUMN = {
  'Waiting Approver 1': 'approver1',
  'Waiting Approver 2': 'approver2',
  'Waiting Approver 3': 'approver3',
};

// Every comment left from the Waiting Approve screen (Approve/Return/Reject) is
// labeled by which of the 3 approver slots is acting: Approver 3 (the Manager slot,
// see ApprovalSection.jsx — index 0, approves last) is "Manager"; Approver 1/2 (the
// Supervisor slots) are "Supervisor". Saved as the actual role at write time, not
// inferred later — every reader (Comment History, this request's own comment list)
// just displays whatever role is in the row.
//
// Checked in this order because the same em_id can be both the requestor AND the
// assigned approver (e.g. a tester self-approving their own request) — commenting
// from this Waiting Approve action means they're acting as the approver right now,
// so that takes priority over "Requester" even when both are technically true.
// Falls back to Requester for the request's creator, then Others for anyone else
// (e.g. legal/admin just browsing).
function computeApprovalCommentRole(existing, actorEmId) {
  const stageColumn = STAGE_COLUMN[existing.status];
  if (stageColumn && actorEmId && existing[`${stageColumn}_em_id`] === actorEmId) {
    return stageColumn === 'approver3' ? 'Manager' : 'Supervisor';
  }
  if (actorEmId && existing.created_by === actorEmId) return 'Requester';
  return 'Others';
}

// "Approved By" Signature format: first name + first 2 letters of the last name,
// e.g. "Thitinun" + "Chaychayanon" -> "Thitinun Ch." — captured from the acting
// approver's own session at approval time so display never needs to join back to
// app_users/admin_users.
function formatSignature(firstName, lastName) {
  if (!firstName) return null;
  const initials = String(lastName || '').slice(0, 2);
  return initials ? `${firstName} ${initials}.` : firstName;
}

async function insertApprovalHistory(id, action, emId, name, options = {}) {
  await insert(
    `INSERT INTO contract_approval_history (contract_request_id, action, created_by, created_by_name)
     VALUES (:id, :action, :emId, :name)`,
    { id, action, emId: emId || null, name: name || null },
    options
  );
}

// Atomic contract-number generation. Both branches wrap the seed/increment value in
// LAST_INSERT_ID(...) so `SELECT LAST_INSERT_ID()` reliably returns the current value
// whether this call created the counter row or incremented an existing one — MySQL only
// populates the session's last-insert-id from the ON DUPLICATE KEY branch's expression
// unless the plain INSERT path also routes its value through LAST_INSERT_ID().
async function generateContractNo(referContractNo, options) {
  const pad = n => String(n).padStart(2, '0');

  if (referContractNo) {
    await exec(
      `INSERT INTO contract_revision_sequences (contract_no, last_revision) VALUES (:ref, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE last_revision = LAST_INSERT_ID(last_revision + 1)`,
      { ref: referContractNo },
      options
    );
    const rows = await select(`SELECT LAST_INSERT_ID() AS n`, {}, options);
    return `${referContractNo}-${pad(Number(rows[0].n))}`;
  }

  const year = new Date().getFullYear();
  await exec(
    `INSERT INTO contract_no_sequences (year, last_number) VALUES (:year, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    { year },
    options
  );
  const rows = await select(`SELECT LAST_INSERT_ID() AS n`, {}, options);
  return `DSST${pad(Number(rows[0].n))}-${year}`;
}

// `SELECT ... FOR UPDATE` locks the row for the lifetime of the transaction so two
// approvers acting on the same request at once serialize instead of racing.
//
// NOTE (code smell, intentionally not consolidated): legalController.js and
// signedContractController.js each have their own near-identical `lockRequest`-style
// helper. They were NOT merged into one shared utility during this refactor because
// they select different columns / enforce different status checks (this one needs
// created_by + all 3 approverN_em_id columns; legal's only needs `status`;
// signedContract's additionally requires status === 'Drafted') — merging them would
// mean changing the SQL one of them runs, which this refactor was explicitly told not
// to do "unless necessary". A future cleanup could parameterize a single
// `lockRequestForUpdate(id, { columns, requireStatus }, options)` helper instead.
async function lockRequest(id, options) {
  const rows = await select(
    `SELECT status, created_by, refer_contract_no, approver1_em_id, approver2_em_id, approver3_em_id
     FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
    { id },
    options
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  return rows[0];
}

async function approveRequest(id, body) {
  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    const nextStatus = resolveNextStatus(existing);
    if (!nextStatus) throw new ApiError(400, `Cannot approve a request with status "${existing.status}".`);

    await updateEditableFields(id, body, nextStatus, options);

    const stageColumn = STAGE_COLUMN[existing.status];
    if (stageColumn) {
      const signature = formatSignature(body.approverFirstName, body.approverLastName);
      await exec(
        `UPDATE contract_requests SET ${stageColumn}_name = :signature, ${stageColumn}_approved_at = NOW() WHERE id = :id`,
        { id, signature },
        options
      );
    }

    if (body.comment && body.comment.trim()) {
      const role = computeApprovalCommentRole(existing, body.emId);
      await insertComment(id, body.comment, body.updatedName, role, body.emId, options);
    }

    await insertApprovalHistory(id, 'Approve', body.emId, body.updatedName, options);

    let contractNo = null;
    if (nextStatus === 'Drafted') {
      const referContractNo = (body.referContractNo || '').trim() || null;
      contractNo = await generateContractNo(referContractNo, options);
      await exec(`UPDATE contract_requests SET contract_no = :contractNo WHERE id = :id`, { id, contractNo }, options);
    }

    return { id: Number(id), status: nextStatus, contractNo };
  });
}

async function returnRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, 'Returned', options);

    const role = computeApprovalCommentRole(existing, body.emId);
    await insertComment(id, body.comment, body.updatedName, role, body.emId, options);

    await insertApprovalHistory(id, 'Return', body.emId, body.updatedName, options);

    return { id: Number(id), status: 'Returned' };
  });
}

async function rejectRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, 'Rejected', options);

    const role = computeApprovalCommentRole(existing, body.emId);
    await insertComment(id, body.comment, body.updatedName, role, body.emId, options);

    await insertApprovalHistory(id, 'Reject', body.emId, body.updatedName, options);

    return { id: Number(id), status: 'Rejected' };
  });
}

export async function approve(req, res) {
  try {
    const result = await approveRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function returnContract(req, res) {
  try {
    const result = await returnRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function reject(req, res) {
  try {
    const result = await rejectRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
