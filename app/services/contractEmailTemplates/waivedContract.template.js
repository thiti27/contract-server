import { escapeHtml } from './emailLayout.js';

// escapeHtml neutralizes HTML special characters but leaves literal "\n"s alone —
// same gap returnContract.template.js fixes for its own row values/comment lines: a
// line break the user actually typed would otherwise collapse away once it lands in
// the rendered HTML. Escape first, then turn newlines into <br> so those breaks survive.
function escapeHtmlPreserveLines(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

// Sent once, when a Manager (Approver 3, approvalController.js's waiveRequest) or
// Legal (legalController.js's waiveLegalRequest) clicks Waive — the request skips
// straight to Signed without going through the rest of the normal review. Same
// Requestor-facing shape as approvedContract.template.js (Contract No. row, CC'd,
// generic per-remark rows) but with its own bold intro naming WHO waived it
// (data.waivedBy: 'Manager' | 'Legal') and the waive comment as plain blue lines with no
// number/bullet and no gap between them — same pattern returnContract.template.js
// already uses for a Return comment.
//
// data: { supplierName, contractNo, waivedBy, requestor, rows: [{label, value, caption?}],
//         comments: string[], from, systemUrl }
export function waivedContractTemplate(data) {
  const rowsHtml = data.rows
    .map(
      ({ label, value, caption }) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; width: 160px; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; vertical-align: top;">${escapeHtml(value ?? '')}${
            caption ? ` <span style="font-weight: bold;">${escapeHtml(caption)}</span>` : ''
          }</td>
        </tr>`
    )
    .join('');

  // Falls back the same way returnContract.template.js's comment list does — the
  // action already requires a non-empty comment either way, so this is only a
  // display safety net.
  const commentItems = data.comments && data.comments.length ? data.comments : ['Reason not provided.'];
  const commentsHtml = commentItems
    .map(line => `<div style="color: #1a73e8; font-weight: 600;">${escapeHtmlPreserveLines(line)}</div>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>


<div style="margin-bottom: 2px; font-weight: bold;">Dear ${escapeHtml(data.requestor)}</div>
    
<br>
          <div style="margin-bottom: 8px; font-weight: bold;">
            The contract requirement has been waived for this ${escapeHtml(data.waivedBy)} request as on-time exception as a reason;
          </div>
          <div style="margin: 0 0 16px;">
            ${commentsHtml}
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>

          <div style="margin-bottom: 16px; color: #1a73e8;  ">
            Please note that this waiver applies to this request only and does not constitute a general exception.
            Any future request will be reviewed and determined by your manager or legal section on a case-by-case basis.
          </div>
 
          <div>Best Regards</div>
          <div>Contract Online System</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}


