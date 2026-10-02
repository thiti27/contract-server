import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Contracts (Home / Job Status / Approval / Legal list screens) — contract_requests
// IS the contract registry; a contract and the request that created it are the same
// row, just further along in `status`.
// ---------------------------------------------------------------------------

// Shared by listContracts and exportContracts below — both filter the exact same
// rows, just render them differently (one page of grouped table rows vs. every
// matching row flattened into a report), so the WHERE clause only needs writing once.
function buildWhere(query) {
  const {
    supplier = '',
    contractNo = '',
    type = '',
    section = '',
    year = '',
    status = '',
    letter = '',
    statuses = '',
    hasContractNo = '',
    createdBy = '',
    approverEmId = '',
    legalCheck = '',
  } = query;

  const clauses = ['c.deleted_at IS NULL'];
  const replacements = {};

  if (supplier) {
    clauses.push('c.supplier_name LIKE :supplier');
    replacements.supplier = `%${supplier}%`;
  }
  if (contractNo) {
    clauses.push('c.contract_no LIKE :contractNo');
    replacements.contractNo = `%${contractNo}%`;
  }
  if (type) {
    clauses.push('ct.name LIKE :type');
    replacements.type = `%${type}%`;
  }
  if (section) {
    clauses.push('c.requestor_section LIKE :section');
    replacements.section = `%${section}%`;
  }
  if (year) {
    clauses.push('c.contract_year LIKE :year');
    replacements.year = `%${year}%`;
  }
  if (status) {
    clauses.push('c.status LIKE :status');
    replacements.status = `%${status}%`;
  }
  if (hasContractNo) {
    clauses.push("c.contract_no IS NOT NULL AND c.contract_no <> '-'");
  }
  if (letter) {
    clauses.push('c.supplier_name LIKE :letter');
    replacements.letter = `${letter}%`;
  }
  if (createdBy) {
    clauses.push('c.created_by = :createdBy');
    replacements.createdBy = createdBy;
  }
  if (approverEmId) {
    // Same "current stage's approver column matches this em_id" rule as
    // contractCounters.js's countWaitingApprove, just qualified with the `c` alias used here.
    clauses.push(`(
      (c.status = 'Waiting Approver 1' AND c.approver1_em_id = :approverEmId) OR
      (c.status = 'Waiting Approver 2' AND c.approver2_em_id = :approverEmId) OR
      (c.status = 'Waiting Approver 3' AND c.approver3_em_id = :approverEmId)
    )`);
    replacements.approverEmId = approverEmId;
  }
  if (legalCheck !== '') {
    clauses.push('c.legal_check = :legalCheck');
    replacements.legalCheck = legalCheck;
  }
  const statusList = statuses ? statuses.split(',').filter(Boolean) : [];
  if (statusList.length) {
    const placeholders = statusList.map((_, i) => `:status${i}`).join(', ');
    clauses.push(`c.status IN (${placeholders})`);
    statusList.forEach((s, i) => {
      replacements[`status${i}`] = s;
    });
  }

  return { where: clauses.join(' AND '), replacements };
}

