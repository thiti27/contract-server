import { exec, select, insert } from '../config/mysql.js';
import { sendContractRequestEmail } from '../app/services/contractEmail.service.js';
import { getEmployeeEmail } from '../app/services/employeeLookup.service.js';

// Shared between the New Request POST, the Edit modal's PATCH, and the approval/legal
// workflow controllers — every entry point that lets a user touch a contract_requests
// row's editable fields goes through this one place. Used by requestController,
// approvalController, and legalController alike, which is exactly why it lives here
// as a helper rather than inside any single controller.
export const DOCUMENT_TYPE_KEYS = {
  drafted: 'drafted',
  quotation: 'quotation',
  specification: 'specification',
  drawing: 'drawing',
  schedule: 'schedule',
  companyCertificate: 'company_certificate',
  other: 'other',
};

// Strips a revision suffix (e.g. "DSST01-2026-01" -> "DSST01-2026") so refer_contract_no
// always points at the base contract, never at one specific revision of it. Applied
// defensively here (not just client-side — see normalizeReferContractNo in
// contravct-web/src/lib/contractNo.js) because approvalController.js's
// generateContractNo keys the contract_revision_sequences counter off this value
// directly: a revisioned referContractNo would nest revisions ("DSST01-2026-01-01")
// instead of continuing the same counter for the base contract ("DSST01-2026-02").
export function normalizeReferContractNo(contractNo) {
  const match = /^(DSST\d+-\d{4})-\d{2}$/.exec(contractNo || '');
  return match ? match[1] : contractNo || null;
}

// Server-side re-check backing the same rule the frontend uses to decide whether to
// grey out View/Download for a HIGH CONFIDENTIAL row on All Job/Home (see
// ContractTable.jsx) — the frontend gate is only a UI convenience, this is what
// actually stops a non-permitted user reading a confidential contract's detail or
// downloading one of its attached files by calling the API directly.
//
// This same check also guards getRequest(), which every mode (Edit, Approve, Legal
// Review, View) fetches a contract's detail through — so on top of the 3 conditions
// All Job/Home surface in the UI (creator, `view` permission, one of the 3 approvers),
// `legal`/`admin` are also let through here: Waiting Approve/Waiting Check/Legal
// History's own View button has never been confidentiality-gated (approvalMode's
// RowActions branch in ContractTable.jsx ignores `restricted` entirely, since being in
// that queue already means you're supposed to review the row) — omitting them here
// would silently break legal review / approval for confidential contracts instead of
// just tightening what All Job/Home already restrict.
//
// A non-confidential row is always accessible. approver slots that are null/undefined/
// empty never count as a match, and em_ids are compared as strings so a numeric vs
// string mismatch can't accidentally deny (or allow) access.
export function hasConfidentialAccess(row, user) {
  if (!row?.confidentiality) return true;
  if (user?.legal || user?.admin) return true;
  const emId = user?.em_id != null ? String(user.em_id) : '';
  if (!emId) return false;
  if (String(row.created_by ?? '') === emId) return true;
  if (user?.view) return true;
  return [row.approver1_em_id, row.approver2_em_id, row.approver3_em_id].some(
    a => a != null && String(a) !== '' && String(a) === emId
  );
}

