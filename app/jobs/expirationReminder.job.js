import { getExpirationReminderPreview } from '../services/scheduledEmailPreview.service.js';
import { getEmployeeEmail } from '../services/employeeLookup.service.js';
import { sendExpirationReminderEmail } from '../services/scheduledEmail.service.js';
import { isAlreadyLogged, logSend } from '../services/scheduledEmailLog.service.js';

const JOB_TYPE = 'expiration_reminder';

function dateOnly(value) {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

// Shared by the cron loop below and sendExpirationReminderNowById (the Email
// Monitor page's manual Send action) — resolves recipients, sends, and always logs
// the attempt (success or failure) for one already-computed preview item. No
// isAlreadyLogged check in here on purpose: the cron loop is what enforces "once per
// contract" for its own automatic run, while a manual send is an explicit human
// action and is always allowed to (re)send.
async function sendForItem(item) {
  let to = null;
  let cc = [];
  try {
    to = await getEmployeeEmail(item.createdBy);
    if (!to) throw new Error(`No email on file for requestor em_id "${item.createdBy}".`);

    const approverEmails = await Promise.all(item.ccApprovers.map(a => getEmployeeEmail(a.emId)));
    const legalEmails = await Promise.all(item.ccLegal.map(l => getEmployeeEmail(l.emId)));
    cc = [...new Set([...approverEmails, ...legalEmails].filter(Boolean))];

    await sendExpirationReminderEmail({
      to,
      cc,
      requestor: item.requestorName,
      supplierName: item.supplierName,
      contractNo: item.contractNo,
      contractType: item.contractType,
      purpose: item.purpose,
      expireDate: dateOnly(item.expireDate),
    });

    await logSend({ jobType: JOB_TYPE, entityKey: item.contractNo, contractRequestIds: [item.id], to, cc, status: 'success' });
    return { to, cc };
  } catch (error) {
    await logSend({ jobType: JOB_TYPE, entityKey: item.contractNo, contractRequestIds: [item.id], to, cc, status: 'failed', errorMessage: error.message });
    throw error;
  }
}

// Contract Expiration Reminder — run daily (see app/jobs/index.js). Sends once per
// contract (entity_key = contract_no, no year component — unlike Drafted Tracking
// this never repeats), on expire_date - reminder_before_expiry_days. Also catches up
// on any contract whose target date already passed without ever being sent (a day
// the server was down over its exact trigger date), since sendStatus 'today' and
// 'passed'/'expired' are all treated the same way here — only 'upcoming' is skipped.
export async function runExpirationReminderJob() {
  const preview = await getExpirationReminderPreview();

  for (const item of preview.items) {
    if (item.sendStatus === 'upcoming') continue;
    if (!item.contractNo) continue; // entity_key needs a real contract number to key on

    if (await isAlreadyLogged(JOB_TYPE, item.contractNo)) continue;

    try {
      await sendForItem(item);
    } catch (error) {
      console.error(`Expiration Reminder email failed for contract "${item.contractNo}":`, error);
    }
  }
}

// Legal > Email Monitor's manual "Send" action (scheduledEmailController.js) — sends
// the real email for one specific contract right now, regardless of sendStatus/log
// state, for verifying the template/recipients against real data before trusting the
// cron. Throws (never swallows) so the controller can surface the real reason to the
// page instead of a silent no-op.
export async function sendExpirationReminderNowById(id) {
  const preview = await getExpirationReminderPreview();
  const item = preview.items.find(i => i.id === Number(id));
  if (!item) throw new Error('Contract not found or not eligible for an expiration reminder.');
  if (!item.contractNo) throw new Error('This contract has no contract number yet.');
  return sendForItem(item);
}
