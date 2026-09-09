import transporter from '../../config/mail.js';
import config from '../../config/config.js';
import { newContractTemplate } from './contractEmailTemplates/newContract.template.js';
import { renewContractTemplate } from './contractEmailTemplates/renewContract.template.js';
import { amendmentTemplate } from './contractEmailTemplates/amendment.template.js';
import { terminationTemplate } from './contractEmailTemplates/termination.template.js';
import { claimNoteTemplate } from './contractEmailTemplates/claimNote.template.js';
import { cancelContractTemplate } from './contractEmailTemplates/cancelContract.template.js';

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
};

const SUBJECTS = {
  NEW: 'Request New Contract',
  RENEW: 'Request Renew Contract',
  AMENDMENT: 'Request Contract Amendment',
  TERMINATION: 'Request Contract Termination',
  CLAIM_NOTE: 'Request Claim Note',
  CANCEL: 'Request to Cancel Contract',
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
const REQUIRED_FIELDS_BY_TYPE = {
  NEW: ['contractType', 'purpose', 'netPrice', 'delivery'],
  RENEW: ['contractType', 'purpose', 'newPeriod'],
  AMENDMENT: ['contractType', 'reason', 'amendedDetail', 'effectiveDate'],
  TERMINATION: ['contractType', 'reason', 'effectiveDate'],
  CLAIM_NOTE: ['contractType', 'reason', 'claimDetail'],
  CANCEL: ['contractType', 'purpose', 'reason'],
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

  // CANCEL keeps its own literal "Request to Cancel Contract:" form (no space before
  // the colon) — every other type uses "{Subject} : {supplier}{ (contractNo)}".
  if (data.requestType === 'CANCEL') {
    return `Request to Cancel Contract: ${data.supplierName}${contractNoSuffix}`;
  }
  return `${SUBJECTS[data.requestType]} : ${data.supplierName}${contractNoSuffix}`;
}

// data shape (see app/services contractEmailTemplates/*.template.js for the exact
// fields each requestType reads):
//   requestType: 'NEW' | 'RENEW' | 'AMENDMENT' | 'TERMINATION' | 'CLAIM_NOTE' | 'CANCEL'
//   contractNo, supplierName, contractType, requestor, approverEmail, systemUrl
//   cc?, bcc? (arrays — included only when present)
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

  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Contract email sending failed:', error);
    throw error;
  }
}
