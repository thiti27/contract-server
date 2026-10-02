// Shared HTML shell every one of the 6 request-type templates builds on — same
// title/from/greeting/message/table/sign-off structure for all of them, just the
// intro sentence and table rows differ per template. Kept here (not duplicated 6
// times) since it's pure layout, not a template of its own — each real template still
// owns its own intro copy and field list, this only assembles them into one HTML
// string. No DB queries, no business logic — same "display only" rule the individual
// templates follow.
//
// Inline CSS only (no <style> block, no external stylesheet) — Outlook's rendering
// engine (Word-based) strips most non-inline CSS, so every rule that matters is
// written directly on the element it applies to.
//
// introText is inserted as-is (not escaped) — each template hardcodes it as a fixed
// literal with the type-specific phrase already wrapped in <b>...</b> (e.g. "A <b>new
// contract request</b> is waiting..."), never built from user/DB data, so there's
// nothing to escape and no injection risk. Every other value in this file (rows,
// title, from, systemUrl) still comes from real request data and stays escaped below.
export function buildContractEmailHtml({ title, from, introText, rows, systemUrl }) {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
        <tr>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; font-weight: bold; background-color: #f5f5f5; width: 180px; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border: 1px solid #cccccc; padding: 8px 12px; vertical-align: top;">${escapeHtml(value ?? '')}</td>
        </tr>`
    )
    .join('');

  // "Contract Online System" appears twice: inline in "Please log in the ___ to
  // review" (still a clickable link to data.systemUrl — an approver actually needs to
  // get there from this sentence) and again as the closing sign-off, which is now
  // plain black text with no link at all, same as every other contract email's own
  // sign-off (approvedContract/returnContract/waivedContract.template.js).
  const systemLink = `<a href="${escapeHtml(systemUrl)}" target="_blank" style="color: #1a73e8;">Contract Online System</a>`;
  const systemLinkPlain = `<span style="color: #000000;">Contract Online System</span>`;

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; padding: 20px;">
      <tr>
        <td>

          <div style="margin-bottom: 12px;font-weight: bold;">Dear Approver</div>

          <div style="margin-bottom: 8px;">${introText}</div>
          <div style="margin-bottom: 16px;">Please log in the ${systemLink} to review and approval or reject it.</div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            ${rowsHtml}
          </table>
          <br/>
          <div>Best Regards</div>
          <div>${systemLinkPlain}</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Templates only ever interpolate plain data-field values (supplier names, dates,
// free-text reasons/details typed by a requester) — never trusted HTML — so every
// value is escaped before landing in the HTML string.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
