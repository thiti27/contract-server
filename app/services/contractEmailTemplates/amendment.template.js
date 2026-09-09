import { buildContractEmailHtml } from './emailLayout.js';

export function amendmentTemplate(data) {
  return buildContractEmailHtml({
    title: `Request Contract Amendment : ${data.supplierName} (${data.contractNo || ''})`,
    from: data.from,
    introText: 'A <b>contract amendment request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Reason', value: data.reason },
      { label: 'Amended Detail', value: data.amendedDetail },
      { label: 'Effective Date', value: data.effectiveDate },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
