import { exec, select, insert } from '../config/mysql.js';

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

// Updates every editable field on a contract_requests row. `status` is passed in
// (rather than read from `body`) because callers compute it themselves from their
// own workflow rules — this function never decides a status transition, it only
// persists whatever status the caller already decided on.
export async function updateEditableFields(id, body, status, options = {}) {
  const approvers = body.approvers || [];
  const payments = body.payments || {};

  await exec(
    `UPDATE contract_requests SET
       status = :status, confidentiality = :confidentiality, contract_type_id = :contractTypeId,
       contract_purpose = :contractPurpose, other_specify = :otherSpecify, supplier_name = :supplierName,
       contract_year = YEAR(:requestDate), request_date = :requestDate, delivery_date = :deliveryDate,
       location = :location, warranty_period = :warrantyPeriod, refer_contract_no = :referContractNo,
       brief_description = :briefDescription, total_net_price = :totalNetPrice, vat = :vat,
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
      referContractNo: body.referContractNo || null,
      briefDescription: body.briefDescription || null,
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
      remark: body.remark || 'new',
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
