import { select, exec, insert } from '../../config/mysql.js';
import { logActivity } from '../utils/activityLog.js';

// ---------------------------------------------------------------------------
// Contract types (+ purposes) for the New Request form
// ---------------------------------------------------------------------------
export async function listContractTypes(_req, res) {
  const types = await select(
    `SELECT id, name, description, allow_custom_purpose AS allowCustomPurpose,
            check_construction_risk AS checkConstructionRisk,
            construction_risk_exempt_above AS constructionRiskExemptAbove
     FROM contract_types WHERE active = 1 AND deleted_at IS NULL ORDER BY id`
  );
  const purposes = await select(
    `SELECT id, contract_type_id AS contractTypeId, purpose_text AS purposeText, risk_level AS riskLevel
     FROM contract_type_purposes WHERE active = 1 AND deleted_at IS NULL ORDER BY id`
  );
  // ENG/THA template files attached per purpose (see attachFormItem/removeFormItem
  // below) — kept as a purposeText-keyed side map (purposeDocuments) rather than
  // folded into `purposes` itself, since `purposes` stays a plain string[] for the
  // New Request form's dropdown (FormSelect options) exactly as before. Only the
  // Drafted-status zip download (ContractListPage.jsx's handleDownloadPdf) reads
  // purposeDocuments.
  const formItems = await select(
    `SELECT contract_type_purpose_id AS purposeId, file_eng_path AS fileEngPath, file_tha_path AS fileThaPath
     FROM form_items WHERE active = 1 AND deleted_at IS NULL`
  );

  res.json(
    types.map(t => {
      const typePurposes = purposes.filter(p => p.contractTypeId === t.id);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        allowCustomPurpose: !!t.allowCustomPurpose,
        checkConstructionRisk: !!t.checkConstructionRisk,
        // Above this Total Net Price, the checklist popup is skipped even though
        // checkConstructionRisk is on — null means no exemption (always required).
        constructionRiskExemptAbove: t.constructionRiskExemptAbove != null ? Number(t.constructionRiskExemptAbove) : null,
        // Which purpose the New Request form's Construction Risk Classification
        // Checklist popup auto-assigns to Contract Purpose once scored — set from the
        // High/Low pickers on this type's own Settings > Contract Type edit form (see
        // risk_level on contract_type_purposes). Either side can be null if the admin
        // hasn't picked one yet, even with checkConstructionRisk on.
        constructionRiskPurposes: {
          high: typePurposes.find(p => p.riskLevel === 'high')?.purposeText || null,
          low: typePurposes.find(p => p.riskLevel === 'low')?.purposeText || null,
        },
        purposes: typePurposes.map(p => p.purposeText),
        purposeDocuments: Object.fromEntries(
          typePurposes.map(p => {
            const item = formItems.find(f => f.purposeId === p.id);
            return [p.purposeText, { fileEngPath: item?.fileEngPath || null, fileThaPath: item?.fileThaPath || null }];
          })
        ),
      };
    })
  );
}

// ---------------------------------------------------------------------------
// Admin: Contract Type / Purpose / Form Item management (Settings > Contract Type
// page). Unlike the public listContractTypes above, this includes inactive rows
// (so the admin can see and re-activate them) and each purpose's attached form_item.
// ---------------------------------------------------------------------------
export async function listAdminContractTypes(_req, res) {
  const types = await select(
    `SELECT id, name, description, allow_custom_purpose AS allowCustomPurpose,
            check_construction_risk AS checkConstructionRisk,
            construction_risk_exempt_above AS constructionRiskExemptAbove, active
     FROM contract_types WHERE deleted_at IS NULL ORDER BY id`
  );
  const purposes = await select(
    `SELECT id, contract_type_id AS contractTypeId, purpose_text AS purposeText, description, active,
            risk_level AS riskLevel
     FROM contract_type_purposes WHERE deleted_at IS NULL ORDER BY id`
  );
  const formItems = await select(
    `SELECT id, contract_type_purpose_id AS purposeId, file_eng_path AS fileEngPath, file_tha_path AS fileThaPath
     FROM form_items WHERE active = 1 AND deleted_at IS NULL`
  );

  res.json(
    types.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      allowCustomPurpose: !!t.allowCustomPurpose,
      checkConstructionRisk: !!t.checkConstructionRisk,
      constructionRiskExemptAbove: t.constructionRiskExemptAbove != null ? Number(t.constructionRiskExemptAbove) : null,
      active: !!t.active,
      purposes: purposes
        .filter(p => p.contractTypeId === t.id)
        .map(p => ({
          id: p.id,
          purposeText: p.purposeText,
          description: p.description,
          active: !!p.active,
          riskLevel: p.riskLevel || null,
          formItem: formItems.find(f => f.purposeId === p.id) || null,
        })),
    }))
  );
}

