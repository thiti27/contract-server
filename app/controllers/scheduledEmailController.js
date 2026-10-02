import { getDraftedTrackingPreview, getExpirationReminderPreview } from '../services/scheduledEmailPreview.service.js';
import { sendExpirationReminderNowById } from '../jobs/expirationReminder.job.js';
import {
  sendDraftedTrackingNow as sendDraftedTrackingNowJob,
  sendDraftedTrackingFinalReminderNow as sendDraftedTrackingFinalReminderNowJob,
} from '../jobs/draftedTracking.job.js';

// Legal-only, same as requireAdmin's reasoning in middleware/auth.js: the frontend
// route is already Legal-gated (RequireRole on /legal), this is what actually stops a
// non-legal logged-in user from calling the API directly.
function requireLegal(req, res) {
  if (!req.user?.legal) {
    res.status(403).json({ success: false, message: 'Legal permission is required.' });
    return false;
  }
  return true;
}

export async function draftedTrackingPreview(req, res) {
  if (!requireLegal(req, res)) return;
  res.json(await getDraftedTrackingPreview());
}

export async function expirationReminderPreview(req, res) {
  if (!requireLegal(req, res)) return;
  res.json(await getExpirationReminderPreview());
}

// Legal > Email Monitor's manual "Send" action — real send, not a dry-run, so the
// page can verify recipients/content against real data before trusting the cron.
export async function sendExpirationReminderNow(req, res) {
  if (!requireLegal(req, res)) return;
  try {
    const result = await sendExpirationReminderNowById(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// Legal > Email Monitor's manual "Send" action for a specific section + round.
export async function sendDraftedTrackingNow(req, res) {
  if (!requireLegal(req, res)) return;
  try {
    const result = await sendDraftedTrackingNowJob(req.params.section, req.params.round);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// Legal > Email Monitor's manual "Send" action for the FINAL REMINDER follow-up.
export async function sendDraftedTrackingFinalReminderNow(req, res) {
  if (!requireLegal(req, res)) return;
  try {
    const result = await sendDraftedTrackingFinalReminderNowJob(req.params.section, req.params.round);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}
