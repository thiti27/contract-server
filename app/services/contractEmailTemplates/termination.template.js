import { buildContractEmailHtml } from './emailLayout.js';

export function terminationTemplate(data) {
  return buildContractEmailHtml({
    title: `Request Contract Termination : ${data.supplierName} (${data.contractNo || ''})`,
    from: data.from,
    introText: 'A <b>contract termination request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Reason', value: data.reason },
      { label: 'Effective date', value: data.effectiveDate },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
