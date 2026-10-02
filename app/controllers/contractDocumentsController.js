import { select } from '../../config/mysql.js';
import { hasConfidentialAccess } from '../../helpers/contractRequestHelper.js';

// ---------------------------------------------------------------------------
// Contract Documents (public page behind the "Download Contract Documents" link in
// contract emails — see approvedContract.template.js) — the one place in this API
// that's reachable by a logged-out visitor. A non-confidential contract's documents
// are open to anyone with the link/contract_no; a HIGH CONFIDENTIAL one requires
// login, then the same creator/`view`/approver rule every other confidential check in
// this app already uses (hasConfidentialAccess). Actually building the download itself
// reuses the existing GET /requests/:id + GET /uploads/:id/download endpoints — see
// request.routes.js/upload.routes.js's optionalAuthenticate — this controller only
// answers "what would happen if I tried" so the frontend can show the right state
// (download button vs. login redirect vs. Access Denied) BEFORE it fetches anything
// that route would actually gate.
// ---------------------------------------------------------------------------

async function findByContractNo(contractNo) {
  const rows = await select(
    `SELECT c.id, c.contract_no, c.supplier_name, c.status, c.confidentiality,
            c.created_by, c.approver1_em_id, c.approver2_em_id, c.approver3_em_id,
            ct.name AS type
     FROM contract_requests c
     LEFT JOIN contract_types ct ON ct.id = c.contract_type_id
     WHERE c.contract_no = :contractNo AND c.deleted_at IS NULL
     ORDER BY c.id DESC
     LIMIT 1`,
    { contractNo }
  );
  return rows[0] || null;
}

export async function getContractDocumentsInfo(req, res) {
  const { contractNo } = req.params;
  const row = await findByContractNo(contractNo);
  if (!row) return res.status(404).json({ message: 'Contract not found.' });

  const confidential = !!row.confidentiality;
  // hasConfidentialAccess reads the row's real (snake_case) column names directly —
  // the same shape every other confidentiality check in this app already passes it.
  const authorized = !confidential || hasConfidentialAccess(row, req.user);

  res.json({
    id: row.id,
    contractNo: row.contract_no,
    supplierName: row.supplier_name,
    type: row.type,
    status: row.status,
    confidentiality: confidential,
    // requiresLogin: true only distinguishes "you'd be authorized if you logged in" —
    // an already-logged-in, still-unauthorized visitor gets authorized:false,
    // requiresLogin:false instead (Access Denied, not a login redirect).
    authorized,
    requiresLogin: confidential && !authorized && !req.user,
  });
}
