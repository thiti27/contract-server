import { select, exec, insert } from '../../config/mysql.js';
import { GLOBAL_DOC_KEYS } from '../utils/statusGroups.js';

const DOC_LABELS = {
  contract_procedure: 'Contract Procedure',
  check_sheet: 'Check Sheet',
  user_manual: 'User Manual',
};

// ---------------------------------------------------------------------------
// Global documents — singleton files not tied to any contract type/purpose:
// "Contract Procedure" (Home page), "Check Sheet" (every row on Download Form).
// One row per doc_key; uploading again replaces the existing row instead of
// creating a duplicate.
// ---------------------------------------------------------------------------
export async function getGlobalDocuments(_req, res) {
  const rows = await select(
    `SELECT doc_key AS docKey, file_path AS filePath, file_id AS fileId, file_name AS fileName,
            extension, updated_by_name AS updatedByName, updated_at AS updatedAt, created_at AS createdAt
     FROM global_documents WHERE active = 1 AND deleted_at IS NULL`
  );
  const byKey = Object.fromEntries(rows.map(r => [r.docKey, r]));

  res.json({
    // Kept flat for existing consumers (Home's Contract Procedure/User Manual links,
    // Download Form's Check Sheet link) that only ever needed a ready-made URL.
    contractProcedurePath: byKey.contract_procedure?.filePath || null,
    checkSheetPath: byKey.check_sheet?.filePath || null,
    userManualPath: byKey.user_manual?.filePath || null,
    // Full listing (file name, uploader, date) for Settings > Contract Type's
    // document management UI.
    documents: GLOBAL_DOC_KEYS.map(key => {
      const row = byKey[key];
      return {
        docKey: key,
        label: DOC_LABELS[key] || key,
        filePath: row?.filePath || null,
        fileId: row?.fileId || null,
        fileName: row?.fileName ? `${row.fileName}${row.extension || ''}` : null,
        updatedByName: row?.updatedByName || null,
        updatedAt: row?.updatedAt || row?.createdAt || null,
      };
    }),
  });
}

export async function setGlobalDocument(req, res) {
  const { key } = req.params;
  if (!GLOBAL_DOC_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid document key.' });

  const { fileId, emId, updatedName } = req.body || {};
  if (!fileId) return res.status(400).json({ message: 'File is required.' });
  const uploaded = await select(
    `SELECT id, file_name AS fileName, extension FROM file_uploads WHERE id = :fileId AND active = 1 AND deleted_at IS NULL`,
    { fileId }
  );
  if (!uploaded.length) return res.status(400).json({ message: 'Uploaded file not found.' });
  const file = uploaded[0];

  const filePath = `/api/uploads/${fileId}/download`;
  const existing = await select(`SELECT id FROM global_documents WHERE doc_key = :key AND deleted_at IS NULL`, { key });
  const replacements = {
    filePath,
    fileId,
    fileName: file.fileName,
    extension: file.extension,
    emId: emId || null,
    updatedName: updatedName || null,
  };

  if (existing.length) {
    // created_by/created_at are intentionally untouched here — only updated_* moves.
    await exec(
      `UPDATE global_documents
       SET file_path = :filePath, file_id = :fileId, file_name = :fileName, extension = :extension,
           active = 1, updated_at = NOW(), updated_by = :emId, updated_by_name = :updatedName
       WHERE id = :id`,
      { ...replacements, id: existing[0].id }
    );
  } else {
    await insert(
      `INSERT INTO global_documents
         (doc_key, file_path, file_id, file_name, extension, created_by, updated_by, updated_by_name, updated_at)
       VALUES (:key, :filePath, :fileId, :fileName, :extension, :emId, :emId, :updatedName, NOW())`,
      { ...replacements, key }
    );
  }

  res.status(201).json({ docKey: key, filePath });
}
