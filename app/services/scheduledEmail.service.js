import transporter from '../../config/mail.js';
import config from '../../config/config.js';
import { draftedTrackingTemplate } from './contractEmailTemplates/draftedTracking.template.js';
import { draftedTrackingFinalReminderTemplate } from './contractEmailTemplates/draftedTrackingFinalReminder.template.js';
import { expirationReminderTemplate } from './contractEmailTemplates/expirationReminder.template.js';

// Sending entry points for the two automated cron jobs (app/jobs/*.job.js).
// Kept separate from contractEmail.service.js's sendContractRequestEmail: both of
// these are always TO the requestor with a fixed CC shape, never "Dear Approver",
// so they don't fit that function's REQUIRED_FIELDS_BY_TYPE/approverEmail-as-`to`
// convention. Same shared transporter, same "never swallow a real send failure"
// rule — the caller (the job) decides how to handle a rejected promise.

// `to` is an array — every distinct requestor in the section (the "User of
// {Section}" audience) — nodemailer accepts an array of addresses directly.
export async function sendDraftedTrackingEmail({ to, cc, section, contracts, deadline, systemUrl }) {
  const from = config.email.from;
  const resolvedSystemUrl = systemUrl || config.systemUrl;
  const html = draftedTrackingTemplate({ section, contracts, deadline, systemUrl: resolvedSystemUrl });
  const subject = `Overdue Contract Requests of ${section}`;

  const mailOptions = { from, to, subject, html };
  if (cc && cc.length) mailOptions.cc = cc;

  console.log(`[Email] Sending "${subject}" to: ${to}` + (mailOptions.cc ? ` | cc: ${mailOptions.cc}` : ''));
  return transporter.sendMail(mailOptions);
}

// The follow-up to sendDraftedTrackingEmail above, fired on the round's deadline date
// — same TO/CC shape, different template/subject (see draftedTrackingFinalReminder
// .template.js).
export async function sendDraftedTrackingFinalReminderEmail({ to, cc, section, contracts, deadline, systemUrl }) {
  const from = config.email.from;
  const resolvedSystemUrl = systemUrl || config.systemUrl;
  const html = draftedTrackingFinalReminderTemplate({ section, contracts, deadline, systemUrl: resolvedSystemUrl });
  const subject = `FINAL REMINDER: Overdue Contract Requests of ${section}`;

  const mailOptions = { from, to, subject, html };
  if (cc && cc.length) mailOptions.cc = cc;

  console.log(`[Email] Sending "${subject}" to: ${to}` + (mailOptions.cc ? ` | cc: ${mailOptions.cc}` : ''));
  return transporter.sendMail(mailOptions);
}

export async function sendExpirationReminderEmail({ to, cc, requestor, supplierName, contractNo, contractType, purpose, expireDate, systemUrl }) {
  const from = config.email.from;
  const resolvedSystemUrl = systemUrl || config.systemUrl;
  const html = expirationReminderTemplate({ requestor, supplierName, contractNo, contractType, purpose, expireDate, systemUrl: resolvedSystemUrl });
  const subject = `Contract Expiration Reminder: ${supplierName} (${contractNo})`;

  const mailOptions = { from, to, subject, html };
  if (cc && cc.length) mailOptions.cc = cc;

  console.log(`[Email] Sending "${subject}" to: ${to}` + (mailOptions.cc ? ` | cc: ${mailOptions.cc}` : ''));
  return transporter.sendMail(mailOptions);
}