// Shared by create/update below: '' / null / undefined all mean "no exemption"; any
// other value must parse to a non-negative number, since it's compared directly
// against Total Net Price on the New Request form.
function parseExemptAbove(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return { ok: true, value: null };
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return { ok: false };
  return { ok: true, value: num };
}

export async function createAdminContractType(req, res) {
  const { name = '', description = '', allowCustomPurpose = false, checkConstructionRisk = false, constructionRiskExemptAbove } = req.body || {};
  if (!name.trim()) return res.status(400).json({ message: 'Name is required.' });

  const exempt = parseExemptAbove(constructionRiskExemptAbove);
  if (exempt && !exempt.ok) return res.status(400).json({ message: 'Invalid exemption amount.' });

  const id = await insert(
    `INSERT INTO contract_types (name, description, allow_custom_purpose, check_construction_risk, construction_risk_exempt_above, created_by)
     VALUES (:name, :description, :allowCustomPurpose, :checkConstructionRisk, :constructionRiskExemptAbove, 'app')`,
    {
      name,
      description: description || null,
      allowCustomPurpose: allowCustomPurpose ? 1 : 0,
      checkConstructionRisk: checkConstructionRisk ? 1 : 0,
      constructionRiskExemptAbove: exempt ? exempt.value : null,
    }
  );
  await logActivity(req, 'contract_type_create', { entityType: 'contract_type', entityId: id, detail: name });
  res.status(201).json({ id });
}

export async function updateAdminContractType(req, res) {
  const { name, description, allowCustomPurpose, checkConstructionRisk, constructionRiskExemptAbove, active } = req.body || {};
  const exempt = parseExemptAbove(constructionRiskExemptAbove);
  if (exempt && !exempt.ok) return res.status(400).json({ message: 'Invalid exemption amount.' });

  const sets = ["updated_at = NOW()", "updated_by = 'app'"];
  const replacements = { id: req.params.id };

  if (name !== undefined) { sets.push('name = :name'); replacements.name = name; }
  if (description !== undefined) { sets.push('description = :description'); replacements.description = description || null; }
  if (allowCustomPurpose !== undefined) { sets.push('allow_custom_purpose = :allowCustomPurpose'); replacements.allowCustomPurpose = allowCustomPurpose ? 1 : 0; }
  if (checkConstructionRisk !== undefined) { sets.push('check_construction_risk = :checkConstructionRisk'); replacements.checkConstructionRisk = checkConstructionRisk ? 1 : 0; }
  if (exempt) { sets.push('construction_risk_exempt_above = :constructionRiskExemptAbove'); replacements.constructionRiskExemptAbove = exempt.value; }
  if (active !== undefined) { sets.push('active = :active'); replacements.active = active ? 1 : 0; }

  await exec(`UPDATE contract_types SET ${sets.join(', ')} WHERE id = :id`, replacements);
  await logActivity(req, 'contract_type_update', { entityType: 'contract_type', entityId: Number(req.params.id), detail: name });
  res.json({ success: true });
}

export async function createAdminPurpose(req, res) {
  const { purposeText = '', description = '' } = req.body || {};
  if (!purposeText.trim()) return res.status(400).json({ message: 'Purpose text is required.' });

  const id = await insert(
    `INSERT INTO contract_type_purposes (contract_type_id, purpose_text, description, created_by)
     VALUES (:contractTypeId, :purposeText, :description, 'app')`,
    { contractTypeId: req.params.id, purposeText, description: description || null }
  );
  await logActivity(req, 'contract_purpose_create', { entityType: 'contract_type_purpose', entityId: id, detail: purposeText });
  res.status(201).json({ id });
}

