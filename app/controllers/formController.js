import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Download Form templates (Home > DOWNLOAD FORM page) — tabs are contract_types
// (ordered by id), each tab's items are that type's active purposes. A purpose
// still shows up here even with no file attached yet (files.eng/files.tha are
// just null) — the item list mirrors Settings' active contract_types/purposes
// directly; only the download buttons depend on whether a file was attached.
// ---------------------------------------------------------------------------
export async function listForms(_req, res) {
  const rows = await select(
    `SELECT
       ct.id AS typeId, ct.name AS type, ct.description AS typeDescription,
       ctp.id AS itemId, ctp.purpose_text AS itemName, ctp.description AS itemDescription,
       fi.file_eng_path AS fileEngPath, fi.file_tha_path AS fileThaPath
     FROM contract_type_purposes ctp
     JOIN contract_types ct ON ct.id = ctp.contract_type_id AND ct.deleted_at IS NULL AND ct.active = 1
     LEFT JOIN form_items fi ON fi.contract_type_purpose_id = ctp.id AND fi.active = 1 AND fi.deleted_at IS NULL
     WHERE ctp.deleted_at IS NULL AND ctp.active = 1
     ORDER BY ct.id, ctp.id`
  );

  const formsByType = new Map();
  for (const row of rows) {
    if (!formsByType.has(row.typeId)) {
      formsByType.set(row.typeId, { id: row.typeId, type: row.type, typeThai: row.typeDescription, items: [] });
    }
    formsByType.get(row.typeId).items.push({
      id: row.itemId,
      name: row.itemName,
      description: row.itemDescription,
      files: { eng: row.fileEngPath, tha: row.fileThaPath },
    });
  }

  res.json([...formsByType.values()]);
}
