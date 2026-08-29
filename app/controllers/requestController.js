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
} from '../../helpers/contractRequestHelper.js';
import { NEW_REQUEST_STATUS, EDIT_ACTION_STATUS } from '../utils/statusGroups.js';
import { toDateOnly } from '../utils/dateUtils.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

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

// ---------------------------------------------------------------------------
// New contract requests (draft or sent) from the New Request form
// ---------------------------------------------------------------------------
export async function createRequest(req, res) {
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
  });
}

// The Edit modal sends which footer button was clicked as `action`; that decides
// the resulting status transition (server-side, never trusting a client-supplied
// status directly). `save-change` intentionally keeps whatever status the row is
// already at — editing an in-flight request doesn't restart its approval stage.
export async function updateRequest(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const action = body.action;
  if (!Object.prototype.hasOwnProperty.call(EDIT_ACTION_STATUS, action)) {
    return res.status(400).json({ message: 'Invalid action.' });
  }

  try {
    const result = await sequelize.transaction(async transaction => {
      const options = { transaction };
      const existing = await select(
        `SELECT status, created_by FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
        { id },
        options
      );
      if (!existing.length) throw new ApiError(404, 'Contract request not found');

      const status = EDIT_ACTION_STATUS[action] || existing[0].status;

      await updateEditableFields(id, body, status, options);

      if (body.comment) {
        const role = computeCommentRole(existing[0].created_by, body.emId);
        await insertComment(id, body.comment, body.updatedName, role, body.emId, options);
      }

      return { id: Number(id), status };
    });
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
