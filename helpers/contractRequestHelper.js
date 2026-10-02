import { exec, select, insert } from '../config/mysql.js';
import { sendContractRequestEmail } from '../app/services/contractEmail.service.js';
import { getEmployeeEmail } from '../app/services/employeeLookup.service.js';
import config from '../config/config.js';

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
// Review, View) fetches a contract's detail through. Only `admin` gets a blanket pass
// on top of the 3 conditions All Job/Home already surface in the UI (creator, `view`
// permission, one of the 3 approvers) — `legal` alone is deliberately NOT one of them
// (see the inline comment on the check itself below): a legal reviewer who needs to
// open a HIGH CONFIDENTIAL contract they aren't the creator/approver of still needs
// `view` set explicitly, same as anyone else.
//
// A non-confidential row is always accessible. approver slots that are null/undefined/
// empty never count as a match, and em_ids are compared as strings so a numeric vs
// string mismatch can't accidentally deny (or allow) access.
export function hasConfidentialAccess(row, user) {
  if (!row?.confidentiality) return true;
  // Being `legal` (or `admin`) is a role, not by itself a grant to read someone else's
  // HIGH CONFIDENTIAL contract — same 3 conditions as everyone else (creator/`view`/one
  // of the 3 approvers). A legal reviewer who genuinely needs to see confidential rows
  // needs `view` set explicitly, same as any other user.
  if (user?.admin) return true;
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
       contract_purpose = :contractPurpose, other_specify = :otherSpecify,
       construction_risk_level = :constructionRiskLevel, construction_risk_score = :constructionRiskScore,
       construction_risk_answers = :constructionRiskAnswers,
       supplier_name = :supplierName,
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

// requestType falls back to 'OTHER' for a remark with no type-specific field shape of
// its own (currently just 'waived') rather than returning null — a row's remark
// becomes 'waived' permanently once ANY waive happens (approvalController.js's
// waiveRequest or legalController.js's waiveLegalRequest both overwrite it), so a
// Signed/Drafted row Legal later Comments on, Terminates, or Cancels can easily still
// carry remark='waived' at that point; buildRequestorNotificationData's callers
// (notifyRequestorWaived/notifyRequestorLegalComment) still need SOME rows to show, not
// a silently skipped email. 'OTHER' isn't a case in the switch below, so it falls
// through to the shared `base` object only — buildDisplayRows' own `default` branch
// then renders that as Supplier/Contract Type/Requestor, the fields every remark has in
// common. This never reaches sendContractRequestEmail's own TEMPLATES/SUBJECTS lookup
// (those key off the literal 'APPROVED'/'RETURN'/'WAIVED'/'LEGAL_COMMENT' each notify*
// function hardcodes itself, not this requestType), so there's no risk of an
// "Unsupported contract request type: OTHER" error reaching a real send.
export async function buildContractEmailData({ body, remark, contractNo, requestorName, approverEmail, cc, bcc, linkedMasterId, systemUrl }) {
  const requestType = REQUEST_TYPE_BY_REMARK[remark] || 'OTHER';

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
      // 'OTHER' (see this function's own comment above) — no type-specific fields to
      // add, `base` alone is enough for buildDisplayRows' generic fallback.
      return base;
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
export async function notifyApproverForContractRequest(emId, { body, remark, contractNo, requestorName, linkedMasterId, systemUrl, contractRequestId }) {
  if (!emId) return;
  try {
    const approverEmail = await getEmployeeEmail(emId);
    if (!approverEmail) {
      console.error(`Contract email sending failed: no email on file for approver em_id "${emId}".`);
      return;
    }
    const emailData = await buildContractEmailData({ body, remark, contractNo, requestorName, approverEmail, linkedMasterId, systemUrl });
    if (!emailData) return; // e.g. remark === 'waived' — no notification email defined for it
    await sendContractRequestEmail({ ...emailData, contractRequestId });
  } catch (error) {
    console.error('Contract request approver notification failed:', error);
  }
}

// Every admin_users row flagged `legal` (active, not deleted) — no existing query
// anywhere already builds this list (there was no Legal-notification email before),
// so this is new. Resolves each em_id the same way an approver's em_id is resolved
// (getEmployeeEmail against eds_db.employee), never assumes admin_users itself has an
// email column (it doesn't).
async function getLegalEmails(options = {}) {
  const rows = await select(`SELECT em_id FROM admin_users WHERE legal = 1 AND active = 1 AND deleted_at IS NULL`, {}, options);
  const emails = await Promise.all(rows.map(row => getEmployeeEmail(row.em_id)));
  return emails.filter(Boolean);
}

// "Any question, please contact {name1} ({ext1}), {name2} ({ext2})" — legalComment
// .template.js's own contact line, sorted by em_id ascending per that page's own
// requirement. Only active, non-deleted Legal users count (same WHERE as
// getLegalEmails above); a user with no ext on file just shows their name alone
// rather than a blank "()" pair.
async function getActiveLegalContactsLine(options = {}) {
  const rows = await select(
    `SELECT first_name AS firstName, ext FROM admin_users
     WHERE legal = 1 AND active = 1 AND deleted_at IS NULL
     ORDER BY em_id ASC`,
    {},
    options
  );
  return rows.map(r => (r.ext ? `${r.firstName} (${r.ext})` : r.firstName)).join(', ');
}

// Same labels ContractNoCell.jsx/RemarkBadge.jsx (contravct-web) already show next to
// a Contract No. elsewhere in the app — kept as an independent local copy rather than
// importing across the frontend/backend boundary (this codebase's existing
// controller-to-controller isolation convention, same reasoning as request
// Controller.js's own EDIT_STAGE_COLUMN comment).
const REMARK_LABELS = {
  new: 'New Contract',
  renew: 'Renew Contract',
  amend: 'Amend Contract',
  claim: 'Claim Note',
  terminate: 'Terminate',
  cancel: 'Cancel Contract',
};

// The row list each of the 6 existing *.template.js files already hardcodes for its
// own "waiting for approval" email — centralized here so the Approved/Return
// notifications below (which apply to every remark type, not just 'new') can show the
// same fields per type without duplicating that mapping a second time. `data` is
// whatever buildContractEmailData already returned for that requestType — this only
// arranges those same fields into {label, value} rows, no new data.
function buildDisplayRows(requestType, data) {
  switch (requestType) {
    case 'NEW':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Purpose', value: data.purpose, caption: '(Brief Description & Background)' },
        { label: 'Net Price', value: data.netPrice },
        { label: 'Delivery', value: data.delivery },
        { label: 'Requestor', value: data.requestor },
      ];
    case 'RENEW':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Purpose', value: data.purpose },
        { label: 'Original Period', value: data.originalPeriod },
        { label: 'New Period', value: data.newPeriod },
        { label: 'Requestor', value: data.requestor },
      ];
    case 'AMENDMENT':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Reason', value: data.reason },
        { label: 'Amended Detail', value: data.amendedDetail },
        { label: 'Effective Date', value: data.effectiveDate },
        { label: 'Requestor', value: data.requestor },
      ];
    case 'TERMINATION':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Reason', value: data.reason },
        { label: 'Effective Date', value: data.effectiveDate },
        { label: 'Requestor', value: data.requestor },
      ];
    case 'CLAIM_NOTE':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Reason', value: data.reason },
        { label: 'Claim Detail', value: data.claimDetail },
        { label: 'Requestor', value: data.requestor },
      ];
    case 'CANCEL':
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Purpose', value: data.purpose },
        { label: 'Reason', value: data.reason },
        { label: 'Requestor', value: data.requestor },
      ];
    default:
      return [
        { label: 'Supplier', value: data.supplierName },
        { label: 'Contract Type', value: data.contractType },
        { label: 'Requestor', value: data.requestor },
      ];
  }
}

