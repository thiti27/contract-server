import { escapeHtml } from './emailLayout.js';

// Sent by app/jobs/expirationReminder.job.js — one per contract, on
// expire_date - reminder_before_expiry_days. Self-contained (not
// emailLayout.js's buildContractEmailHtml shell) for the same reason as
// draftedTracking.template.js — requestor-addressed greeting, not "Dear Approver".
//
// data: { requestor, supplierName, contractNo, contractType, purpose, expireDate, from, systemUrl }
export function expirationReminderTemplate(data) {
  const row = (label, value) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; width: 160px; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; vertical-align: top;">${escapeHtml(value ?? '')}</td>
        </tr>`;

  const rowsHtml = [
    row('Supplier', data.supplierName),
    row('Contract Type', data.contractType),
    row('Purpose', data.purpose),
    row('Expiration Date', data.expireDate),
    row('Requestor', data.requestor),
  ].join('');

  const systemLink = `<a href="${escapeHtml(data.systemUrl)}" target="_blank" style="color: #1a73e8;">Contract Online System</a>`;
  const systemLinkPlain = `<span style="color: #000000;">Contract Online System</span>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>

          <div style="margin-bottom: 16px; font-weight: bold;">Dear ${escapeHtml(data.requestor)}</div>

          <div style="margin-bottom: 16px;">
            This is a reminder that the following contract is approaching its expiration date.
            Please log in the ${systemLink} to review and take the necessary action.
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>

          <br>
          <div>Best Regards</div>
          <div>${systemLinkPlain}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
