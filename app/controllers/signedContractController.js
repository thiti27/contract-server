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
  const rows = await select(
    `SELECT status, remark, contract_no AS contractNo, refer_contract_no AS referContractNo
     FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
    { id },
    options
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  if (rows[0].status !== 'Drafted') {
    throw new ApiError(400, `Cannot upload a signed contract for a request with status "${rows[0].status}".`);
  }
  return rows[0];
}

// A Terminate request going Signed means the whole contract is done for — every other
// request under the same base contract_no (the 'new' row itself, plus every Renew/
// Amend/Cancel revision — grouped the same way ContractTable's own zebra-striping does,
// by refer_contract_no falling back to contract_no for the root row) moves to
// Terminated right along with it. Claim Note is the one exception: a claim is its own
// independent paper trail against the contract, not a revision of its terms, so it
// stays whatever status it already reached instead of being overwritten.
async function terminateContractFamily(id, request, body, options) {
  const groupKey = request.referContractNo || request.contractNo;
  if (!groupKey) return;

  await exec(
    `UPDATE contract_requests
     SET status = 'Terminated', updated_by = :emId, updated_name = :updatedName, updated_at = NOW()
     WHERE deleted_at IS NULL
       AND id != :id
       AND remark != 'claim'
       AND COALESCE(NULLIF(refer_contract_no, ''), contract_no) = :groupKey`,
    { id, groupKey, emId: body.emId || null, updatedName: body.updatedName || null },
    options
  );
}

// Re-validates everything the client already checked — the server never trusts
// client-side validation alone.
function validate(body) {
  if (!body.fileId) throw new ApiError(400, 'A signed contract PDF file is required.');
  // Required regardless of hasExpiry — Step 2 (Contract Start) on the client is its
  // own standalone step, not nested under Step 3's has-expiry/no-expiry choice.
  if (!body.contractStartDate) throw new ApiError(400, 'Contract Start Date is required.');

  if (body.hasExpiry) {
    if (!body.contractEndDate) throw new ApiError(400, 'Contract End Date is required.');
    if (new Date(body.contractEndDate) <= new Date(body.contractStartDate)) {
      throw new ApiError(400, 'Contract End Date must be after Contract Start Date.');
    }
    if (body.autoRenewal === true) {
      if (!body.autoRenewalYears || Number(body.autoRenewalYears) <= 0) {
        throw new ApiError(400, 'Auto Renewal requires a number of years.');
      }
    } else if (body.autoRenewal !== false) {
      throw new ApiError(400, 'Select either Auto Renewal or No Auto Renewal.');
    }
    // Reminder Before Expiry is required whenever the contract has an end date,
    // regardless of the Auto Renewal choice — unlike autoRenewalYears above, which
    // only applies to Auto Renewal specifically.
    if (!REMINDER_OPTIONS.includes(Number(body.reminderBeforeExpiryDays))) {
      throw new ApiError(400, 'Reminder Before Expiry is required.');
    }
  }
}

async function uploadSignedContract(id, body) {
  validate(body);

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const request = await lockDraftedRequest(id, options);

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
         renewal_condition = :renewalCondition,
         reminder_before_expiry_days = :reminderBeforeExpiryDays,
         updated_by = :emId, updated_name = :updatedName, updated_at = NOW()
       WHERE id = :id`,
      {
        id,
        fileId: body.fileId,
        hasExpiry: hasExpiry ? 1 : 0,
        // Not gated behind hasExpiry, unlike the rest of these fields below — it's
        // required and collected either way (validate() above already guarantees it).
        contractStartDate: body.contractStartDate,
        contractEndDate: hasExpiry ? body.contractEndDate || null : null,
        autoRenewal: hasExpiry ? (body.autoRenewal ? 1 : 0) : null,
        autoRenewalYears: hasExpiry && body.autoRenewal ? Number(body.autoRenewalYears) : null,
        // Optional free-text field — meaningful for either renewal choice (e.g. "no
        // auto-renewal, but the supplier historically offers a discount on manual
        // renewal"), not just Auto Renewal, so it's not gated behind body.autoRenewal
        // the way autoRenewalYears/reminderBeforeExpiryDays are.
        renewalCondition: hasExpiry ? (body.renewalCondition || '').trim() || null : null,
        // Not gated behind body.autoRenewal, unlike autoRenewalYears above — required
        // and collected whenever hasExpiry (validate() above already guarantees it).
        reminderBeforeExpiryDays: hasExpiry ? Number(body.reminderBeforeExpiryDays) : null,
        emId: body.emId || null,
        updatedName: body.updatedName || null,
      },
      options
    );

    if (request.remark === 'terminate') {
      await terminateContractFamily(id, request, body, options);
    }

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
