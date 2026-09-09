import { sequelize, select, exec, insert } from '../../config/mysql.js';
import { updateEditableFields, insertComment, notifyApproverForContractRequest } from '../../helpers/contractRequestHelper.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Approval workflow (Waiting Approve screen) — Approve / Return / Reject / Waive,
// each atomic (single Sequelize transaction: edited fields, comment, approval
// history, status transition, and — on Approve reaching Drafted or on Waive —
// contract number generation all commit or roll back together).
// ---------------------------------------------------------------------------

// Approving Waiting Approver N moves the request to the next stage; Approver 3 is the
// last stage, so approving it drafts the contract (and mints a contract number).
// Approver 2 is optional per-request — if approver2_em_id wasn't set, Waiting Approver 1
// skips straight to Waiting Approver 3 instead of stalling on an approver that doesn't exist.
function resolveNextStatus(existing) {
  switch (existing.status) {
    case 'Waiting Approver 1':
      return existing.approver2_em_id ? 'Waiting Approver 2' : 'Waiting Approver 3';
    case 'Waiting Approver 2':
      return 'Waiting Approver 3';
    case 'Waiting Approver 3':
      return 'Drafted';
    default:
      return null;
  }
}

// Which stage just got approved, keyed by the status the request was AT before this
// call (i.e. "Waiting Approver 1" means approver1 is the one signing off right now).
const STAGE_COLUMN = {
  'Waiting Approver 1': 'approver1',
  'Waiting Approver 2': 'approver2',
  'Waiting Approver 3': 'approver3',
};

// Every comment left from the Waiting Approve screen (Approve/Return/Reject) is
// labeled by which of the 3 approver slots is acting: Approver 3 (the Manager slot,
// see ApprovalSection.jsx — index 0, approves last) is "Manager"; Approver 1/2 (the
// Supervisor slots) are "Supervisor". Saved as the actual role at write time, not
// inferred later — every reader (Comment History, this request's own comment list)
// just displays whatever role is in the row.
//
// Checked in this order because the same em_id can be both the requestor AND the
// assigned approver (e.g. a tester self-approving their own request) — commenting
// from this Waiting Approve action means they're acting as the approver right now,
// so that takes priority over "Requester" even when both are technically true.
// Falls back to Requester for the request's creator, then Others for anyone else
// (e.g. legal/admin just browsing).
function computeApprovalCommentRole(existing, actorEmId) {
  const stageColumn = STAGE_COLUMN[existing.status];
  if (stageColumn && actorEmId && existing[`${stageColumn}_em_id`] === actorEmId) {
    return stageColumn === 'approver3' ? 'Manager' : 'Supervisor';
  }
  if (actorEmId && existing.created_by === actorEmId) return 'Requester';
  return 'Others';
}

// Cancel's own "Information" is just its Reason (ActionInfoSection's Cancel-specific
// layout — see schema.sql's comment above cancel_reason) filled in when the linked
// Cancel request was created. Folded into a real comment when that request finishes
// approval (reaches Drafted, i.e. the cancellation itself completes) so it shows up in
// the ORIGINAL contract's Comment History, not only on the Cancel request's own row.
function buildCancelReasonComment(body) {
  return body.cancelReason ? `Reason: ${body.cancelReason}` : null;
}

// "Approved By" Signature format: first name + first 2 letters of the last name,
// e.g. "Thitinun" + "Chaychayanon" -> "Thitinun Ch." — captured from the acting
// approver's own session at approval time so display never needs to join back to
// app_users/admin_users.
function formatSignature(firstName, lastName) {
  if (!firstName) return null;
  const initials = String(lastName || '').slice(0, 2);
  return initials ? `${firstName} ${initials}.` : firstName;
}

async function insertApprovalHistory(id, action, emId, name, options = {}) {
  await insert(
    `INSERT INTO contract_approval_history (contract_request_id, action, created_by, created_by_name)
     VALUES (:id, :action, :emId, :name)`,
    { id, action, emId: emId || null, name: name || null },
    options
  );
}