export async function listContracts(req, res) {
  const { page = '1', pageSize = '10' } = req.query;
  const { where, replacements } = buildWhere(req.query);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.max(1, parseInt(pageSize, 10) || 10);
  const offset = (pageNum - 1) * size;

  const [totalRows, items] = await Promise.all([
    select(`SELECT COUNT(*) AS count FROM contract_requests c LEFT JOIN contract_types ct ON ct.id = c.contract_type_id WHERE ${where}`, replacements),
    select(
      `SELECT c.id, c.supplier_name AS supplier, c.contract_no AS contractNo, c.refer_contract_no AS referContractNo,
              c.remark, ct.name AS type, c.contract_purpose AS purpose,
              c.requestor_section AS section, c.contract_year AS year, c.expire_date AS expireDate, c.status,
              c.confidentiality, c.created_by AS createdBy,
              -- Exposed so the client can determine "is this viewer one of this job's 3
              -- approvers" directly from the job's own data (see ContractTable.jsx's
              -- confidentiality access check on All Job/Home) — not sensitive, em_ids are
              -- already visible elsewhere in this app (signatures, comments, ...).
              c.approver1_em_id AS approver1EmId, c.approver2_em_id AS approver2EmId, c.approver3_em_id AS approver3EmId,
              -- Exposed so the Legal Comment row action (My Job/Contract Making/Upload
              -- Contract/All Job/Home) can hide itself once legal_check = 1, same
              -- condition Legal > Waiting's own scope already uses server-side.
              c.legal_check AS legalCheck,
              -- Home only (ContractTable.jsx's Original At column) — 0/1 toggle, combined
              -- client-side with the section column above: false => requestor's own
              -- section (owner), true => the literal "Legal". See
              -- signedContractController.js's originalAt.
              c.original_at_legal AS originalAtLegal,
              c.updated_by AS updatedBy, c.updated_name AS updatedName, c.updated_at AS updatedAt
       FROM contract_requests c
       LEFT JOIN contract_types ct ON ct.id = c.contract_type_id
       WHERE ${where}
       -- Grouped display (Company -> master contract -> renew/amend/claim/terminate children,
       -- see ContractTable.jsx) needs same-company/same-master rows contiguous AND in
       -- revision order (base, then -01, -02, ...), so this sorts by: supplier, then the
       -- master contract_no (a child's refer_contract_no points back to it, grouping the
       -- family together), then the master itself first within that group, then each
       -- child by its own revision number — NOT by id/creation order, since a later-
       -- created child can finish approval (and so get numbered) before an earlier one,
       -- which would otherwise show "-02" above "-01".
       ORDER BY
         c.supplier_name ASC,
         COALESCE(NULLIF(c.refer_contract_no, ''), c.contract_no) ASC,
         (c.refer_contract_no IS NULL OR c.refer_contract_no = '') DESC,
         -- A pending Amend/Renew/Terminate/Claim Note still shows its Reference Item's
         -- own contract_no as a placeholder (see requestController.js's createRequest)
         -- until Approver 3 mints its real "-NN" suffix — without this, a still-pending
         -- child (contract_no identical to the group's own base number) would sort by
         -- the base year instead of a revision number, landing it above/among already-
         -- numbered siblings instead of after them.
         (c.refer_contract_no IS NOT NULL AND c.refer_contract_no <> '' AND c.contract_no = c.refer_contract_no) ASC,
         CAST(SUBSTRING_INDEX(c.contract_no, '-', -1) AS UNSIGNED) ASC,
         c.id ASC
       LIMIT ${size} OFFSET ${offset}`,
      replacements
    ),
  ]);

  res.json({ items, total: Number(totalRows[0].count), page: pageNum, pageSize: size });
}

// Home's Export button (see ContractFilters.jsx) — every row matching the current
// filters, ignoring pagination entirely (unlike listContracts above, no LIMIT/OFFSET),
// flattened into report order (by request_date, the date the request was actually
// submitted — "เรียงตามวันที่ขอสัญญาในระบบ") rather than the grouped supplier/master-
// contract order the on-screen table uses, plus the extra fields the report needs
// that the table doesn't (Effective/Expired Date from Upload Sign Contract, Requestor).
export async function exportContracts(req, res) {
  const { where, replacements } = buildWhere(req.query);

  const items = await select(
    `SELECT c.id, c.request_date AS requestDate, c.contract_no AS contractNo, c.supplier_name AS supplier,
            ct.name AS type, c.contract_purpose AS purpose, c.remark, c.status,
            c.contract_start_date AS effectiveDate, c.expire_date AS expiredDate,
            c.requestor_name AS requestorName, c.requestor_section AS section
     FROM contract_requests c
     LEFT JOIN contract_types ct ON ct.id = c.contract_type_id
     WHERE ${where}
     ORDER BY c.request_date ASC, c.id ASC`,
    replacements
  );

  res.json({ items });
}