export async function updateAdminPurpose(req, res) {
  const { purposeText, description, active, riskLevel } = req.body || {};
  if (riskLevel !== undefined && riskLevel !== null && riskLevel !== 'high' && riskLevel !== 'low') {
    return res.status(400).json({ message: 'Invalid risk level.' });
  }

  const sets = ["updated_at = NOW()", "updated_by = 'app'"];
  const replacements = { id: req.params.id };

  if (purposeText !== undefined) { sets.push('purpose_text = :purposeText'); replacements.purposeText = purposeText; }
  if (description !== undefined) { sets.push('description = :description'); replacements.description = description || null; }
  if (active !== undefined) { sets.push('active = :active'); replacements.active = active ? 1 : 0; }
  if (riskLevel !== undefined) { sets.push('risk_level = :riskLevel'); replacements.riskLevel = riskLevel; }

  await exec(`UPDATE contract_type_purposes SET ${sets.join(', ')} WHERE id = :id`, replacements);
  await logActivity(req, 'contract_purpose_update', { entityType: 'contract_type_purpose', entityId: Number(req.params.id), detail: purposeText });
  res.json({ success: true });
}

// Files are uploaded through the generic /api/uploads endpoint first (frontend calls
// uploadFiles), then attachFormItem below attaches the resulting file_uploads id onto
// one language slot (eng/tha) of the purpose's form_item row. ENG and THA are
// independent — attaching or removing one never touches the other. Still only one
// active form_items row per purpose; it's created lazily on the first language attached.
// Only used by attachFormItem/removeFormItem below, so kept private to this controller.
async function getActiveFormItem(purposeId) {
  const rows = await select(
    `SELECT id, file_eng_path AS fileEngPath, file_tha_path AS fileThaPath
     FROM form_items WHERE contract_type_purpose_id = :purposeId AND active = 1 AND deleted_at IS NULL LIMIT 1`,
    { purposeId }
  );
  return rows[0] || null;
}

export async function attachFormItem(req, res) {
  const { lang } = req.params;
  if (lang !== 'eng' && lang !== 'tha') return res.status(400).json({ message: 'Invalid language.' });

  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ message: 'File is required.' });
  const uploaded = await select(`SELECT id FROM file_uploads WHERE id = :fileId AND active = 1 AND deleted_at IS NULL`, { fileId });
  if (!uploaded.length) return res.status(400).json({ message: 'Uploaded file not found.' });

  const purposeId = req.params.id;
  const filePath = `/api/uploads/${fileId}/download`;
  const column = lang === 'eng' ? 'file_eng_path' : 'file_tha_path';
  const existing = await getActiveFormItem(purposeId);

  if (existing) {
    await exec(`UPDATE form_items SET ${column} = :filePath, updated_at = NOW(), updated_by = 'app' WHERE id = :id`, { id: existing.id, filePath });
    return res.json({
      id: existing.id,
      fileEngPath: lang === 'eng' ? filePath : existing.fileEngPath,
      fileThaPath: lang === 'tha' ? filePath : existing.fileThaPath,
    });
  }

  const id = await insert(
    `INSERT INTO form_items (contract_type_purpose_id, file_eng_path, file_tha_path, created_by)
     VALUES (:purposeId, :fileEngPath, :fileThaPath, 'app')`,
    { purposeId, fileEngPath: lang === 'eng' ? filePath : null, fileThaPath: lang === 'tha' ? filePath : null }
  );
  res.status(201).json({ id, fileEngPath: lang === 'eng' ? filePath : null, fileThaPath: lang === 'tha' ? filePath : null });
}

export async function removeFormItem(req, res) {
  const { lang } = req.params;
  if (lang !== 'eng' && lang !== 'tha') return res.status(400).json({ message: 'Invalid language.' });

  const existing = await getActiveFormItem(req.params.id);
  if (!existing) return res.status(404).json({ message: 'No attached file found.' });

  const column = lang === 'eng' ? 'file_eng_path' : 'file_tha_path';
  await exec(`UPDATE form_items SET ${column} = NULL, updated_at = NOW(), updated_by = 'app' WHERE id = :id`, { id: existing.id });

  // Once both languages are cleared, retire the now-empty row instead of leaving a husk.
  const otherStillSet = lang === 'eng' ? existing.fileThaPath : existing.fileEngPath;
  if (!otherStillSet) {
    await exec(`UPDATE form_items SET active = 0, deleted_at = NOW(), deleted_by = 'app' WHERE id = :id`, { id: existing.id });
  }

  res.json({ success: true });
}