// Updates every editable field on a contract_requests row. `status` is passed in
// (rather than read from `body`) because callers compute it themselves from their
// own workflow rules — this function never decides a status transition, it only
// persists whatever status the caller already decided on.
export async function updateEditableFields(id, body, status, options = {}) {
  const approvers = body.approvers || [];
  const payments = body.payments || {};
  const remark = body.remark || 'new';
  // Cancel keeps whatever exact contract_no it was created against, unnormalized — see
  // requestController.js's createRequest for why. linked_master_id is likewise just
  // trusted as sent, same reasoning.
  const referContractNo = remark === 'cancel' ? (body.referContractNo || null) : normalizeReferContractNo(body.referContractNo);
  const linkedMasterId = body.linkedMasterId || null;

  await exec(
    `UPDATE contract_requests SET
       status = :status, confidentiality = :confidentiality, contract_type_id = :contractTypeId,
       contract_purpose = :contractPurpose, other_specify = :otherSpecify, supplier_name = :supplierName,
       contract_year = YEAR(:requestDate), request_date = :requestDate, delivery_date = :deliveryDate,
       location = :location, warranty_period = :warrantyPeriod, refer_contract_no = :referContractNo,
       linked_master_id = :linkedMasterId,
       brief_description = :briefDescription, action_background = :actionBackground, action_detail = :actionDetail,
       new_contract_start_date = :newContractStartDate, new_contract_end_date = :newContractEndDate,
       action_effective_date = :actionEffectiveDate, cancel_reason = :cancelReason,
       total_net_price = :totalNetPrice, vat = :vat,
       currency = :currency, trade_term = :tradeTerm, payment_other = :paymentOther,
       payment1 = :payment1, payment2 = :payment2, payment3 = :payment3, payment4 = :payment4,
       payment5 = :payment5, payment6 = :payment6, payment7 = :payment7, payment8 = :payment8,
       requestor_name = :requestorName, requestor_section = :requestorSection, remark = :remark,
       approver1_em_id = :approver1EmId, approver2_em_id = :approver2EmId, approver3_em_id = :approver3EmId,
       updated_by = :emId, updated_name = :updatedName, updated_at = NOW()
     WHERE id = :id`,
    {
      id,
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
      // component in ApprovalSection.jsx (contract-web).
      approver1EmId: approvers[2] || null,
      approver2EmId: approvers[1] || null,
      approver3EmId: approvers[0] || null,
      emId: body.emId || null,
      updatedName: body.updatedName || null,
    },
    options
  );

  await upsertDocuments(id, body.documents, body.emId, options);
  await upsertActionFiles(id, body.actionFiles, body.emId, options);
}

// Upserts the document checklist + attached-file links for one request. Used both
// on creation (nothing exists yet, so every type is a fresh insert) and on every
// subsequent edit (existing checklist rows are updated in place, new files linked).
export async function upsertDocuments(id, documents, emId, options = {}) {
  for (const [key, documentType] of Object.entries(DOCUMENT_TYPE_KEYS)) {
    const doc = documents?.[key];
    if (!doc) continue;

    const existingDoc = await select(
      `SELECT id FROM contract_request_documents
       WHERE contract_request_id = :id AND document_type = :documentType AND active = 1 AND deleted_at IS NULL`,
      { id, documentType },
      options
    );

    let documentId;
    if (existingDoc.length) {
      documentId = existingDoc[0].id;
      await exec(
        `UPDATE contract_request_documents SET checked = :checked, updated_at = NOW(), updated_by = :emId WHERE id = :documentId`,
        { documentId, checked: doc.checked ? 1 : 0, emId: emId || null },
        options
      );
    } else {
      documentId = await insert(
        `INSERT INTO contract_request_documents (contract_request_id, document_type, checked, created_by)
         VALUES (:id, :documentType, :checked, :emId)`,
        { id, documentType, checked: doc.checked ? 1 : 0, emId: emId || null },
        options
      );
    }

    const linked = await select(
      `SELECT file_upload_id AS fileUploadId FROM contract_request_document_files
       WHERE contract_request_document_id = :documentId AND active = 1 AND deleted_at IS NULL`,
      { documentId },
      options
    );
    const alreadyLinked = new Set(linked.map(r => r.fileUploadId));
    for (const file of doc.files || []) {
      if (alreadyLinked.has(file.id)) continue;
      await exec(
        `INSERT INTO contract_request_document_files (contract_request_document_id, file_upload_id, created_by)
         VALUES (:documentId, :fileUploadId, :emId)`,
        { documentId, fileUploadId: file.id, emId: emId || null },
        options
      );
    }
  }
}

