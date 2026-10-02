import { sequelize, select, insert } from '../../config/mysql.js';
import {
  DOCUMENT_TYPE_KEYS,
  updateEditableFields,
  upsertDocuments,
  upsertActionFiles,
  computeCommentRole,
  insertComment,
  normalizeReferContractNo,
  hasConfidentialAccess,
  notifyApproverForContractRequest,
} from '../../helpers/contractRequestHelper.js';
import { NEW_REQUEST_STATUS, EDIT_ACTION_STATUS } from '../utils/statusGroups.js';
import { toDateOnly } from '../utils/dateUtils.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';
import { logActivity } from '../utils/activityLog.js';

// Amend/Renew/Terminate/Claim Note/Cancel — all 5 show the Reference Item's own
// contract_no from the moment they're created (Save Draft or Send Request):
//
// - Amend/Renew/Terminate/Claim Note: a placeholder only — Approver 3's approval
//   replaces it with a real, newly-minted sub number (generateContractNo in
//   approvalController.js).
// - Cancel: stays this way permanently, never replaced with anything else — a Cancel
//   request is never itself a contract, it's the record of what it references (the
//   EXACT contract the user clicked Cancel on, whether that's a base contract or one of
//   its own revisions — see referContractNo below).
const REFER_CONTRACT_NO_PLACEHOLDER_REMARKS = ['amend', 'renew', 'terminate', 'claim', 'cancel'];

// updateRequest's `action` body field (EDIT_ACTION_STATUS's own keys) -> the
// activity_logs `action` value — kept distinct from the raw field name so the log
// reads as a verb ("send_request") rather than a URL-ish token ("send-request").
const ACTION_LOG_NAME = {
  'save-change': 'save_change',
  cancel: 'cancel_request',
  'save-draft': 'save_draft',
  'send-request': 'send_request',
};

