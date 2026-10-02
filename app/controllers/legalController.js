import { sequelize, select, exec, insert } from '../../config/mysql.js';
import {
  updateEditableFields,
  insertComment,
  notifyRequestorWaived,
  notifyRequestorLegalComment,
  normalizeReferContractNo,
} from '../../helpers/contractRequestHelper.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLog.js';

// ---------------------------------------------------------------------------
// Legal Review Mode (Legal > Waiting screen) — Comment / Check / Terminate /
// Waive / Cancel, each atomic (single Sequelize transaction).
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
// Widened beyond the original {status, requestorName, createdBy} to also carry remark,
// contract_no, approver1/2/3_em_id and linked_master_id — waiveLegalRequest's own
// notifyRequestorWaived (below) needs all of those, the same shape
// approvalController.js's own lockRequest already selects, to reuse
// buildRequestorNotificationData/buildContractEmailData rather than re-deriving these
// fields a second time. Every other action in this file still only reads the
// original 3 fields off the result, so widening the SELECT doesn't change anything
// for them.
async function lockRequest(id, options) {
  const rows = await select(
    `SELECT status, requestor_name AS requestorName, created_by AS createdBy,
            remark, contract_no, approver1_em_id, approver2_em_id, approver3_em_id, linked_master_id
     FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
    { id },
    options
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  return rows[0];
}

// Comment never changes status — it only saves the edited fields + an optional
// comment, and no contract_legal_history row (that table is Check/Terminate/
// No Need/Cancel only). When a comment is actually left, also notifies the Requestor
// (CC the 3 approvers) by email once the transaction has committed — same "capture
// inside the transaction, notify after it commits" pattern as waiveLegalRequest's own
// existingForEmail below.
async function commentOnLegalRequest(id, body) {
  let existingForEmail = null;

  const result = await sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);
    existingForEmail = existing;

    await updateEditableFields(id, body, existing.status, options);

    if (body.comment && body.comment.trim()) {
      await insertComment(id, body.comment, body.updatedName, LEGAL_COMMENT_ROLE, body.emId, options);
    }

    return { id: Number(id), status: existing.status };
  });

  if (body.comment && body.comment.trim()) {
    // Remapped to snake_case — same reasoning as waiveLegalRequest's own call below:
    // buildRequestorNotificationData (contractRequestHelper.js) reads existing.created_by/
    // requestor_name, but lockRequest's own SELECT above aliases those camelCase.
    await notifyRequestorLegalComment(
      {
        created_by: existingForEmail.createdBy,
        requestor_name: existingForEmail.requestorName,
        remark: existingForEmail.remark,
        contract_no: existingForEmail.contract_no,
        approver1_em_id: existingForEmail.approver1_em_id,
        approver2_em_id: existingForEmail.approver2_em_id,
        approver3_em_id: existingForEmail.approver3_em_id,
        linked_master_id: existingForEmail.linked_master_id,
      },
      body,
      { systemUrl: body.systemUrl, contractRequestId: id }
    );
  }

  return result;
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

// Waive marks a contract that legal has determined doesn't require review, signing
// it directly — replaces the old "No Need" action (which parked the request at a
// dead-end 'No Needed' status instead of letting it proceed). Comment is mandatory
// (re-checked here since the server never trusts client-side validation alone),
// unlike the old No Need action which had none — a real substantive outcome
// (advancing straight to Signed) needs a recorded reason. Saves any edited fields
// too, same as Terminate/Cancel below, since this is now that same weight of action.
// Also overwrites remark to 'waived' (regardless of what it was before) — same as
// approvalController's own waiveRequest — so the Remark checklist/badge/PDF all show
// "Waived" for any contract that went through either waive path.
async function waiveLegalRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  // Captured inside the transaction below, read again after it commits — same
  // "notify only once the DB change has actually persisted" reasoning
  // approvalController.js's own waiveRequest already uses. existing.remark here is
  // still the ORIGINAL remark, read before the UPDATE below overwrites it to 'waived'.
  let existingForEmail = null;

  const result = await sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);
    existingForEmail = existing;

    await updateEditableFields(id, body, 'Signed', options);

    // legal_check = 1 too, not just remark/status — Legal clicking Waive IS their
    // review of this row; without this it stays 'Signed' + legal_check = 0 forever
    // (both still match LEGAL_REVIEW_STATUSES/countLegalWaiting's own WHERE), so a
    // waived row never leaves Legal > Waiting even though Legal already acted on it.
    await exec(`UPDATE contract_requests SET remark = 'waived', legal_check = 1 WHERE id = :id`, { id }, options);

    await insertComment(id, body.comment, body.updatedName, LEGAL_COMMENT_ROLE, body.emId, options);

    await insertLegalHistory(id, 'Waive', body.updatedName, body.emId, options);

    return { id: Number(id), status: 'Signed' };
  });

  // Legal never mints a new contract_no (see lockRequest's own comment on this file's
  // widened SELECT) — Legal > Waiting only ever acts on a row that's already Drafted
  // or Signed, so existing.contract_no was already minted whenever this row first
  // reached Drafted through the normal approve chain.
  await notifyRequestorWaived(
    {
      created_by: existingForEmail.createdBy,
      requestor_name: existingForEmail.requestorName,
      remark: existingForEmail.remark,
      approver1_em_id: existingForEmail.approver1_em_id,
      approver2_em_id: existingForEmail.approver2_em_id,
      approver3_em_id: existingForEmail.approver3_em_id,
      linked_master_id: existingForEmail.linked_master_id,
    },
    body,
    { contractNo: existingForEmail.contract_no, waivedBy: 'Legal', systemUrl: body.systemUrl, contractRequestId: id }
  );

  return result;
}

// Cancel (offered while status = 'Drafted') and Terminate (offered while status =
// 'Signed') are the same workflow end to end — required comment, full edited-fields
// save, a contract_legal_history row, and a terminal status flip — differing only in
// which literal action/status they record. Both require a comment (enforced
// client-side too — red border/scroll — but re-checked here since the server never
// trusts client-side validation alone).
// 'Cancelled' reuses the exact status string already registered elsewhere in the
// system (HISTORY_STATUSES, StatusBadge, the Edit modal's own Cancel action — see
// EDIT_ACTION_STATUS in app/utils/statusGroups.js) rather than introducing a second,
// differently spelled status.
const CANCEL_OR_TERMINATE_STATUS = { Cancel: 'Cancelled', Terminate: 'Terminated' };

async function cancelOrTerminateLegalRequest(id, body, action) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');
  const status = CANCEL_OR_TERMINATE_STATUS[action];

  // Captured inside the transaction below, read again after it commits — same
  // "notify only once the DB change has actually persisted" reasoning
  // waiveLegalRequest's own existingForEmail already uses.
  let existingForEmail = null;

  const result = await sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);
    existingForEmail = existing;

    await updateEditableFields(id, body, status, options);

    // Displayed commenter identity is the job's own Requestor, not the legal user who
    // clicked Cancel/Terminate — the action itself (who performed it, updated_by/
    // contract_legal_history) still records the acting legal user unchanged.
    await insertComment(id, body.comment, existing.requestorName, LEGAL_COMMENT_ROLE, existing.createdBy, options);

    await insertLegalHistory(id, action, body.updatedName, body.emId, options);

    // Terminate cascades: every contract sharing the same base contract number
    // (DSST02-2026, DSST02-2026-01, DSST02-2026-02, ...) is terminated together,
    // regardless of which one of them Legal actually clicked Terminate on — a
    // Renew/Amend/Terminate revision was never meant to keep living once its own
    // base contract is terminated. A Claim Note (remark = 'claim') is the one
    // exception: it's a side-note on the contract, not a version of it, so its own
    // status is left untouched. Only `status`/`updated_at` are touched on the
    // siblings — same minimal-touch shape approvalController.js's own
    // isCancelCompletion uses for its linked master, never a full
    // updateEditableFields (that would overwrite each sibling's own distinct fields
    // with this row's body). Cancel has no such cascade — a Cancel request is its
    // own separate vehicle for cancelling one specific master (see
    // approvalController.js's isCancelCompletion), not a sibling-revision concept.
    if (action === 'Terminate') {
      const baseContractNo = normalizeReferContractNo(existing.contract_no);
      if (baseContractNo) {
        await exec(
          `UPDATE contract_requests
           SET status = 'Terminated', updated_at = NOW()
           WHERE (contract_no = :baseContractNo OR contract_no LIKE :baseContractNoPattern)
             AND remark != 'claim' AND deleted_at IS NULL AND id != :id`,
          { baseContractNo, baseContractNoPattern: `${baseContractNo}-%`, id },
          options
        );
      }
    }

    return { id: Number(id), status };
  });

  // "Legal Comment for Terminate"/"Legal Comment for Cancel" — same email/recipients
  // as a plain Comment (notifyRequestorLegalComment), just with the subject/heading
  // forced to the action just taken (`action` is already the literal 'Terminate' /
  // 'Cancel' string, same as CANCEL_OR_TERMINATE_STATUS's own keys) rather than the
  // target row's own remark (e.g. a Cancel on an already-Signed 'new' contract should
  // say "Cancel", not "New Contract") — the rows table itself still reflects that
  // row's real fields/remark shape unchanged.
  await notifyRequestorLegalComment(
    {
      created_by: existingForEmail.createdBy,
      requestor_name: existingForEmail.requestorName,
      remark: existingForEmail.remark,
      contract_no: existingForEmail.contract_no,
      approver1_em_id: existingForEmail.approver1_em_id,
      approver2_em_id: existingForEmail.approver2_em_id,
      approver3_em_id: existingForEmail.approver3_em_id,
      linked_master_id: existingForEmail.linked_master_id,
    },
    body,
    { systemUrl: body.systemUrl, remarkLabel: action, contractRequestId: id }
  );

  return result;
}

const terminateLegalRequest = (id, body) => cancelOrTerminateLegalRequest(id, body, 'Terminate');
const cancelLegalRequest = (id, body) => cancelOrTerminateLegalRequest(id, body, 'Cancel');

export async function comment(req, res) {
  try {
    const result = await commentOnLegalRequest(req.params.id, req.body || {});
    await logActivity(req, 'legal_comment', { entityType: 'contract_request', entityId: Number(req.params.id) });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function check(req, res) {
  try {
    const result = await checkLegalRequest(req.params.id, req.body || {});
    await logActivity(req, 'legal_check', { entityType: 'contract_request', entityId: Number(req.params.id), detail: result.status });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function terminate(req, res) {
  try {
    const result = await terminateLegalRequest(req.params.id, req.body || {});
    await logActivity(req, 'legal_terminate', { entityType: 'contract_request', entityId: Number(req.params.id), detail: result.status });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function waive(req, res) {
  try {
    const result = await waiveLegalRequest(req.params.id, req.body || {});
    await logActivity(req, 'legal_waive', { entityType: 'contract_request', entityId: Number(req.params.id), detail: result.status });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function cancel(req, res) {
  try {
    const result = await cancelLegalRequest(req.params.id, req.body || {});
    await logActivity(req, 'legal_cancel', { entityType: 'contract_request', entityId: Number(req.params.id), detail: result.status });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
