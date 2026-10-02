import transporter from '../../config/mail.js';
import config from '../../config/config.js';
import { logSend } from './scheduledEmailLog.service.js';
import { newContractTemplate } from './contractEmailTemplates/newContract.template.js';
import { renewContractTemplate } from './contractEmailTemplates/renewContract.template.js';
import { amendmentTemplate } from './contractEmailTemplates/amendment.template.js';
import { terminationTemplate } from './contractEmailTemplates/termination.template.js';
import { claimNoteTemplate } from './contractEmailTemplates/claimNote.template.js';
import { cancelContractTemplate } from './contractEmailTemplates/cancelContract.template.js';
import { approvedContractTemplate } from './contractEmailTemplates/approvedContract.template.js';
import { returnContractTemplate } from './contractEmailTemplates/returnContract.template.js';
import { waivedContractTemplate } from './contractEmailTemplates/waivedContract.template.js';
import { legalCommentTemplate } from './contractEmailTemplates/legalComment.template.js';

// ---------------------------------------------------------------------------
// Contract Request email notifications — one entry point (sendContractRequestEmail)
// for all 6 request types. Reuses the single transporter from config/mail.js; never
// creates its own SMTP connection.
// ---------------------------------------------------------------------------

const TEMPLATES = {
  NEW: newContractTemplate,
  RENEW: renewContractTemplate,
  AMENDMENT: amendmentTemplate,
  TERMINATION: terminationTemplate,
  CLAIM_NOTE: claimNoteTemplate,
  CANCEL: cancelContractTemplate,
  APPROVED: approvedContractTemplate,
  RETURN: returnContractTemplate,
  WAIVED: waivedContractTemplate,
  LEGAL_COMMENT: legalCommentTemplate,
};

const SUBJECTS = {
  NEW: 'Request New Contract',
  RENEW: 'Request Renew Contract',
  AMENDMENT: 'Request Contract Amendment',
  TERMINATION: 'Request Contract Termination',
  CLAIM_NOTE: 'Request Claim Note',
  CANCEL: 'Request to Cancel Contract',
  APPROVED: 'Approved Contract Request',
  RETURN: 'Return Contract Request',
  WAIVED: 'Contract Requirement Waived Notification',
  // Built dynamically per remark (Legal Comment for {remarkLabel}) — see buildSubject's
  // own LEGAL_COMMENT branch; this entry only exists so SUBJECTS[type] lookups elsewhere
  // (none currently) don't break, not because it's used directly.
  LEGAL_COMMENT: 'Legal Comment',
};

// Fields every request type needs, on top of the common ones checked in
// validate() below. contractNo is deliberately never required here — a 'new' contract
// has no contract_no at all until its approval chain reaches Drafted, so every
// approver-stage email for a NEW request is sent before one exists.
//
// RENEW's originalPeriod is likewise never required — it's read from the master
// contract's own expire_date (buildContractEmailData, helpers/contractRequestHelper.js),
// which is legitimately empty whenever that contract was signed with no fixed end date
// (Upload Sign Contract's "No fixed end date" choice) — a real, supported state, not
// missing data. newPeriod stays required: unlike originalPeriod it's a value the
// requester actually typed into the form (New Contract End Date), always required
// there before Send Request succeeds.
// APPROVED and RETURN apply to every remark, unlike the 6 original types above — each
// remark's own field set (purpose/netPrice/delivery for NEW, originalPeriod/newPeriod
// for RENEW, ...) is already resolved into a generic `rows` array before either of
// these ever gets called (contractRequestHelper.js's buildDisplayRows), so `rows`
// itself is the only thing to require here rather than re-listing every remark's
// individual fields a second time. documentsUrl is APPROVED-only (the Download
// Contract Documents button's link); RETURN needs `comments` instead (the approver's
// own comment, already split into a list) and deliberately has no documentsUrl —
// nothing's ready to download yet.
const REQUIRED_FIELDS_BY_TYPE = {
  NEW: ['contractType', 'purpose', 'netPrice', 'delivery'],
  RENEW: ['contractType', 'purpose', 'newPeriod'],
  AMENDMENT: ['contractType', 'reason', 'amendedDetail', 'effectiveDate'],
  TERMINATION: ['contractType', 'reason', 'effectiveDate'],
  CLAIM_NOTE: ['contractType', 'reason', 'claimDetail'],
  CANCEL: ['contractType', 'purpose', 'reason'],
  APPROVED: ['rows', 'documentsUrl'],
  RETURN: ['rows', 'comments'],
  // WAIVED needs `waivedBy` ('Manager' | 'Legal') on top of the same rows/comments
  // RETURN already requires — everything else (Contract No., CC) is optional/best-
  // effort the same way it already is for APPROVED.
  WAIVED: ['rows', 'comments', 'waivedBy'],
  // Legal Review Mode's Comment action (legalController.js) — remarkLabel drives the
  // dynamic subject ("Legal Comment for {remarkLabel}"), legalContactsLine is the
  // "Any question, please contact ..." line (active Legal users' name + ext).
  LEGAL_COMMENT: ['rows', 'comments', 'remarkLabel', 'legalContactsLine'],
};

const COMMON_REQUIRED_FIELDS = ['requestType', 'supplierName', 'approverEmail', 'systemUrl', 'requestor'];

