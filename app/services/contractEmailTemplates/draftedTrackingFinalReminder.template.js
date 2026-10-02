import { escapeHtml } from './emailLayout.js';

// Sent by app/jobs/draftedTracking.job.js — the follow-up to draftedTracking.template.js,
// fired on each round's own deadline date (15-Feb/15-Jun/15-Oct, 14 days after the
// initial 1-Feb/1-Jun/1-Oct notice) for a section whose contracts are STILL Drafted at
// that later date — re-queried fresh, same "always live data, never a frozen list"
// rule the initial notice already follows (see draftedTracking.template.js's own
// comment). Adds a Request Date column the initial notice doesn't have, and its own
// "final remind" copy — both transcribed verbatim from the reference mockup, not
// rewritten to "reminder" (matches this project's own "match the provided reference
// exactly" convention elsewhere).
//
// data: { section, contracts: [{contractNo, supplierName, contractType, requestDate, requestorName, remarkLabel}],
//         deadline (e.g. "15-Feb-2027"), from, systemUrl }
export function draftedTrackingFinalReminderTemplate(data) {
  const rowsHtml = data.contracts
    .map(
      (c, i) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; text-align: center;">${i + 1}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.contractNo || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.supplierName)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.contractType || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.requestorName || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.requestDate || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.remarkLabel || '-')}</td>
        </tr>`
    )
    .join('');

  // No inline "please log in" link here — unlike draftedTracking.template.js, the
  // reference mockup for this follow-up goes straight from the table to the sign-off.
  const systemLinkPlain = `<span style="color: #000000;">Contract Online System</span>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 680px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>

          <div style="margin-bottom: 12px; font-weight: bold; font-size: 16px;">FINAL REMINDER: Overdue Contract Requests of ${escapeHtml(data.section)}</div>

          <div style="margin-bottom: 16px;">
            Dear Section Head &amp; User of <b>${escapeHtml(data.section)}</b>
          </div>

          <div style="margin-bottom: 16px;">
            This is a final remind regarding <b>${data.contracts.length} outstanding contract request(s)</b> listed below,
            which remain incomplete as of the due date (<b>${escapeHtml(data.deadline)}</b>).
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <tr>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; text-align: center;">No.</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Contract No.</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Supplier Name</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Contract Type</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Requestor</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Request Date</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Remark</td>
            </tr>
            ${rowsHtml}
          </table>

          <div>Best Regards</div>
          <div>${systemLinkPlain}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
