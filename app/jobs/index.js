import cron from 'node-cron';
import { runDraftedTrackingJob } from './draftedTracking.job.js';
import { runExpirationReminderJob } from './expirationReminder.job.js';

// Both jobs are daily-tick + log-driven rather than cron-expression-per-trigger-date:
// each one recomputes "is anything due (or overdue) right now" from current data and
// scheduled_email_log every time it runs, so a single '0 7 * * *' (07:00 Asia/Bangkok,
// matching the DB session timezone — config/mysql.js) schedule covers both real
// trigger dates AND catch-up after downtime, with no separate recovery logic needed.
// See each job file's own comment for its exact due/catch-up rule.
export function registerJobs() {
  cron.schedule(
    '0 7 * * *',
    () => {
      runDraftedTrackingJob().catch(err => console.error('Drafted Tracking job failed:', err));
      runExpirationReminderJob().catch(err => console.error('Expiration Reminder job failed:', err));
    },
    { timezone: 'Asia/Bangkok' }
  );
}
