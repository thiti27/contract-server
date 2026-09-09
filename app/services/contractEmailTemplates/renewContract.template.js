import { buildContractEmailHtml } from './emailLayout.js';

export function renewContractTemplate(data) {
  return buildContractEmailHtml({
    title: `Request Renew Contract : ${data.supplierName} (${data.contractNo || ''})`,
    from: data.from,
    introText: 'A <b>renewal contract request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Purpose/Reason', value: data.purpose },
      { label: 'Original Period', value: data.originalPeriod },
      { label: 'New Period', value: data.newPeriod },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
