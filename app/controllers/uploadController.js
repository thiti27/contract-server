import path from 'node:path';
import { select, exec, insert } from '../../config/mysql.js';
import { uploadsDir } from '../middleware/upload.js';
import { hasConfidentialAccess } from '../../helpers/contractRequestHelper.js';

// ---------------------------------------------------------------------------
// File uploads
// ---------------------------------------------------------------------------
// Busboy (which multer runs on) decodes every multipart field — including the
// filename — as latin1 by default, per the old RFC 2388 spec for this field. Modern
// browsers actually send the filename as raw UTF-8 bytes, not latin1, so a Thai (or
// any non-ASCII) name comes out of multer as mojibake unless we undo that: take the
// bytes back out as latin1 and re-decode them as utf8. Pure-ASCII names are byte-
// identical in both encodings, so this is a safe no-op for English filenames too.
function decodeOriginalName(originalname) {
  return Buffer.from(originalname, 'latin1').toString('utf8');
}

export async function createUploads(req, res) {
  const records = [];
  for (const file of req.files || []) {
    const originalName = decodeOriginalName(file.originalname);
    const extension = path.extname(originalName);
    const fileName = path.basename(originalName, extension);
    const id = await insert(
      `INSERT INTO file_uploads (storage_name, file_name, extension, created_by) VALUES (:storageName, :fileName, :extension, 'app')`,
      { storageName: file.filename, fileName, extension }
    );
    records.push({ id, fileName, extension, active: true });
  }
  res.status(201).json(records);
}

// A file_upload row itself carries no owner/confidentiality info (created_by is always
// the literal string 'app' — see createUploads above) — the only way to know whether
// downloading this file requires a confidentiality check is to trace it back to
// whichever contract_requests row(s) actually reference it: the signed PDF (a direct
// column), an Action Info attachment, or a Documents-section attachment. A file that
// isn't linked to anything yet (freshly uploaded, form not saved yet — see
// ActionInfoSection.jsx/DocumentsSection.jsx, which let you download immediately after
// selecting) can't be tied to any contract's confidentiality, so it's allowed through.
async function findOwningContracts(fileId) {
  return select(
    `SELECT confidentiality, created_by, approver1_em_id, approver2_em_id, approver3_em_id
     FROM contract_requests
     WHERE signed_file_id = :fileId AND deleted_at IS NULL

     UNION

     SELECT cr.confidentiality, cr.created_by, cr.approver1_em_id, cr.approver2_em_id, cr.approver3_em_id
     FROM contract_request_action_files craf
     JOIN contract_requests cr ON cr.id = craf.contract_request_id AND cr.deleted_at IS NULL
     WHERE craf.file_upload_id = :fileId AND craf.active = 1 AND craf.deleted_at IS NULL

     UNION

     SELECT cr.confidentiality, cr.created_by, cr.approver1_em_id, cr.approver2_em_id, cr.approver3_em_id
     FROM contract_request_document_files crdf
     JOIN contract_request_documents crd ON crd.id = crdf.contract_request_document_id AND crd.active = 1 AND crd.deleted_at IS NULL
     JOIN contract_requests cr ON cr.id = crd.contract_request_id AND cr.deleted_at IS NULL
     WHERE crdf.file_upload_id = :fileId AND crdf.active = 1 AND crdf.deleted_at IS NULL`,
    { fileId }
  );
}

export async function downloadUpload(req, res) {
  const rows = await select(
    `SELECT storage_name AS storageName, file_name AS fileName, extension FROM file_uploads WHERE id = :id AND active = 1 AND deleted_at IS NULL`,
    { id: req.params.id }
  );
  const record = rows[0];
  if (!record) return res.status(404).json({ message: 'File not found' });

  const owningContracts = await findOwningContracts(req.params.id);
  if (owningContracts.some(contract => !hasConfidentialAccess(contract, req.user))) {
    return res.status(403).json({ message: 'You do not have permission to download this file.' });
  }

  res.download(path.join(uploadsDir, record.storageName), `${record.fileName}${record.extension}`);
}

// Soft delete only — matches the deleted_at/deleted_by audit convention used across the schema.
export async function deleteUpload(req, res) {
  const rows = await select(`SELECT id FROM file_uploads WHERE id = :id AND deleted_at IS NULL`, { id: req.params.id });
  if (!rows.length) return res.status(404).json({ message: 'File not found' });
  await exec(`UPDATE file_uploads SET active = 0, deleted_at = NOW(), deleted_by = 'app' WHERE id = :id`, { id: req.params.id });
  res.json({ success: true });
}
