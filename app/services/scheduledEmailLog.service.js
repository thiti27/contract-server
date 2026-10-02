import { select, insert } from '../../config/mysql.js';

// scheduled_email_log (schema.sql) — one row per send ATTEMPT (success or failure),
// a full audit trail rather than just the latest state. Both cron jobs check
// isAlreadyLogged before sending and call logSend right after, whether the send
// succeeded or threw.

// Only a status='success' row counts as "already sent" — a failed attempt (no email
// on file, SMTP error, ...) must never block tomorrow's retry of the same entity. A
// day the server misses a trigger date entirely still catches up correctly next run,
// since this is decided purely by whether a successful row already exists.
export async function isAlreadyLogged(jobType, entityKey) {
  const rows = await select(
    `SELECT 1 FROM scheduled_email_log WHERE job_type = :jobType AND entity_key = :entityKey AND status = 'success'`,
    { jobType, entityKey }
  );
  return rows.length > 0;
}

// Most recent SUCCESSFUL send per entity, for the Email Monitor page's own "Sent"
// column — a failed attempt shouldn't read as "sent" there either.
export async function getLoggedMap(jobType) {
  const rows = await select(
    `SELECT entity_key AS entityKey, MAX(sent_at) AS sentAt
     FROM scheduled_email_log
     WHERE job_type = :jobType AND status = 'success'
     GROUP BY entity_key`,
    { jobType }
  );
  return new Map(rows.map(r => [r.entityKey, r.sentAt]));
}

// Records one send attempt. `contractRequestIds` is always an array (a single-
// contract Expiration Reminder still wraps its one id) — stored as JSON so a
// section's Drafted Tracking email can list every contract it covered. `to`/`cc`
// accept an array or a single string; stored as a comma-joined string for easy
// reading back in a log viewer. `status` is 'success' or 'failed'; `errorMessage`
// is only meaningful for 'failed'.
export async function logSend({ jobType, entityKey, contractRequestIds, to, cc, status, errorMessage }) {
  await insert(
    `INSERT INTO scheduled_email_log
       (job_type, entity_key, contract_request_ids, recipient_to, recipient_cc, status, error_message, sent_at)
     VALUES (:jobType, :entityKey, :contractRequestIds, :to, :cc, :status, :errorMessage, NOW())`,
    {
      jobType,
      entityKey,
      contractRequestIds: JSON.stringify(contractRequestIds || []),
      to: joinRecipients(to),
      cc: joinRecipients(cc),
      status,
      errorMessage: errorMessage || null,
    }
  );
}

function joinRecipients(value) {
  if (!value) return null;
  return Array.isArray(value) ? value.join(', ') || null : value;
}