// ---------------------------------------------------------------------------
// New contract requests (draft or sent) from the New Request form
// ---------------------------------------------------------------------------
export async function createRequest(req, res) {
  try {
    await createRequestBody(req, res);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

// Everything below is unchanged from before — same sequential awaits (no transaction
// wrapper added, none existed before), same status/request-type mapping, same email
// notification call — only wrapped in the try/catch above now, same pattern
// approve/waive/reject/updateRequest already use (see this same file's updateRequest,
// or approvalController.js) instead of leaving this route as the one handler in the
// project with no error handling at all.
async function createRequestBody(req, res) {
  const body = req.body || {};
  const status = NEW_REQUEST_STATUS[body.status] || 'Saved';
  const approvers = body.approvers || [];
  const payments = body.payments || {};
  const remark = body.remark || 'new';

  // Renew/Amend/Terminate/Claim Note: normalized to the base contract number (e.g.
  // "DSST01-2026-01" -> "DSST01-2026") — see normalizeReferContractNo — so the revision
  // counter for that base continues instead of nesting.
  //
  // Cancel: deliberately NOT normalized. It targets whichever exact contract (base or
  // revision) the client opened it from, verbatim — cancelling a revision must cancel
  // THAT contract, not silently redirect to its unrelated base. linked_master_id is
  // trusted as sent for the same reason: it's simply the id of whichever row this
  // request was opened from (the frontend already fetched that row's own data to
  // pre-fill the form, so there's no other row it could legitimately mean), and that's
  // exactly the row Approver 3's completion (approvalController.js) must flip to
  // 'Cancelled' — the row actually being cancelled, not some resolved ancestor of it.
  const referContractNo = remark === 'cancel' ? (body.referContractNo || null) : normalizeReferContractNo(body.referContractNo);
  const linkedMasterId = body.linkedMasterId || null;
  const contractNo = REFER_CONTRACT_NO_PLACEHOLDER_REMARKS.includes(remark) ? referContractNo : null;

  const requestId = await insert(
    `INSERT INTO contract_requests (
       status, confidentiality, contract_type_id, contract_purpose, other_specify,
       construction_risk_level, construction_risk_score, construction_risk_answers,
       supplier_name, contract_year, request_date, delivery_date, location, warranty_period, refer_contract_no, linked_master_id,
       contract_no,
       brief_description, action_background, action_detail,
       new_contract_start_date, new_contract_end_date, action_effective_date, cancel_reason,
       total_net_price, vat, currency, trade_term, payment_other,
       payment1, payment2, payment3, payment4, payment5, payment6, payment7, payment8,
       requestor_name, requestor_section, remark,
       approver1_em_id, approver2_em_id, approver3_em_id,
       created_by, updated_by, updated_name, updated_at
     ) VALUES (
       :status, :confidentiality, :contractTypeId, :contractPurpose, :otherSpecify,
       :constructionRiskLevel, :constructionRiskScore, :constructionRiskAnswers,
       :supplierName, YEAR(:requestDate), :requestDate, :deliveryDate, :location, :warrantyPeriod, :referContractNo, :linkedMasterId,
       :contractNo,
       :briefDescription, :actionBackground, :actionDetail,
       :newContractStartDate, :newContractEndDate, :actionEffectiveDate, :cancelReason,
       :totalNetPrice, :vat, :currency, :tradeTerm, :paymentOther,
       :payment1, :payment2, :payment3, :payment4, :payment5, :payment6, :payment7, :payment8,
       :requestorName, :requestorSection, :remark,
       :approver1EmId, :approver2EmId, :approver3EmId,
       :emId, :emId, :updatedName, NOW()
     )`,
    {
      status,
      confidentiality: body.confidentiality ? 1 : 0,
      contractTypeId: body.contractTypeId || null,
      contractPurpose: body.contractPurpose || null,
      otherSpecify: body.otherSpecify || null,
      constructionRiskLevel: body.constructionRiskLevel || null,
      constructionRiskScore: body.constructionRiskScore ?? null,
      constructionRiskAnswers: body.constructionRiskAnswers ? JSON.stringify(body.constructionRiskAnswers) : null,
      supplierName: body.supplierName || '',
      requestDate: body.requestDate || null,
      deliveryDate: body.deliveryDate || null,
      location: body.location || null,
      warrantyPeriod: body.warrantyPeriod || null,
      referContractNo,
      linkedMasterId,
      contractNo,
      briefDescription: body.briefDescription || null,
      actionBackground: body.actionBackground || null,
      actionDetail: body.actionDetail || null,
      newContractStartDate: body.newContractStartDate || null,
      newContractEndDate: body.newContractEndDate || null,
      actionEffectiveDate: body.actionEffectiveDate || null,
      cancelReason: body.cancelReason || null,
      totalNetPrice: body.totalNetPrice || null,
      vat: body.vat || null,
      currency: body.currency || null,
      tradeTerm: body.tradeTerm || null,
      paymentOther: body.paymentOther || null,
      payment1: payments.payment1 || null,
      payment2: payments.payment2 || null,
      payment3: payments.payment3 || null,
      payment4: payments.payment4 || null,
      payment5: payments.payment5 || null,
      payment6: payments.payment6 || null,
      payment7: payments.payment7 || null,
      payment8: payments.payment8 || null,
      requestorName: body.requestorName || '',
      requestorSection: body.requestorSection || '',
      remark,
      // approvers[] is UI row order top-to-bottom (Manager, Supervisor, Supervisor), but
      // the approval sequence runs bottom-up (index 2 approves first as Approver 1, index
      // 0/Manager signs off last as Approver 3) — see the comment above ApprovalSection's
      // component in ApprovalSection.jsx, and updateEditableFields's identical mapping,
      // which this must match.
      approver1EmId: approvers[2] || null,
      approver2EmId: approvers[1] || null,
      approver3EmId: approvers[0] || null,
      emId: body.emId || null,
      updatedName: body.updatedName || null,
    }
  );

  if (body.comment) {
    // The creator's own comment on a brand-new request — they are definitionally the Requester.
    await insertComment(requestId, body.comment, body.updatedName, 'Requester', body.emId);
  }

  await upsertDocuments(requestId, body.documents, body.emId);
  await upsertActionFiles(requestId, body.actionFiles, body.emId);

  // Send Request (not Save Draft) notifies Approver 1 — approvers[2] is the bottom
  // Supervisor slot, always required (see formConfig.js's approverErrors), which is
  // exactly what approver1_em_id was just inserted as above.
  if (status === 'Waiting Approver 1') {
    await notifyApproverForContractRequest(approvers[2], {
      body,
      remark,
      contractNo,
      requestorName: body.requestorName,
      linkedMasterId,
      systemUrl: body.systemUrl,
      contractRequestId: requestId,
    });
  }

  await logActivity(req, status === 'Waiting Approver 1' ? 'send_request' : 'save_draft', {
    emId: body.emId || null,
    userName: body.updatedName || null,
    entityType: 'contract_request',
    entityId: requestId,
    detail: `${remark} — ${contractNo || body.supplierName || ''}`.trim(),
  });

  res.status(201).json({ id: requestId, status });
}

// Fetch a single contract request, shaped to match the New Request form's
// initial-values structure so the Edit modal can feed it straight into the
// same formik instance/sections used for creating a request.
export async function getRequest(req, res) {
  const { id } = req.params;
  const rows = await select(`SELECT * FROM contract_requests WHERE id = :id AND deleted_at IS NULL`, { id });
  const row = rows[0];
  if (!row) return res.status(404).json({ message: 'Contract request not found' });
  if (!hasConfidentialAccess(row, req.user)) {
    return res.status(403).json({ message: 'You do not have permission to access this contract.' });
  }

  // Renew's "Original Period" is never stored on this row itself — it's always read
  // fresh from the contract this request renews (linked_master_id), so it can never
  // drift out of sync with what that original contract's own signed period says.
  let originalContractStartDate = null;
  let originalContractEndDate = null;
  if (row.remark === 'renew' && row.linked_master_id) {
    const masterRows = await select(
      `SELECT contract_start_date, expire_date FROM contract_requests WHERE id = :masterId`,
      { masterId: row.linked_master_id }
    );
    if (masterRows.length) {
      originalContractStartDate = masterRows[0].contract_start_date;
      originalContractEndDate = masterRows[0].expire_date;
    }
  }

  const docRows = await select(
    `SELECT crd.id AS documentId, crd.document_type AS documentType, crd.checked,
            f.id AS fileId, f.file_name AS fileName, f.extension
     FROM contract_request_documents crd
     LEFT JOIN contract_request_document_files crdf
       ON crdf.contract_request_document_id = crd.id AND crdf.active = 1 AND crdf.deleted_at IS NULL
     LEFT JOIN file_uploads f ON f.id = crdf.file_upload_id AND f.active = 1 AND f.deleted_at IS NULL
     WHERE crd.contract_request_id = :id AND crd.active = 1 AND crd.deleted_at IS NULL`,
    { id }
  );

  const documents = {};
  for (const [feKey, dbKey] of Object.entries(DOCUMENT_TYPE_KEYS)) {
    const forType = docRows.filter(d => d.documentType === dbKey);
    documents[feKey] = {
      checked: forType.length ? !!forType[0].checked : false,
      files: forType.filter(d => d.fileId).map(d => ({ id: d.fileId, fileName: d.fileName, extension: d.extension, active: true })),
    };
  }

  const commentRows = await select(
    `SELECT id, comment, commenter_name AS name, role, created_at AS createdAt
     FROM contract_request_comments
     WHERE contract_request_id = :id AND active = 1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    { id }
  );

  // The actual signed contract PDF attached via Upload Sign Contract — separate from
  // the system-generated Contract Requisition Form PDF (client-rendered, never stored).
  // Only present once status has reached Signed (or Terminated, which only ever gets
  // there via a Signed Terminate request's cascade — see signedContractController.js).
  let signedFile = null;
  if (row.signed_file_id) {
    const signedFileRows = await select(
      `SELECT id, file_name AS fileName, extension FROM file_uploads WHERE id = :fileId AND active = 1 AND deleted_at IS NULL`,
      { fileId: row.signed_file_id }
    );
    signedFile = signedFileRows[0] || null;
  }

  const actionFileRows = await select(
    `SELECT f.id, f.file_name AS fileName, f.extension
     FROM contract_request_action_files craf
     JOIN file_uploads f ON f.id = craf.file_upload_id AND f.active = 1 AND f.deleted_at IS NULL
     WHERE craf.contract_request_id = :id AND craf.active = 1 AND craf.deleted_at IS NULL`,
    { id }
  );

  res.json({
    id: row.id,
    status: row.status,
    createdBy: row.created_by || null,
    confidentiality: !!row.confidentiality,
    contractTypeId: row.contract_type_id,
    contractPurpose: row.contract_purpose || '',
    otherSpecify: row.other_specify || '',
    constructionRiskLevel: row.construction_risk_level || '',
    constructionRiskScore: row.construction_risk_score ?? null,
    constructionRiskAnswers: row.construction_risk_answers || null,
    contractNo: row.contract_no || '',
    supplierName: row.supplier_name || '',
    requestDate: toDateOnly(row.request_date),
    deliveryDate: toDateOnly(row.delivery_date),
    location: row.location || '',
    warrantyPeriod: row.warranty_period || '',
    referContractNo: row.refer_contract_no || '',
    linkedMasterId: row.linked_master_id || null,
    briefDescription: row.brief_description || '',
    actionBackground: row.action_background || '',
    actionDetail: row.action_detail || '',
    actionFiles: actionFileRows,
    actionEffectiveDate: toDateOnly(row.action_effective_date),
    newContractStartDate: toDateOnly(row.new_contract_start_date),
    newContractEndDate: toDateOnly(row.new_contract_end_date),
    cancelReason: row.cancel_reason || '',
    // The row's own signed period (Upload Sign Contract) — distinct from Renew's
    // "Original Period" above, which belongs to the contract THIS row renews, not to
    // this row's own eventual signed dates.
    contractStartDate: toDateOnly(row.contract_start_date),
    expireDate: toDateOnly(row.expire_date),
    originalContractStartDate: toDateOnly(originalContractStartDate),
    originalContractEndDate: toDateOnly(originalContractEndDate),
    totalNetPrice: row.total_net_price != null ? String(row.total_net_price) : '',
    vat: row.vat || '',
    currency: row.currency || '',
    tradeTerm: row.trade_term || '',
    payments: {
      payment1: row.payment1 || '', payment2: row.payment2 || '', payment3: row.payment3 || '', payment4: row.payment4 || '',
      payment5: row.payment5 || '', payment6: row.payment6 || '', payment7: row.payment7 || '', payment8: row.payment8 || '',
    },
    paymentOther: row.payment_other || '',
    documents,
    comment: '',
    comments: commentRows,
    requestorName: row.requestor_name || '',
    requestorSection: row.requestor_section || '',
    // Row order is top-to-bottom (Manager, Supervisor, Supervisor) but the approval
    // sequence runs bottom-up, so index 0/top reads from approver3 and index 2/bottom
    // reads from approver1 — see helpers/contractRequestHelper.js's updateEditableFields.
    approvers: [row.approver3_em_id || '', row.approver2_em_id || '', row.approver1_em_id || ''],
    // Signature + approval date captured at the moment each stage was approved (no
    // join to app_users/admin_users needed) — same top-to-bottom/bottom-up index order as `approvers`.
    approverSignatures: [
      { name: row.approver3_name || '', approvedAt: toDateOnly(row.approver3_approved_at) },
      { name: row.approver2_name || '', approvedAt: toDateOnly(row.approver2_approved_at) },
      { name: row.approver1_name || '', approvedAt: toDateOnly(row.approver1_approved_at) },
    ],
    remark: row.remark || 'new',
    signedFile,
  });
}

// The Edit modal sends which footer button was clicked as `action`; that decides
// the resulting status transition (server-side, never trusting a client-supplied
// status directly). `save-change` intentionally keeps whatever status the row is
// already at — editing an in-flight request doesn't restart its approval stage.
// Which approverN_em_id column is "the current stage" for a given status — same
// mapping approvalController.js's own STAGE_COLUMN uses, kept as an independent local
// copy rather than importing across controllers (matches this codebase's existing
// controller-to-controller isolation).
const EDIT_STAGE_COLUMN = {
  'Waiting Approver 1': 'approver1_em_id',
  'Waiting Approver 2': 'approver2_em_id',
  'Waiting Approver 3': 'approver3_em_id',
};

// send-request used to hardcode 'Waiting Approver 1' for every resubmission —
// correct for a first-time send from 'Saved', but wrong for resending after a
// Return: an approver who returns a request mid-chain (Approver 2 or 3) already had
// Approver 1 (and maybe 2) sign off before them, so restarting the whole chain from
// Approver 1 made them re-approve something they'd already approved. Resuming at the
// first stage that hasn't actually approved yet — read from approverN_approved_at,
// which Approve (approvalController.js) sets and Return never touches, so it still
// accurately reflects "who's already signed off" even after a Return — fixes this
// without needing a new column: a fresh 'Saved' row has every approverN_approved_at
// still NULL, so this still resolves to Approver 1 exactly like before. Same
// approver2-optional skip as approvalController.js's own resolveNextStatus.
//
// `newApprovers` is this resubmission's own body.approvers (UI order: [Manager,
// Supervisor1, Supervisor2], mapping to approver3/2/1 — same as updateEditableFields).
// A stage only counts as already-done when BOTH its approved_at is set AND the em_id
// assigned to that stage hasn't changed since — approverN_approved_at belongs to
// whoever held that slot at approval time, so if the requestor reassigns Approver 1 (or
// adds/changes Approver 2) while fixing a Returned request, the newly assigned person
// has never actually signed off and must not be skipped just because the OLD
// occupant's stale timestamp is still sitting on the row.
function resolveResumeStatus(existing, newApprovers = []) {
  const newApprover1EmId = newApprovers[2] || null;
  const newApprover2EmId = newApprovers[1] || null;

  const approver1Done = existing.approver1_approved_at && String(existing.approver1_em_id) === String(newApprover1EmId);
  if (!approver1Done) return 'Waiting Approver 1';

  const approver2Done =
    !newApprover2EmId || (existing.approver2_approved_at && String(existing.approver2_em_id) === String(newApprover2EmId));
  if (!approver2Done) return 'Waiting Approver 2';

  return 'Waiting Approver 3';
}

export async function updateRequest(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const action = body.action;
  if (!Object.prototype.hasOwnProperty.call(EDIT_ACTION_STATUS, action)) {
    return res.status(400).json({ message: 'Invalid action.' });
  }

  // Captured inside the transaction below, read again after it commits — same
  // "notify only after the DB change has actually persisted" reasoning
  // approvalController.js's approveRequest already uses.
  let existingForEmail = null;
  let statusForEmail = null;

  try {
    const result = await sequelize.transaction(async transaction => {
      const options = { transaction };
      const existing = await select(
        `SELECT status, created_by, contract_no, refer_contract_no, linked_master_id, remark,
                approver1_em_id, approver2_em_id, approver3_em_id,
                approver1_approved_at, approver2_approved_at, approver3_approved_at
         FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
        { id },
        options
      );
      if (!existing.length) throw new ApiError(404, 'Contract request not found');
      existingForEmail = existing[0];

      const status =
        action === 'send-request'
          ? resolveResumeStatus(existing[0], body.approvers || [])
          : EDIT_ACTION_STATUS[action] || existing[0].status;
      statusForEmail = status;

      await updateEditableFields(id, body, status, options);

      if (body.comment) {
        const role = computeCommentRole(existing[0].created_by, body.emId);
        await insertComment(id, body.comment, body.updatedName, role, body.emId, options);
      }

      return { id: Number(id), status };
    });

    // save-change (the only other action that can land here with a Waiting Approver *
    // status — it keeps whatever status the row already had) only re-notifies when it
    // actually reassigns the approver for the request's CURRENT stage, not on every
    // save (that would re-spam the same approver every time a typo gets fixed).
    // send-request is different: whether this is a first send from 'Saved' or a
    // resend after a Return (resolveResumeStatus above), the approver at the resumed
    // stage needs to know a request just landed in their queue either way — even when
    // they're the same approver as before (the common case: nothing about the approval
    // chain changed, just the content that was returned for a fix). approvers[] is UI
    // row order top-to-bottom (Manager, Supervisor, Supervisor) — approvers[2]/[1]/[0]
    // map to approver1/2/3 respectively, same mapping updateEditableFields itself uses.
    const stageColumn = EDIT_STAGE_COLUMN[statusForEmail];
    if (stageColumn && existingForEmail) {
      const approvers = body.approvers || [];
      const newEmIdByColumn = {
        approver1_em_id: approvers[2] || null,
        approver2_em_id: approvers[1] || null,
        approver3_em_id: approvers[0] || null,
      };
      const newEmId = newEmIdByColumn[stageColumn];
      const oldEmId = existingForEmail[stageColumn];
      if (newEmId && (action === 'send-request' || newEmId !== oldEmId)) {
        await notifyApproverForContractRequest(newEmId, {
          body,
          remark: existingForEmail.remark,
          contractNo: existingForEmail.contract_no,
          requestorName: body.requestorName,
          linkedMasterId: existingForEmail.linked_master_id,
          systemUrl: body.systemUrl,
          contractRequestId: id,
        });
      }
    }

    await logActivity(req, ACTION_LOG_NAME[action] || action, {
      emId: body.emId || null,
      userName: body.updatedName || null,
      entityType: 'contract_request',
      entityId: Number(id),
      detail: existingForEmail ? `${existingForEmail.remark} — ${existingForEmail.contract_no || ''}`.trim() : null,
    });

    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