// Append-only file attachments for one request's "___ Information" section — same idiom
// as upsertDocuments above, minus the per-type checklist row since these files aren't
// categorized, just a flat list (see contract_request_action_files in schema.sql).
// Removing a file is handled client-side by soft-deleting the file_uploads row directly
// (same as Related Contract Document's removeFile) rather than deactivating the link —
// the join in requestController.getRequest already filters on file_uploads.active.
export async function upsertActionFiles(id, files, emId, options = {}) {
  const linked = await select(
    `SELECT file_upload_id AS fileUploadId FROM contract_request_action_files
     WHERE contract_request_id = :id AND active = 1 AND deleted_at IS NULL`,
    { id },
    options
  );
  const alreadyLinked = new Set(linked.map(r => r.fileUploadId));
  for (const file of files || []) {
    if (alreadyLinked.has(file.id)) continue;
    await exec(
      `INSERT INTO contract_request_action_files (contract_request_id, file_upload_id, created_by)
       VALUES (:id, :fileId, :emId)`,
      { id, fileId: file.id, emId: emId || null },
      options
    );
  }
}

// Requester iff the person acting is the same em_id that originally created the
// request (e.g. editing/resubmitting from My Job); anyone else (an approver, legal,
// etc.) is Others.
export function computeCommentRole(requestCreatedBy, actorEmId) {
  return actorEmId && requestCreatedBy === actorEmId ? 'Requester' : 'Others';
}

export async function insertComment(id, comment, commenterName, role, emId, options = {}) {
  await exec(
    `INSERT INTO contract_request_comments (contract_request_id, comment, commenter_name, role, created_by, updated_by, updated_at)
     VALUES (:id, :comment, :commenterName, :role, :emId, :emId, NOW())`,
    { id, comment, commenterName: commenterName || null, role, emId: emId || null },
    options
  );
}

// ---------------------------------------------------------------------------
// Contract Request email notifications (services/contractEmail.service.js) — data
// assembly shared by requestController's createRequest (Send Request -> notify
// Approver 1) and approvalController's approveRequest (Approve -> notify whichever
// approver is next). Both controllers already work with the exact same body shape
// (supplierName/contractTypeId/contractPurpose/... — see updateEditableFields above),
// so this is the one place that turns that body into the requestType-specific data
// shape sendContractRequestEmail expects, instead of duplicating it per controller.
// ---------------------------------------------------------------------------

const REQUEST_TYPE_BY_REMARK = {
  new: 'NEW',
  renew: 'RENEW',
  amend: 'AMENDMENT',
  terminate: 'TERMINATION',
  claim: 'CLAIM_NOTE',
  cancel: 'CANCEL',
};