// Shared by notifyRequestorApproved/notifyRequestorReturned below — both need the
// Requestor's own email, resolved from a fresh contract_types lookup + the same
// per-remark field computation buildContractEmailData already does for the "waiting
// for approval" emails (purpose/netPrice/delivery for NEW, originalPeriod/newPeriod
// for RENEW, ...), just addressed TO the Requestor instead of an approver. Returns
// null (never throws) when there's nothing to send to — email addresses are best-
// effort, same as everywhere else in this file.
async function buildRequestorNotificationData(existing, body, { contractNo, systemUrl }) {
  const requestorEmail = await getEmployeeEmail(existing.created_by);
  if (!requestorEmail) {
    console.error(`Contract email sending failed: no email on file for requestor em_id "${existing.created_by}".`);
    return null;
  }

  // remark can legitimately be 'waived' here (see buildContractEmailData's own
  // comment) — buildContractEmailData now always returns real data (falling back to
  // requestType 'OTHER' + the generic Supplier/Contract Type/Requestor rows) rather
  // than null, so this never silently drops the notification.
  const emailData = await buildContractEmailData({
    body,
    remark: existing.remark,
    contractNo,
    requestorName: existing.requestor_name,
    approverEmail: requestorEmail,
    linkedMasterId: existing.linked_master_id,
    systemUrl,
  });
  if (!emailData) return null;

  return { requestType: emailData.requestType, requestorEmail, emailData, rows: buildDisplayRows(emailData.requestType, emailData) };
}

