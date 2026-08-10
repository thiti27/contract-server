import { sequelize, select, exec } from '../../config/mysql.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Upload Sign Contract (More > Upload Sign Contract, only while status = 'Drafted') —
// attaches the signed PDF (already uploaded via /api/uploads) and the expiry/renewal
// policy, then flips status to 'Signed'.
// ---------------------------------------------------------------------------

const REMINDER_OPTIONS = [15, 30, 45, 60, 90];

// `SELECT ... FOR UPDATE` locks the row for the lifetime of the transaction, same
// reasoning as approvalController/legalController — two people uploading at once on
// the same request should serialize instead of racing.
// (See the code-smell note in approvalController.js — kept separate from the other
// two lockRequest-style helpers since this one also enforces status === 'Drafted'.)
async function lockDraftedRequest(id, options) {
  const rows = await select(`SELECT status FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`, { id }, options);
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  if (rows[0].status !== 'Drafted') {
    throw new ApiError(400, `Cannot upload a signed contract for a request with status "${rows[0].status}".`);
  }
}

// Re-validates everything the client already checked — the server never trusts
// client-side validation alone.
function validate(body) {
  if (!body.fileId) throw new ApiError(400, 'A signed contract PDF file is required.');

  if (body.hasExpiry) {
    if (!body.contractStartDate) throw new ApiError(400, 'Contract Start Date is required.');
    if (!body.contractEndDate) throw new ApiError(400, 'Contract End Date is required.');
    if (new Date(body.contractEndDate) <= new Date(body.contractStartDate)) {
      throw new ApiError(400, 'Contract End Date must be after Contract Start Date.');
    }
    if (body.autoRenewal === true) {
      if (!body.autoRenewalYears || Number(body.autoRenewalYears) <= 0) {
        throw new ApiError(400, 'Auto Renewal requires a number of years.');
      }
      // Reminder Before Expiry is only shown (and only makes sense) for Auto
      // Renewal — No Auto Renewal has nothing to remind ahead of.
      if (!REMINDER_OPTIONS.includes(Number(body.reminderBeforeExpiryDays))) {
        throw new ApiError(400, 'Reminder Before Expiry is required.');
      }
    } else if (body.autoRenewal !== false) {
      throw new ApiError(400, 'Select either Auto Renewal or No Auto Renewal.');
    }
  }
}

async function uploadSignedContract(id, body) {
  validate(body);

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    await lockDraftedRequest(id, options);

    const hasExpiry = !!body.hasExpiry;

    await exec(
      `UPDATE contract_requests SET
         status = 'Signed',
         signed_file_id = :fileId,
         has_expiry = :hasExpiry,
         contract_start_date = :contractStartDate,
         expire_date = :contractEndDate,
         auto_renewal = :autoRenewal,
         auto_renewal_years = :autoRenewalYears,
         reminder_before_expiry_days = :reminderBeforeExpiryDays,
         updated_by = :emId, updated_name = :updatedName, updated_at = NOW()
       WHERE id = :id`,
      {
        id,
        fileId: body.fileId,
        hasExpiry: hasExpiry ? 1 : 0,
        contractStartDate: hasExpiry ? body.contractStartDate || null : null,
        contractEndDate: hasExpiry ? body.contractEndDate || null : null,
        autoRenewal: hasExpiry ? (body.autoRenewal ? 1 : 0) : null,
        autoRenewalYears: hasExpiry && body.autoRenewal ? Number(body.autoRenewalYears) : null,
        reminderBeforeExpiryDays: hasExpiry && body.autoRenewal ? Number(body.reminderBeforeExpiryDays) : null,
        emId: body.emId || null,
        updatedName: body.updatedName || null,
      },
      options
    );

    return { id: Number(id), status: 'Signed' };
  });
}

export async function uploadSigned(req, res) {
  try {
    const result = await uploadSignedContract(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