// Atomic contract-number generation. Both branches wrap the seed/increment value in
// LAST_INSERT_ID(...) so `SELECT LAST_INSERT_ID()` reliably returns the current value
// whether this call created the counter row or incremented an existing one — MySQL only
// populates the session's last-insert-id from the ON DUPLICATE KEY branch's expression
// unless the plain INSERT path also routes its value through LAST_INSERT_ID().
//
// Branches on `remark` explicitly (not on whether referContractNo happens to be set) —
// contract_no_sequences (the base "DSSTNN-YYYY" counter) must only ever be incremented
// for an actual new master contract (remark === 'new'). Every other remark (Renew/Amend/
// Claim Note/Terminate) always numbers itself off contract_revision_sequences, keyed by
// the base contract it refers to, regardless of what referContractNo happens to contain —
// so a bug or stray value there can never accidentally consume a base sequence number.
async function generateContractNo(remark, referContractNo, options) {
  const pad = n => String(n).padStart(2, '0');

  if (remark !== 'new') {
    if (!referContractNo) throw new ApiError(400, 'Refer to Contract No. is required to generate a revision number.');
    await exec(
      `INSERT INTO contract_revision_sequences (contract_no, last_revision) VALUES (:ref, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE last_revision = LAST_INSERT_ID(last_revision + 1)`,
      { ref: referContractNo },
      options
    );
    const rows = await select(`SELECT LAST_INSERT_ID() AS n`, {}, options);
    return `${referContractNo}-${pad(Number(rows[0].n))}`;
  }

  const year = new Date().getFullYear();
  await exec(
    `INSERT INTO contract_no_sequences (year, last_number) VALUES (:year, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    { year },
    options
  );
  const rows = await select(`SELECT LAST_INSERT_ID() AS n`, {}, options);
  return `DSST${pad(Number(rows[0].n))}-${year}`;
}

// `SELECT ... FOR UPDATE` locks the row for the lifetime of the transaction so two
// approvers acting on the same request at once serialize instead of racing.
//
// NOTE (code smell, intentionally not consolidated): legalController.js and
// signedContractController.js each have their own near-identical `lockRequest`-style
// helper. They were NOT merged into one shared utility during this refactor because
// they select different columns / enforce different status checks (this one needs
// created_by + all 3 approverN_em_id columns; legal's only needs `status`;
// signedContract's additionally requires status === 'Drafted') — merging them would
// mean changing the SQL one of them runs, which this refactor was explicitly told not
// to do "unless necessary". A future cleanup could parameterize a single
// `lockRequestForUpdate(id, { columns, requireStatus }, options)` helper instead.
async function lockRequest(id, options) {
  const rows = await select(
    `SELECT status, created_by, refer_contract_no, linked_master_id, remark, requestor_name, contract_no,
            approver1_em_id, approver2_em_id, approver3_em_id
     FROM contract_requests WHERE id = :id AND deleted_at IS NULL FOR UPDATE`,
    { id },
    options
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  return rows[0];
}

async function approveRequest(id, body) {
  // Captured inside the transaction below, read again after it commits — notifying
  // the next approver only makes sense once the status change has actually persisted,
  // and a notification failure (see notifyApproverForContractRequest's own "never
  // fail the caller" contract) must never roll back an approval that already succeeded.
  let existingForEmail = null;
  let nextStatusForEmail = null;

  const result = await sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);
    existingForEmail = existing;

    const nextStatus = resolveNextStatus(existing);
    nextStatusForEmail = nextStatus;
    if (!nextStatus) throw new ApiError(400, `Cannot approve a request with status "${existing.status}".`);
    // True only for the specific approve call that completes a Cancel request's own
    // approval chain (Approver 3, Waiting Approver 3 -> Drafted) — Approver 1/2's
    // earlier approve calls on the same Cancel request are NOT this, since the request
    // hasn't actually cancelled anything yet at those stages.
    const isCancelCompletion = nextStatus === 'Drafted' && existing.remark === 'cancel' && !!existing.linked_master_id;

    await updateEditableFields(id, body, nextStatus, options);

    const stageColumn = STAGE_COLUMN[existing.status];
    if (stageColumn) {
      const signature = formatSignature(body.approverFirstName, body.approverLastName);
      await exec(
        `UPDATE contract_requests SET ${stageColumn}_name = :signature, ${stageColumn}_approved_at = NOW() WHERE id = :id`,
        { id, signature },
        options
      );
    }

    if (body.comment && body.comment.trim()) {
      const role = computeApprovalCommentRole(existing, body.emId);
      await insertComment(id, body.comment, body.updatedName, role, body.emId, options);
    }

    // Normally this action's own approval history stays on the request itself — but a
    // Cancel request's completion is the one exception: it references the ORIGINAL
    // contract it just cancelled instead, so that contract's own audit trail shows this
    // approval, not the (now-closed) cancel request's history, which nothing looks at
    // again once it's done its job.
    await insertApprovalHistory(isCancelCompletion ? existing.linked_master_id : id, 'Approve', body.emId, body.updatedName, options);

    let contractNo = null;
    if (isCancelCompletion) {
      // A Cancel request (More menu > Cancel on a Drafted row) finishing its own approval
      // chain is what actually cancels the *original* contract — its master stays
      // completely untouched (still 'Drafted', never 'Waiting Approver N') for the entire
      // time this Cancel request works through its own separate approval chain. Unlike
      // Renew/Amend/Claim Note/Terminate, a Cancel request was never meant to become a
      // contract in its own right — it's only a vehicle for getting the cancellation
      // approved — so it doesn't mint its own contract_no. It DOES stay a permanent row
      // now, though (never soft-deleted): its own status flips to 'Cancelled' — same as
      // the master — so it remains a searchable audit-trail entry in My History
      // (HISTORY_STATUSES) instead of disappearing the moment approval completes.
      const infoComment = buildCancelReasonComment(body);
      if (infoComment) {
        // Commenter is the Cancel request's own Requestor (its requestor_name/created_by
        // — the person who actually filled in this Reason and asked for the
        // cancellation), never whichever approver happens to be the one clicking this
        // final approve — even though Approver 3 is who triggers this.
        await insertComment(
          existing.linked_master_id,
          infoComment,
          existing.requestor_name,
          'Requester',
          existing.created_by,
          options
        );
      }

      await exec(
        `UPDATE contract_requests SET status = 'Cancelled', updated_at = NOW() WHERE id = :masterId AND deleted_at IS NULL`,
        { masterId: existing.linked_master_id },
        options
      );

      // This request's own record — kept permanently (unlike the old soft-delete-on-
      // completion behavior) as the audit trail for the cancellation, so its own comment
      // thread (creator's note, any approver remarks) stays intact and reachable through
      // its own id rather than being re-parented onto the master.
      await exec(`UPDATE contract_requests SET status = 'Cancelled', updated_at = NOW() WHERE id = :id`, { id }, options);
    } else if (nextStatus === 'Drafted') {
      // Renew/Amend/Claim Note/Terminate: unlike Cancel above, this request's own
      // Background/Detail/Attached files ("___ Information") is never folded into a
      // comment here — it already persists on the row itself (action_background/
      // action_detail/action files), readable directly via its own "___ Information"
      // section, so there's no need to duplicate it into Comment History. Only
      // Approver 3's own typed comment (handled earlier, above) gets saved.
      const referContractNo = (body.referContractNo || '').trim() || null;
      contractNo = await generateContractNo(existing.remark, referContractNo, options);
      await exec(`UPDATE contract_requests SET contract_no = :contractNo WHERE id = :id`, { id, contractNo }, options);
    }

    return { id: Number(id), status: nextStatus, contractNo };
  });

  // Approving Waiting Approver 1/2 hands the request to whichever approver is next
  // (see resolveNextStatus above — Approver 2 if set, otherwise straight to Approver
  // 3). Waiting Approver 3 -> Drafted is the chain finishing, not a handoff, so no
  // notification there. existingForEmail.contract_no is whatever the row already had
  // going into this call (a placeholder for Renew/Amend/Claim/Terminate, still null for
  // a 'new' remark) — a real number is only minted at the Drafted transition above.
  const nextApproverEmId =
    nextStatusForEmail === 'Waiting Approver 2'
      ? existingForEmail.approver2_em_id
      : nextStatusForEmail === 'Waiting Approver 3'
        ? existingForEmail.approver3_em_id
        : null;
  if (nextApproverEmId) {
    await notifyApproverForContractRequest(nextApproverEmId, {
      body,
      remark: existingForEmail.remark,
      contractNo: existingForEmail.contract_no,
      requestorName: existingForEmail.requestor_name,
      linkedMasterId: existingForEmail.linked_master_id,
      systemUrl: body.systemUrl,
    });
  }

  return result;
}

// Waive fast-tracks a request straight to 'Signed', skipping the rest of the
// approval chain — but only from 'Waiting Approver 3', the last stage. Approver
// 1/2 must go through Approve normally instead (re-enforced here, not just hidden
// client-side — the button itself is only shown at that status in EditRequestModal,
// but the server never trusts that alone). Comment is mandatory (unlike Approve,
// where it's optional), same as Return/Reject above, since bypassing the rest of the
// approval chain needs a recorded reason.
//
// A Cancel request (remark = 'cancel') can never be waived — unlike every other
// remark, it isn't a contract in its own right; its own approval completing is what
// cancels the ORIGINAL linked contract (see isCancelCompletion above), so setting
// its own status to 'Signed' would be meaningless and would never actually cancel
// anything. Every other remark (new/renew/amend/claim/terminate) waives the same way
// Approve normally reaches Drafted: this still mints a real contract_no (same
// generateContractNo call, same remark-branch rule) so a waived Signed contract is
// numbered exactly like any other, and still records Approver 3's own stage
// signature — Waive is "approve the last stage and skip straight to Signed", not a
// different kind of outcome.
async function waiveRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    if (existing.status !== 'Waiting Approver 3') {
      throw new ApiError(400, `Cannot waive a request with status "${existing.status}".`);
    }
    if (existing.remark === 'cancel') {
      throw new ApiError(400, 'A Cancel request cannot be waived.');
    }

    await updateEditableFields(id, body, 'Signed', options);

    const stageColumn = STAGE_COLUMN[existing.status];
    const signature = formatSignature(body.approverFirstName, body.approverLastName);
    await exec(
      `UPDATE contract_requests SET ${stageColumn}_name = :signature, ${stageColumn}_approved_at = NOW() WHERE id = :id`,
      { id, signature },
      options
    );

    const role = computeApprovalCommentRole(existing, body.emId);
    await insertComment(id, body.comment, body.updatedName, role, body.emId, options);

    await insertApprovalHistory(id, 'Waive', body.emId, body.updatedName, options);

    // generateContractNo is keyed off existing.remark (captured before this row's own
    // remark gets overwritten below) — a waived Renew/Amend/Claim Note/Terminate still
    // numbers itself as that same revision type, only the persisted remark itself
    // becomes 'waived' afterward (see the Remark checklist requirement this satisfies:
    // the PDF/badge/radio group all show "Waived" once a request has gone this route,
    // regardless of what it originally was).
    const referContractNo = (body.referContractNo || '').trim() || null;
    const contractNo = await generateContractNo(existing.remark, referContractNo, options);
    await exec(
      `UPDATE contract_requests SET contract_no = :contractNo, remark = 'waived' WHERE id = :id`,
      { id, contractNo },
      options
    );

    return { id: Number(id), status: 'Signed', contractNo };
  });
}

async function returnRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, 'Returned', options);

    const role = computeApprovalCommentRole(existing, body.emId);
    await insertComment(id, body.comment, body.updatedName, role, body.emId, options);

    await insertApprovalHistory(id, 'Return', body.emId, body.updatedName, options);

    return { id: Number(id), status: 'Returned' };
  });
}

async function rejectRequest(id, body) {
  if (!body.comment || !body.comment.trim()) throw new ApiError(400, 'Comment is required.');

  return sequelize.transaction(async transaction => {
    const options = { transaction };
    const existing = await lockRequest(id, options);

    await updateEditableFields(id, body, 'Rejected', options);

    const role = computeApprovalCommentRole(existing, body.emId);
    await insertComment(id, body.comment, body.updatedName, role, body.emId, options);

    await insertApprovalHistory(id, 'Reject', body.emId, body.updatedName, options);

    return { id: Number(id), status: 'Rejected' };
  });
}

export async function approve(req, res) {
  try {
    const result = await approveRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function waive(req, res) {
  try {
    const result = await waiveRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function returnContract(req, res) {
  try {
    const result = await returnRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}

export async function reject(req, res) {
  try {
    const result = await rejectRequest(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    handleApprovalError(err, res);
  }
}
