import { buildContractEmailHtml } from './emailLayout.js';

// CANCEL's title (like its Subject — see contractEmail.service.js's SUBJECTS map) uses
// "Request to Cancel Contract:" with no space before the colon, unlike every other
// type's " : " — kept exactly as specified rather than reused from a shared format.
//
// Purpose (brief_description, the original contract's own description — carried over
// unedited onto this Cancel request at creation) shown just before Reason
// (cancel_reason, the Cancel-specific field) so the approver sees what's being
// cancelled and why it's being cancelled together.
export function cancelContractTemplate(data) {
  return buildContractEmailHtml({
    title: `Request to Cancel Contract: ${data.supplierName} (${data.contractNo || ''})`,
    from: data.from,
    introText: 'A <b>contract cancellation request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Purpose', value: data.purpose },
      { label: 'Reason', value: data.reason },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