function validate(data) {
  for (const field of COMMON_REQUIRED_FIELDS) {
    if (!data[field]) throw new Error(`Missing required field: ${field}`);
  }

  const requiredForType = REQUIRED_FIELDS_BY_TYPE[data.requestType];
  if (!requiredForType) throw new Error(`Unsupported contract request type: ${data.requestType}`);

  for (const field of requiredForType) {
    if (!data[field]) throw new Error(`Missing required field: ${field}`);
  }
}

function buildSubject(data) {
  // A NEW contract has no contract_no at all until its approval chain reaches Drafted
  // (see contractEmail.service.js's REQUIRED_FIELDS_BY_TYPE comment) — every
  // approver-stage email for one is sent before it exists, which used to render as a
  // bare trailing "()" in the subject. Omit the "(...)" suffix entirely whenever
  // contractNo is empty, for every type, rather than showing empty parens.
  const contractNoSuffix = data.contractNo ? ` (${data.contractNo})` : '';

  // CANCEL and WAIVED both keep their own literal "{Subject}:" form (no space before
  // the colon, matching the exact subject shown in each one's design mockup) — every
  // other type uses "{Subject} : {supplier}{ (contractNo)}".
  if (data.requestType === 'CANCEL') {
    return `Request to Cancel Contract: ${data.supplierName}${contractNoSuffix}`;
  }
  if (data.requestType === 'WAIVED') {
    return `${SUBJECTS.WAIVED}: ${data.supplierName}${contractNoSuffix}`;
  }
  // "Legal Comment for {remarkLabel}" — remarkLabel is per-request (New Contract/
  // Renew/Amend/Claim Note/Terminate), so unlike every other type this can't be a
  // static SUBJECTS[type] lookup.
  if (data.requestType === 'LEGAL_COMMENT') {
    return `Legal Comment for ${data.remarkLabel} : ${data.supplierName}${contractNoSuffix}`;
  }
  return `${SUBJECTS[data.requestType]} : ${data.supplierName}${contractNoSuffix}`;
}

// data shape (see app/services contractEmailTemplates/*.template.js for the exact
// fields each requestType reads):
//   requestType: 'NEW' | 'RENEW' | 'AMENDMENT' | 'TERMINATION' | 'CLAIM_NOTE' | 'CANCEL' | 'APPROVED'
//   contractNo, supplierName, contractType, requestor, approverEmail, systemUrl
//   approverEmail is the mail's "to" address for every type despite the name — for
//   APPROVED specifically that's the Requestor's own email, not an approver's; `cc`
//   below is how APPROVED reaches Section Head (the 3 approvers) + Legal.
//   cc?, bcc? (arrays — included only when present)
//   contractRequestId? — the contract_requests.id this email is about, when the
//   caller has one in scope (every contractRequestHelper.js notify* function's own
//   callers do — see each one's own contractRequestId passthrough). Purely for the
//   audit log below (contract_request_ids); never read by validate() or a template.
//   + whichever fields that requestType needs (purpose/netPrice/delivery for NEW, ...)
export async function sendContractRequestEmail(data) {
  // The config.systemUrl fallback must be resolved BEFORE validation, not after —
  // systemUrl is only optional from a *caller's* point of view (falls back to config
  // when omitted); once resolved it's unconditionally required, same as every other
  // common field. Validating the raw, pre-fallback data here would reject the exact
  // "caller didn't pass one, use the config default" case this fallback exists for.
  const from = config.email.from;
  const systemUrl = data.systemUrl || config.systemUrl;
  const resolvedData = { ...data, from, systemUrl };

  validate(resolvedData);

  const template = TEMPLATES[resolvedData.requestType];
  if (!template) throw new Error(`Unsupported contract request type: ${resolvedData.requestType}`);

  const html = template(resolvedData);
  const subject = buildSubject(resolvedData);

  const mailOptions = {
    from,
    to: resolvedData.approverEmail,
    subject,
    html,
  };
  if (resolvedData.cc && resolvedData.cc.length) mailOptions.cc = resolvedData.cc;
  if (resolvedData.bcc && resolvedData.bcc.length) mailOptions.bcc = resolvedData.bcc;

  console.log(
    `[Email] Sending "${subject}" to: ${mailOptions.to}` +
      (mailOptions.cc ? ` | cc: ${mailOptions.cc}` : '') +
      (mailOptions.bcc ? ` | bcc: ${mailOptions.bcc}` : '')
  );

  // Every one of these 10 request types funnels through this one function, so
  // logging here (rather than in each of contractRequestHelper.js's notify*
  // callers) is what makes scheduled_email_log cover every email case the app
  // sends, not just the 2 scheduled cron jobs (draftedTracking/expirationReminder,
  // which log via their own job files instead, since they aren't per-request emails
  // routed through here). entityKey falls back to "pending-{requestType}" for the
  // handful of approver-stage emails sent before a NEW contract has a contract_no
  // yet (see REQUIRED_FIELDS_BY_TYPE's own comment on that). logSend never throws
  // into this function's own caller — a logging failure must never be mistaken for
  // (or mask) a real send failure.
  const logFields = {
    jobType: resolvedData.requestType,
    entityKey: resolvedData.contractNo || `pending-${resolvedData.requestType}`,
    contractRequestIds: resolvedData.contractRequestId ? [resolvedData.contractRequestId] : [],
    to: mailOptions.to,
    cc: mailOptions.cc,
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    await logSend({ ...logFields, status: 'success' }).catch(err => console.error('Email log write failed:', err));
    return result;
  } catch (error) {
    console.error('Contract email sending failed:', error);
    await logSend({ ...logFields, status: 'failed', errorMessage: error.message }).catch(err => console.error('Email log write failed:', err));
    throw error;
  }
}
