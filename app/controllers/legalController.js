import { sequelize, select, exec, insert } from '../../config/mysql.js';
import { updateEditableFields, insertComment } from '../../helpers/contractRequestHelper.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Legal Review Mode (Legal > Waiting screen) — Comment / Check / Terminate /
// No Need / Cancel, each atomic (single Sequelize transaction).
// ---------------------------------------------------------------------------

// Comments left from Legal Review Mode are always labeled "LG", regardless of which
// legal user is acting — Legal is a shared role queue, not a per-request assignment.
const LEGAL_COMMENT_ROLE = 'LG';

async function insertLegalHistory(id, action, by, emId, options = {}) {
  await insert(
    `INSERT INTO contract_legal_history (contract_request_id, action, \`by\`, created_by) VALUES (:id, :action, :by, :emId)`,
    { id, action, by: by || null, emId: emId || null },
    options
  );
}

// `SELECT ... FOR UPDATE` locks the row for the lifetime of the transaction, same
// reasoning as approvalController's lockRequest — Legal actions from two reviewers
// hitting the same request at once should serialize instead of racing.
// (See the code-smell note in approvalController.js — this is deliberately a
// separate, narrower helper rather than a shared one: it only needs `status`.)
async function lockRequest(id, options) {
  const rows = await select(
    `SELECT status FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
    { id },
    options
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  return rows[0];
}

// Comment never changes status — it only saves the edited fields + an optional
// comment, and no contract_legal_history row (that table is Check/Terminate/
// No Need/Cancel only).
async function commentOnLegalRequest(id, body) {
  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, existing.status, options);

    if (body.comment && body.comment.trim()) {
      await insertComment(id, body.comment, body.updatedName, LEGAL_COMMENT_ROLE, body.emId, options);
    }

    return { id: Number(id), status: existing.status };
  });
}

// Check completes the legal review but does not change `status` by itself (kept
// deliberately independent so Legal > Waiting never disturbs the main workflow) —
// it saves the edited fields, an optional comment, a Check row in
// contract_legal_history, and flips legal_check to 1, which is what actually drops
// the row off Legal > Waiting.
async function checkLegalRequest(id, body) {
  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, existing.status, options);

    if (body.comment && body.comment.trim()) {
      await insertComment(id, body.comment, body.updatedName, LEGAL_COMMENT_ROLE, body.emId, options);
    }

    await insertLegalHistory(id, 'Check', body.updatedName, body.emId, options);

    await exec(`UPDATE contract_requests SET legal_check = 1 WHERE id = :id`, { id }, options);

    return { id: Number(id), status: existing.status };
  });
}

// No Need marks a contract that legal has determined doesn't require review — a
// simpler sibling to Check/Terminate: no edited-fields save, no comment, just a
// contract_legal_history row and a terminal status flip. That status flip is also
// what drops it off Legal > Waiting (same mechanism as Terminate — neither
// 'No Needed' nor 'Terminated' is in LEGAL_REVIEW_STATUSES, see statusGroups.js).
async function markNoNeedLegalRequest(id, body) {
  return sequelize.transaction(async transaction => {
    const options = { transaction };
    await lockRequest(id, options);

    await insertLegalHistory(id, 'No Need', body.updatedName, body.emId, options);

    await exec(
      `UPDATE contract_requests SET status = 'No Needed', updated_by = :emId, updated_name = :updatedName, updated_at = NOW() WHERE id = :id`,
      { id, emId: body.emId || null, updatedName: body.updatedName || null },
      options
    );

    return { id: Number(id), status: 'No Needed' };
  });
}

// Cancel (offered while status = 'Drafted') and Terminate (offered while status =
// 'Signed') are the same workflow end to end — required comment, full edited-fields
// save, a contract_legal_history row, and a terminal status flip — differing only in
// which literal action/status they record. Both require a comment (enforced
// client-side too — red border/scroll — but re-checked here since the server never
// trusts client-side validation alone).
// 'Canceled' (single L) reuses the exact status string already registered elsewhere
// in the system (HISTORY_STATUSES, StatusBadge, the Edit modal's own Cancel action —
// see EDIT_ACTION_STATUS in app/utils/statusGroups.js) rather than introducing a
// second, differently spelled "cancelled" status.
const CANCEL_OR_TERMINATE_STATUS = { Cancel: 'Canceled', Terminate: 'Terminated' };

async function cancelOrTerminateLegalRequest(id, body, action) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');
  const status = CANCEL_OR_TERMINATE_STATUS[action];

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    await lockRequest(id, options);

    await updateEditableFields(id, body, status, options);

    await insertComment(id, body.comment, body.updatedName, LEGAL_COMMENT_ROLE, body.emId, options);

    await insertLegalHistory(id, action, body.updatedName, body.emId, options);

    return { id: Number(id), status };
  });
}

const terminateLegalRequest = (id, body) => cancelOrTerminateLegalRequest(id, body, 'Terminate');
const cancelLegalRequest = (id, body) => cancelOrTerminateLegalRequest(id, body, 'Cancel');

export async function comment(req, res) {
  try {
    const result = await commentOnLegalRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function check(req, res) {
  try {
    const result = await checkLegalRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function terminate(req, res) {
  try {
    const result = await terminateLegalRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function noNeed(req, res) {
  try {
    const result = await markNoNeedLegalRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function cancel(req, res) {
  try {
    const result = await cancelLegalRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
