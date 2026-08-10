// No background jobs exist yet in this project (confirmed: no node-cron usage
// anywhere in the codebase). This file is still the single registration point per
// the project's standard structure — server.js calls registerJobs() once at
// startup — so future jobs (e.g. sync.job.js, reminder.job.js, backup.job.js,
// notification.job.js) just get imported and scheduled here without touching
// server.js itself.
export function registerJobs() {
  // Intentionally empty — nothing to schedule yet.
}
