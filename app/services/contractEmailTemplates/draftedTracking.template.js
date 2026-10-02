import { escapeHtml } from './emailLayout.js';

// Sent by app/jobs/draftedTracking.job.js — one per requestor_section, per round
// (Feb 1 / Jun 1 / Oct 1), listing every contract still stuck at 'Drafted' for
// anyone in that section. Copy/structure matches the reference mockup ("Overdue
// Contract Requests of {Section}" / "Dear Section Head & User of {Section}")
// exactly. Self-contained (not emailLayout.js's buildContractEmailHtml shell)
// since the greeting/call-to-action here doesn't fit "Dear Approver".
//
// data: { section, contracts: [{contractNo, supplierName, contractType, requestDate, requestorName, remarkLabel}],
//         deadline (e.g. "15-Feb-2027"), from, systemUrl }
export function draftedTrackingTemplate(data) {
  const rowsHtml = data.contracts
    .map(
      (c, i) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; text-align: center;">${i + 1}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.contractNo || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.supplierName)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.contractType || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.requestorName || '-')}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px;">${escapeHtml(c.remarkLabel || '-')}</td>
        </tr>`
    )
    .join('');

  const systemLink = `<a href="${escapeHtml(data.systemUrl)}" target="_blank" style="color: #1a73e8;">Contract Online System</a>`;
  const systemLinkPlain = `<span style="color: #000000;">Contract Online System</span>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>

          <div style="margin-bottom: 12px; font-weight: bold; font-size: 16px;">Overdue Contract Requests of ${escapeHtml(data.section)}</div>

          <div style="margin-bottom: 16px;">
            Dear Section Head &amp; User of <b>${escapeHtml(data.section)}</b>
          </div>

          <div style="margin-bottom: 16px;">
            Your section currently has <b>${data.contracts.length} contract request(s) that remain incomplete</b>.<br/>
            Kindly confirm the status of each item and take action to complete it by <b>${escapeHtml(data.deadline)}</b> without further delay.
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <tr>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; text-align: center;">No.</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Contract No.</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Supplier Name</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Contract Type</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Requestor</td>
              <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5;">Remark</td>
            </tr>
            ${rowsHtml}
          </table>

          <div style="margin-bottom: 16px;">Please log in the ${systemLink} to review and complete the required actions.</div>

          <div>Best Regards</div>
          <div>${systemLinkPlain}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