// Approver 3's Approve completing any remark's chain (status -> 'Drafted',
// approvalController.js) — the one contract-request email sent TO the Requestor
// instead of an approver, CC'd to Section Head (the 3 approvers) and every Legal
// user, with a Download Contract Documents link instead of an attachment (see
// approvedContract.template.js). A Cancel completion never actually reaches this —
// its own row flips straight to 'Cancelled', never 'Drafted' (see
// approvalController.js's isCancelCompletion), so it never calls this at all.
//
// Same "never fail the caller, swallow and log" contract as
// notifyApproverForContractRequest above.
export async function notifyRequestorApproved(existing, body, { contractNo, systemUrl, contractRequestId }) {
  try {
    const notification = await buildRequestorNotificationData(existing, body, { contractNo, systemUrl });
    if (!notification) return;
    const { emailData, requestorEmail, rows } = notification;

    // De-duplicated twice over: approverEmIds first (the same em_id often fills more
    // than one approver slot in test/seed data), then the final cc list again (an
    // approver who's also a Legal user — a real, valid combination — would otherwise
    // get CC'd on the same address once from each list).
    const approverEmIds = [...new Set([existing.approver1_em_id, existing.approver2_em_id, existing.approver3_em_id].filter(Boolean))];
    const [approverEmails, legalEmails] = await Promise.all([Promise.all(approverEmIds.map(getEmployeeEmail)), getLegalEmails()]);
    const cc = [...new Set([...approverEmails.filter(Boolean), ...legalEmails])];

    // The frontend never actually sends `systemUrl` today (every caller passes
    // body.systemUrl, which is always undefined) — sendContractRequestEmail falls back
    // to config.systemUrl internally for the "Contract Online System" link text, but
    // documentsUrl is built here, before that fallback runs, so it needs the same
    // fallback applied directly or it'd build a bare "/contract-documents/..." path.
    const documentsBaseUrl = (systemUrl || config.systemUrl || '').replace(/\/$/, '');

    await sendContractRequestEmail({
      requestType: 'APPROVED',
      supplierName: body.supplierName || '',
      requestor: emailData.requestor,
      contractNo: contractNo || '',
      // Contract No. only ever shows on the Approved email (by Return time no number
      // has been minted yet — see notifyRequestorReturned) — prepended here rather
      // than folded into buildDisplayRows, which every remark type otherwise shares
      // unchanged between Approved and Return. Same caption drop as Return/Waived —
      // the "(Brief Description & Background)" caption under Purpose is redundant now
      // the contract's already Drafted.
      rows: [
        { label: 'Contract No.', value: `${contractNo || ''}${REMARK_LABELS[existing.remark] ? ` (${REMARK_LABELS[existing.remark]})` : ''}` },
        ...rows.map(({ caption, ...row }) => row),
      ],
      approverEmail: requestorEmail,
      cc,
      systemUrl,
      documentsUrl: `${documentsBaseUrl}/contract-documents/${encodeURIComponent(contractNo || '')}`,
      contractRequestId,
    });
  } catch (error) {
    console.error('Contract request requestor (Approved) notification failed:', error);
  }
}

// An approver's Return completing a review pass (status -> 'Returned',
// approvalController.js's returnRequest) — sent to the Requestor with the approver's
// own comment (split into a numbered list, one item per non-empty line they typed) so
// they know exactly what to fix before resubmitting. No CC (unlike Approved above —
// nothing's actually finished yet, this stays between the requestor and whoever just
// returned it), no Contract No. row (none has been minted at this point in any
// remark's lifecycle — see notifyRequestorApproved's own comment on that).
export async function notifyRequestorReturned(existing, body, { systemUrl, contractRequestId }) {
  try {
    const notification = await buildRequestorNotificationData(existing, body, { contractNo: existing.contract_no, systemUrl });
    if (!notification) return;
    const { emailData, requestorEmail, rows } = notification;

    await sendContractRequestEmail({
      requestType: 'RETURN',
      supplierName: body.supplierName || '',
      requestor: emailData.requestor,
      // Unlike Approved/Waived, the Return email drops the "(Brief Description &
      // Background)" caption under Purpose — the approver's own comment already
      // explains what needs fixing, so it doesn't need to be restated here.
      rows: rows.map(({ caption, ...row }) => row),
      comments: splitComment(body.comment),
      approverEmail: requestorEmail,
      systemUrl,
      contractRequestId,
    });
  } catch (error) {
    console.error('Contract request requestor (Return) notification failed:', error);
  }
}

