// Statuses that make up each screen's scope. Kept in sync with contract-web/src/lib/statusGroups.js
// so the badge counts in metaController match what each list screen actually shows.
export const CONTRACT_MAKING_STATUSES = ['Saved', 'Waiting Approver 1', 'Waiting Approver 2', 'Waiting Approver 3', 'Returned'];
export const UPLOAD_CONTRACT_STATUSES = ['Drafted'];
export const LEGAL_WAITING_STATUSES = ['Waiting Legal Check'];
export const MY_JOB_STATUSES = [...CONTRACT_MAKING_STATUSES, ...UPLOAD_CONTRACT_STATUSES, ...LEGAL_WAITING_STATUSES];

// SQL fragment (no leading WHERE/AND) for "this em_id has the right to approve this
// row right now" — Waiting Approver N status maps 1:1 to approverN_em_id, so it's a
// match only when the row's CURRENT stage's approver column equals the given em_id.
// Used by both contractController (GET /api/contracts) and contractCounters
// (countWaitingApprove) — same condition, kept in one place.
export const APPROVER_STAGE_MATCH = `(
  (status = 'Waiting Approver 1' AND approver1_em_id = :approverEmId) OR
  (status = 'Waiting Approver 2' AND approver2_em_id = :approverEmId) OR
  (status = 'Waiting Approver 3' AND approver3_em_id = :approverEmId)
)`;

// Legal > Waiting has no per-row assignment (any legal user can review any request,
// unlike Waiting Approve's em_id match) — it's gated by role instead. legal_check = 0
// is deliberately separate from `status` (see contract_requests schema) so Check
// doesn't disturb the main workflow — it's what actually drops a row off Legal > Waiting.
export const LEGAL_REVIEW_STATUSES = ['Drafted', 'Signed'];

// The frontend saves either a 'draft' or 'submitted' action; that maps onto the
// actual lifecycle status a contract_requests row starts at.
export const NEW_REQUEST_STATUS = { draft: 'Saved', submitted: 'Waiting Approver 1' };

// The Edit modal sends which footer button was clicked as `action`; that decides
// the resulting status transition (server-side, never trusting a client-supplied
// status directly). `save-change` intentionally keeps whatever status the row is
// already at — editing an in-flight request doesn't restart its approval stage.
export const EDIT_ACTION_STATUS = {
  'save-change': null,
  cancel: 'Canceled',
  'save-draft': 'Saved',
  'send-request': 'Waiting Approver 1',
};

// Global documents — singleton files not tied to any contract type/purpose:
// "Contract Procedure" and "User Manual" (both Home page), and "Check Sheet"
// (every row on Download Form).
export const GLOBAL_DOC_KEYS = ['contract_procedure', 'check_sheet', 'user_manual'];
