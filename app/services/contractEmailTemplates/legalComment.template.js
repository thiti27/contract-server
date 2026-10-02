import { escapeHtml } from './emailLayout.js';

// escapeHtml neutralizes HTML special characters but leaves literal "\n"s alone — see
// returnContract.template.js's own copy of this helper for the full reasoning.
function escapeHtmlPreserveLines(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

// Sent once per Legal Review Mode "Comment" click (Legal > Waiting, legalController.js's
// commentOnLegalRequest) — goes to the Requestor, CC'd to the 3 approvers ("Section
// Head") only, never Legal itself (Legal is the sender here, not a recipient — instead
// their own contact info is listed at the bottom via legalContactsLine so the
// requestor knows who to follow up with). Shows only the comment just submitted (this
// action IS that comment's creation, so "latest" is simply the one being sent), as
// plain blue lines with no bullet/number, same style as returnContract/
// waivedContract's own comment display elsewhere in this app.
//
// data: { requestor, remarkLabel, supplierName, contractNo, rows: [{label, value, caption?}],
//         comments: string[], legalContactsLine, from, systemUrl }
export function legalCommentTemplate(data) {
  const rowsHtml = data.rows
    .map(
      ({ label, value, caption }) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; width: 160px; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; vertical-align: top;">${escapeHtmlPreserveLines(value ?? '')}${
            caption ? ` <span style="color: #888888; font-size: 12px;">${escapeHtml(caption)}</span>` : ''
          }</td>
        </tr>`
    )
    .join('');

  const commentsHtml = (data.comments && data.comments.length ? data.comments : [''])
    .map(line => `<div style="color: #1a73e8;">${escapeHtmlPreserveLines(line)}</div>`)
    .join('');

  const systemLinkPlain = `<span style="color: #000000;">Contract Online System</span>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>

 

          <div style="margin-bottom: 2px;font-weight: bold;">Dear ${escapeHtml(data.requestor)}</div>
 

          <div style="margin-bottom: 8px;">Regarding your contract request, Legal Section has provided the following comments;</div>
          <div style="margin: 0 0 16px;">
            ${commentsHtml}
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>

          <div style="margin-bottom: 16px;">Any question, please contact ${escapeHtml(data.legalContactsLine)}</div>

          <div>Best Regards</div>
          <div>${systemLinkPlain}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