// Shared by notifyRequestorReturned above and notifyRequestorWaived below — both show
// the acting person's comment as one numbered list item per non-empty line they typed.
function splitComment(comment) {
  return String(comment || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

// A Manager (Approver 3, approvalController.js's waiveRequest) or Legal
// (legalController.js's waiveLegalRequest) clicking Waive — the request skips
// straight to Signed. Sent to the Requestor, CC'd to Section Head (the 3 approvers)
// and every Legal user — same CC shape as Approved above — with the waive comment as
// plain blue lines (splitComment above). The table is buildDisplayRows' own fields for
// whichever remark this request is, minus Original/New Period (RENEW-only) and the
// "(Brief Description & Background)" caption under Purpose (the waive comment already
// explains the reason, same call already made for Return above) — and with no separate
// Contract No. row (contractNo still drives the email's own subject line via
// buildSubject, just not duplicated as a table row here).
//
// Same "never fail the caller, swallow and log" contract as every other notify*
// function in this file.
export async function notifyRequestorWaived(existing, body, { contractNo, waivedBy, systemUrl, contractRequestId }) {
  try {
    const notification = await buildRequestorNotificationData(existing, body, { contractNo, systemUrl });
    if (!notification) return;
    const { emailData, requestorEmail, rows } = notification;

    // De-duplicated twice over — same reasoning as notifyRequestorApproved's own cc
    // above: approverEmIds first, then the final merged cc list again (an approver
    // who's also a Legal user would otherwise be CC'd twice on the same address).
    const approverEmIds = [...new Set([existing.approver1_em_id, existing.approver2_em_id, existing.approver3_em_id].filter(Boolean))];
    const [approverEmails, legalEmails] = await Promise.all([Promise.all(approverEmIds.map(getEmployeeEmail)), getLegalEmails()]);
    const cc = [...new Set([...approverEmails.filter(Boolean), ...legalEmails])];

    await sendContractRequestEmail({
      requestType: 'WAIVED',
      supplierName: body.supplierName || '',
      requestor: emailData.requestor,
      contractNo: contractNo || '',
      waivedBy,
      rows: rows
        .filter(({ label }) => label !== 'Original Period' && label !== 'New Period')
        .map(({ caption, ...row }) => row),
      comments: splitComment(body.comment),
      approverEmail: requestorEmail,
      cc,
      systemUrl,
      contractRequestId,
    });
  } catch (error) {
    console.error('Contract request requestor (Waived) notification failed:', error);
  }
}

// A legal user clicking Comment in Legal Review Mode (Legal > Waiting,
// legalController.js's commentOnLegalRequest) — sent to the Requestor, CC'd to the 3
// approvers only (never Legal itself — Legal is the sender, their own contact info is
// listed inside the email body instead via getActiveLegalContactsLine). `body.comment`
// is the exact comment just submitted — this action IS that comment's creation, so
// there's no separate "fetch the latest one" query needed.
//
// Also reused by legalController.js's Terminate action (same email, same recipients)
// with `remarkLabel` explicitly passed as 'Terminate' — overriding what the target
// row's own remark would otherwise resolve to (e.g. a Terminate on an already-Signed
// 'new' contract should read "Legal Comment for Terminate", not "...for New
// Contract"). The rows table itself is untouched by this override — it still reflects
// existing.remark's real field shape (Purpose/Net Price/Delivery for 'new', etc.),
// only the display label changes.
//
// Same "never fail the caller, swallow and log" contract as every other notify*
// function in this file.
export async function notifyRequestorLegalComment(existing, body, { systemUrl, remarkLabel, contractRequestId } = {}) {
  try {
    const notification = await buildRequestorNotificationData(existing, body, { contractNo: existing.contract_no, systemUrl });
    if (!notification) return;
    const { emailData, requestorEmail, rows } = notification;

    const approverEmIds = [...new Set([existing.approver1_em_id, existing.approver2_em_id, existing.approver3_em_id].filter(Boolean))];
    const [approverEmails, legalContactsLine] = await Promise.all([
      Promise.all(approverEmIds.map(getEmployeeEmail)),
      getActiveLegalContactsLine(),
    ]);

    await sendContractRequestEmail({
      requestType: 'LEGAL_COMMENT',
      supplierName: body.supplierName || '',
      requestor: emailData.requestor,
      contractNo: existing.contract_no || '',
      remarkLabel: remarkLabel || REMARK_LABELS[existing.remark] || existing.remark,
      // Same caption drop as Return/Waived — the comment already explains itself.
      rows: rows.map(({ caption, ...row }) => row),
      comments: splitComment(body.comment),
      legalContactsLine,
      approverEmail: requestorEmail,
      cc: approverEmails.filter(Boolean),
      systemUrl,
      contractRequestId,
    });
  } catch (error) {
    console.error('Contract request requestor (Legal Comment) notification failed:', error);
  }
}
