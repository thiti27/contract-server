import { buildContractEmailHtml } from './emailLayout.js';

// Pure HTML builder — no DB queries, no business logic beyond arranging data.requestType
// NEW's fields into the shared layout. contractEmail.service.js already validated every
// field used here exists before calling this.
export function newContractTemplate(data) {
  return buildContractEmailHtml({
    title: `Request New Contract : ${data.supplierName} `,
    from: data.from,
    introText: 'A <b>new contract request</b> is waiting for your review and approval.',
    systemUrl: data.systemUrl,
    rows: [
      { label: 'Supplier', value: data.supplierName },
      { label: 'Contract Type', value: data.contractType },
      { label: 'Purpose', value: data.purpose },
      { label: 'Net Price', value: data.netPrice },
      { label: 'Delivery', value: data.delivery },
      { label: 'Requestor', value: data.requestor },
    ],
  });
}
