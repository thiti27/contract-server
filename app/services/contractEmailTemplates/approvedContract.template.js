import { escapeHtml } from './emailLayout.js';

// Sent once, when the last approver's Approve completes a request's chain (status ->
// 'Drafted', any remark) — the ONE contract-email that goes to the Requestor instead
// of an approver, and the only one with a CC list (Section Head = the 3 approvers,
// plus every Legal user) and a "Download Contract Documents" link instead of an
// attachment. Deliberately not built on emailLayout.js's buildContractEmailHtml (that
// shell is "Dear Approver ... review and approve or reject it", wrong greeting/call-
// to-action/structure for this one) — self-contained instead, same "pure HTML string,
// no DB queries, no business logic" rule as every other template. `rows` (built by
// contractRequestHelper.js's buildDisplayRows/notifyRequestorApproved) already carries
// whichever fields this remark type actually has — this file only lays them out.
//
// data: { supplierName, requestor, rows: [{label, value, caption?}], from, systemUrl, documentsUrl }
export function approvedContractTemplate(data) {
  const rowsHtml = data.rows
    .map(
      ({ label, value, caption }) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; width: 160px; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; vertical-align: top;">${escapeHtml(value ?? '')}${
            caption ? ` <span style="color: #888888; font-size: 12px;">${escapeHtml(caption)}</span>` : ''
          }</td>
        </tr>`
    )
    .join('');

  // Plain text, not a link — no href, no underline, matching the same plain-text
  // sign-off every other contract email in this app already uses.
  const systemLink = `<span style="color: #000000;">Contract Online System</span>`;
  const downloadButton = `
    <a href="${escapeHtml(data.documentsUrl)}" target="_blank"
       style="display: inline-block; margin: 4px 0 20px; padding: 10px 20px; background-color: #FFD400; color: #000000; text-decoration: none; font-weight: bold; border-radius: 6px;">
      Click here to download the contract documents.
    </a>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>
  
          <div style="margin-bottom: 16px; font-weight: bold;">Dear ${escapeHtml(data.requestor)}</div>

          <div style="margin-bottom: 16px;">
            Your contract request has been approved by your supervisor, and the system has issued contract number.
            The details are as follows:
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>

          <br>
          <div>${downloadButton}</div>

          <br>
          <div style="margin-bottom: 8px; font-weight: bold;">Warning</div>
          <ol style="margin: 0 0 20px; padding-left: 20px;">
            <li style="margin-bottom: 10px;">
              Do not proceed with contract signing before obtaining internal approval or issuing a Purchase Order (PO), where applicable.<br/>
              <span style="color: #FF0000;">ห้ามให้เซ็นลงนามสัญญา ก่อนได้รับอนุมัติให้จัดซื้อจัดจ้างภายในบริษัทหรือก่อนออกใบสั่งซื้อ (ถ้ามี)</span>
            </li>
            <li style="margin-bottom: 10px;">
              The contract must be prepared and signed within 7 days of PO issuance.<br/>
              <span style="color: #FF0000;">ให้จัดทำสัญญาและลงนามในสัญญาให้แล้วเสร็จ<u style="color: #e11d48;">ภายใน 7 วันนับแต่ออกใบสั่งซื้อ</u></span>
            </li>
            <li style="margin-bottom: 10px;">
              General contracts may be completed before or within 7 days of PO issuance.<br/>
              <span style="color: #FF0000;">กรณีที่เป็นสัญญาทั่วไปสามารถทำสัญญาให้แล้วเสร็จ ก่อนออกใบสั่งซื้อได้ หรือภายใน 7 วันนับแต่ออกใบสั่งซื้อ</span>
            </li>
            <li>
              Non-Disclosure Agreements (NDAs) must be signed before any information is disclosed or joint activities commence.<br/>
              <span style="color: #FF0000;">กรณีที่เป็นสัญญารักษาความลับให้ดำเนินการลงนามให้แล้วเสร็จ <u style="color: #e11d48;">ก่อน</u>ส่งมอบข้อมูลหรือทำกิจกรรมร่วมกัน</span>
            </li>
          </ol>

          <div>Best Regards</div>
          <div>${systemLink}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

