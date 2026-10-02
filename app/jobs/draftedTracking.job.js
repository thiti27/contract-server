import { getDraftedTrackingPreview, DRAFTED_TRACKING_ROUNDS } from '../services/scheduledEmailPreview.service.js';
import { getEmployeeEmail } from '../services/employeeLookup.service.js';
import { sendDraftedTrackingEmail, sendDraftedTrackingFinalReminderEmail } from '../services/scheduledEmail.service.js';
import { isAlreadyLogged, logSend } from '../services/scheduledEmailLog.service.js';

// mysql2 already returns DATE columns as plain 'yyyy-mm-dd' strings (verified against
// live data) — this only guards against a Date object showing up in some other
// environment/driver config, same defensive slice the frontend's formatDateOnly avoids
// needing only because it already goes through an Intl formatter.
function dateOnly(value) {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

const MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const JOB_TYPE = 'drafted_tracking';
const FINAL_JOB_TYPE = 'drafted_tracking_final';

// Shared by the cron loop below and sendDraftedTrackingNow/sendDraftedTrackingFinalReminderNow
// (the Email Monitor page's manual Send actions) — resolves recipients, sends, and
// always logs the attempt (success or failure) for one section/round. TO = every
// distinct requestor in the section (the "User of {Section}" audience); CC = union of
// approver1-3 across every listed contract (the "Section Head/Supervisor/Manager"
// audience) + Legal. No isAlreadyLogged check in here on purpose, same reasoning as
// expirationReminder.job.js's sendForItem: the cron loop enforces "once per (section,
// round, year)" for its own automatic run, while a manual send is an explicit human
// action and is always allowed to (re)send.
//
// `final` picks the FINAL REMINDER template/subject/job_type instead of the initial
// notice's — same recipients and contract list either way, just the follow-up copy
// (draftedTrackingFinalReminder.template.js) sent again on the round's deadline date
// for a section still not resolved by then.
async function sendForSectionRound(section, round, year, { final = false } = {}) {
  const deadline = `${round.deadlineDay}-${MONTH_LABEL[round.deadlineMonth]}-${year}`;
  const jobType = final ? FINAL_JOB_TYPE : JOB_TYPE;
  const entityKey = `${section.section}_${year}_${round.key}`;
  const contractRequestIds = section.contracts.map(c => c.id);
  const sendFn = final ? sendDraftedTrackingFinalReminderEmail : sendDraftedTrackingEmail;

  let to = [];
  let cc = [];
  try {
    to = (await Promise.all(section.requestors.map(r => getEmployeeEmail(r.emId)))).filter(Boolean);
    if (!to.length) throw new Error(`No email on file for any requestor in section "${section.section}".`);

    const approverEmails = await Promise.all(section.ccApprovers.map(a => getEmployeeEmail(a.emId)));
    const legalEmails = await Promise.all(section.ccLegal.map(l => getEmployeeEmail(l.emId)));
    cc = [...new Set([...approverEmails, ...legalEmails].filter(Boolean))];

    await sendFn({
      to,
      cc,
      section: section.section,
      contracts: section.contracts.map(c => ({
        contractNo: c.contractNo,
        supplierName: c.supplierName,
        contractType: c.contractType,
        requestDate: dateOnly(c.requestDate),
        requestorName: c.requestorName,
        remarkLabel: c.remarkLabel,
      })),
      deadline,
    });

    await logSend({ jobType, entityKey, contractRequestIds, to, cc, status: 'success' });
    return { to, cc };
  } catch (error) {
    await logSend({ jobType, entityKey, contractRequestIds, to, cc, status: 'failed', errorMessage: error.message });
    throw error;
  }
}

// Overdue Contract Requests — run daily (see app/jobs/index.js). The round is
// purely a notification cycle (Feb 1 / Jun 1 / Oct 1, each with its own FINAL
// REMINDER follow-up on 15-Feb/15-Jun/15-Oct) — every fire/final-reminder date that
// has been reached sends the SAME underlying content: every contract that is
// currently status = 'Drafted' for that section, regardless of when it was
// requested. Sends once per (section, round, year) per stage — scheduled_email_log
// is what makes this idempotent no matter how many days in a row this runs.
export async function runDraftedTrackingJob() {
  const today = new Date();
  const year = today.getFullYear();

  for (const round of DRAFTED_TRACKING_ROUNDS) {
    const fireDateThisYear = new Date(year, round.fireMonth - 1, round.fireDay);
    const finalReminderDateThisYear = new Date(year, round.deadlineMonth - 1, round.deadlineDay);
    const fireDue = today >= fireDateThisYear;
    const finalDue = today >= finalReminderDateThisYear;
    if (!fireDue && !finalDue) continue; // neither stage of this round has reached its date yet this year

    const preview = await getDraftedTrackingPreview();

    for (const section of preview.sections) {
      if (fireDue) {
        const entityKey = `${section.section}_${year}_${round.key}`;
        if (!(await isAlreadyLogged(JOB_TYPE, entityKey))) {
          try {
            await sendForSectionRound(section, round, year, { final: false });
          } catch (error) {
            // Same "never let one failure take down the whole run" rule as
            // notifyApproverForContractRequest (contractRequestHelper.js) — log and
            // move on rather than aborting the rest of this job's run.
            console.error(`Drafted Tracking email failed for section "${section.section}", round "${round.key}":`, error);
          }
        }
      }

      if (finalDue) {
        const finalEntityKey = `${section.section}_${year}_${round.key}`;
        if (!(await isAlreadyLogged(FINAL_JOB_TYPE, finalEntityKey))) {
          try {
            await sendForSectionRound(section, round, year, { final: true });
          } catch (error) {
            console.error(`Drafted Tracking FINAL REMINDER failed for section "${section.section}", round "${round.key}":`, error);
          }
        }
      }
    }
  }
}

// Legal > Email Monitor's manual "Send" action (scheduledEmailController.js) — sends
// the real email for one section's given round right now, regardless of that
// round's eligible/sent state, for verifying the template/recipients against real
// data before trusting the cron. Throws (never swallows) so the controller can
// surface the real reason to the page instead of a silent no-op.
export async function sendDraftedTrackingNow(sectionName, roundKey) {
  const round = DRAFTED_TRACKING_ROUNDS.find(r => r.key === roundKey);
  if (!round) throw new Error(`Unknown round "${roundKey}".`);

  const preview = await getDraftedTrackingPreview();
  const section = preview.sections.find(s => s.section === sectionName);
  if (!section) throw new Error('Section not found or has no Drafted contracts.');

  return sendForSectionRound(section, round, new Date().getFullYear(), { final: false });
}

// Same as sendDraftedTrackingNow above, for the FINAL REMINDER follow-up.
export async function sendDraftedTrackingFinalReminderNow(sectionName, roundKey) {
  const round = DRAFTED_TRACKING_ROUNDS.find(r => r.key === roundKey);
  if (!round) throw new Error(`Unknown round "${roundKey}".`);

  const preview = await getDraftedTrackingPreview();
  const section = preview.sections.find(s => s.section === sectionName);
  if (!section) throw new Error('Section not found or has no Drafted contracts.');

  return sendForSectionRound(section, round, new Date().getFullYear(), { final: true });
}