// "1 July 2026" — matches the spec's own example formatting. No existing friendly-date
// formatter exists elsewhere in this backend (app/utils/dateUtils.js's toDateOnly is
// YYYY-MM-DD, for feeding the New Request form, not for display in an email).
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatEmailDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// "500,000 JPY" — total_net_price (a plain decimal) plus currency, comma-grouped.
function formatNetPrice(totalNetPrice, currency) {
  if (totalNetPrice == null || totalNetPrice === '') return '';
  const num = Number(totalNetPrice);
  const formatted = Number.isNaN(num) ? String(totalNetPrice) : num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

// Returns null for a remark with no notification email defined (e.g. 'waived', which
// only ever happens via Waive — see approvalController.js — not a fresh Send
// Request/Approve call this is invoked from).
export async function buildContractEmailData({ body, remark, contractNo, requestorName, approverEmail, cc, bcc, linkedMasterId, systemUrl }) {
  const requestType = REQUEST_TYPE_BY_REMARK[remark];
  if (!requestType) return null;

  let contractType = '';
  if (body.contractTypeId) {
    const rows = await select(`SELECT name FROM contract_types WHERE id = :id`, { id: body.contractTypeId });
    contractType = rows[0]?.name || '';
  }

  // "{name} / {section}" — e.g. "Thitinun Chaychayanon / Legal", matching the spec's
  // own example ("Kamon nate/Legal") once "Legal" is read as the requestor's section,
  // not a role label. Falls back to the bare name when section is somehow blank.
  const requestorNameValue = requestorName || body.requestorName || '';
  const requestorSection = body.requestorSection || '';
  const base = {
    requestType,
    contractNo: contractNo || '',
    supplierName: body.supplierName || '',
    contractType,
    requestor: requestorSection ? `${requestorNameValue} / ${requestorSection}` : requestorNameValue,
    approverEmail,
    systemUrl,
  };
  if (cc && cc.length) base.cc = cc;
  if (bcc && bcc.length) base.bcc = bcc;

  switch (requestType) {
    case 'NEW':
      return {
        ...base,
        purpose: body.briefDescription || '',
        netPrice: formatNetPrice(body.totalNetPrice, body.currency),
        delivery: formatEmailDate(body.deliveryDate),
      };
    case 'RENEW': {
      // Original Period is read fresh from the referenced contract (linked_master_id),
      // same "never drift out of sync" reasoning requestController.js's getRequest
      // already uses for this exact lookup — just its expire_date here, matching the
      // spec's own single-date example rather than a full start-end range.
      let originalPeriod = '';
      if (linkedMasterId) {
        const rows = await select(`SELECT expire_date FROM contract_requests WHERE id = :id`, { id: linkedMasterId });
        originalPeriod = formatEmailDate(rows[0]?.expire_date);
      }
      return {
        ...base,
        purpose: body.actionBackground || '',
        originalPeriod,
        newPeriod: formatEmailDate(body.newContractEndDate),
      };
    }
    case 'AMENDMENT':
      return {
        ...base,
        reason: body.actionBackground || '',
        amendedDetail: body.actionDetail || '',
        effectiveDate: formatEmailDate(body.actionEffectiveDate),
      };
    case 'TERMINATION':
      return {
        ...base,
        reason: body.actionBackground || '',
        effectiveDate: formatEmailDate(body.actionEffectiveDate),
      };
    case 'CLAIM_NOTE':
      return {
        ...base,
        reason: body.actionBackground || '',
        claimDetail: body.actionDetail || '',
      };
    case 'CANCEL':
      return {
        ...base,
        purpose: body.briefDescription || '',
        reason: body.cancelReason || '',
      };
    default:
      return null;
  }
}

// Single entry point requestController.js (Send Request -> Approver 1) and
// approvalController.js (Approve -> next approver) both call after their own
// transaction has already committed. Resolves emId -> email (employeeLookup.service.js),
// builds the requestType-specific data (buildContractEmailData above), then calls
// sendContractRequestEmail (contractEmail.service.js) — the one place both controllers
// actually invoke it from, so neither builds HTML or touches the transporter itself.
//
// Deliberately swallows its own errors (logged, never rethrown): a notification
// failure (SMTP down, no email on file for that em_id, ...) must never fail the
// approval/send-request action whose transaction already committed successfully —
// sendContractRequestEmail itself still never swallows a real send failure, this is
// only the outer boundary stopping that from reaching the controller's response.
export async function notifyApproverForContractRequest(emId, { body, remark, contractNo, requestorName, linkedMasterId, systemUrl }) {
  if (!emId) return;
  try {
    const approverEmail = await getEmployeeEmail(emId);
    if (!approverEmail) {
      console.error(`Contract email sending failed: no email on file for approver em_id "${emId}".`);
      return;
    }
    const emailData = await buildContractEmailData({ body, remark, contractNo, requestorName, approverEmail, linkedMasterId, systemUrl });
    if (!emailData) return; // e.g. remark === 'waived' — no notification email defined for it
    await sendContractRequestEmail(emailData);
  } catch (error) {
    console.error('Contract request approver notification failed:', error);
  }
}
