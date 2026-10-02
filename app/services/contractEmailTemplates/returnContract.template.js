import { escapeHtml } from './emailLayout.js';

// escapeHtml neutralizes HTML special characters but leaves literal "\n"s alone —
// email clients collapse those to a single space same as any other HTML whitespace, so
// a multi-line Purpose/Reason/Amended Detail (all free-text textareas elsewhere in the
// app) loses every line break the user actually typed once it lands in one of this
// template's <td> cells. Escape first, then turn newlines into <br> so those breaks
// survive into the rendered email.
function escapeHtmlPreserveLines(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

// Sent once, when an approver Returns a request for revision (status -> 'Returned',
// any remark — approvalController.js's returnRequest). Goes to the Requestor, never
// CC'd (nothing's finished, this stays between the requestor and whoever returned it)
// and never shows a Contract No. row (no number is minted until the chain actually
// reaches Drafted). `comments` is the approver's own Return comment split into one
// line per non-empty line they typed (contractRequestHelper.js's
// notifyRequestorReturned) — rendered as plain blue lines with no bullet/number and no
// gap between them, matching how a reviewer actually writes a "please fix these" note.
//
// data: { supplierName, requestor, rows: [{label, value, caption?}], comments: string[], from, systemUrl }
export function returnContractTemplate(data) {
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

  // Falls back to one plain "please review" item if the approver's comment somehow
  // came through empty (the action already requires a non-empty comment client- and
  // server-side, so this is only a display safety net, never expected in practice).
  const commentItems = data.comments && data.comments.length ? data.comments : ['Please review the comments from your supervisor.'];
  const commentsHtml = commentItems.map(line => `<div style="color: #1a73e8;">${escapeHtmlPreserveLines(line)}</div>`).join('');

 

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>
 

         <div style="margin-bottom: 16px; font-weight: bold;">Dear ${escapeHtml(data.requestor)}</div>

          <div style="margin-bottom: 8px;">
            Your supervisor has provided comments and requested that you review and make the following revisions/additions to the contract:
          </div>
          <div style="margin: 0 0 16px;">
            ${commentsHtml}
          </div>

          <div style="margin-bottom: 16px;">Please review and revise the contract accordingly before resubmitting your request.</div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>
<br>
          <div>Best Regards</div>
          <div>Contract Online System</div>
     
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
