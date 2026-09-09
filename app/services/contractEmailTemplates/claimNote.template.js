import { buildContractEmailHtml } from './emailLayout.js';

export function claimNoteTemplate(data) {
  return buildContractEmailHtml({
    title: `Request Claim Note : ${data.supplierName} (${data.contractNo || ''})`,
    from: data.from,
    introText: 'A <b>claim note request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Reason', value: data.reason },
      { label: 'Claim Detail', value: data.claimDetail },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
