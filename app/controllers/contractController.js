import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Contracts (Home / Job Status / Approval / Legal list screens) — contract_requests
// IS the contract registry; a contract and the request that created it are the same
// row, just further along in `status`.
// ---------------------------------------------------------------------------
export async function listContracts(req, res) {
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
    noNeededEmId = '',
    page = '1',
    pageSize = '10',
  } = req.query;

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
    let statusClause = `c.status IN (${placeholders})`;
    statusList.forEach((s, i) => {
      replacements[`status${i}`] = s;
    });
    // Job Status > My History's scope (statusList = HISTORY_STATUSES) never included
    // 'No Needed' — legal marking a request "No Need" ends its lifecycle without
    // going through any of those statuses. OR-ing it in here (rather than adding it to
    // statusList) keeps it scoped to rows the current user created, unlike every other
    // status in this list which is shown regardless of who created the row.
    if (noNeededEmId) {
      statusClause = `(${statusClause} OR (c.status = 'No Needed' AND c.created_by = :noNeededEmId))`;
      replacements.noNeededEmId = noNeededEmId;
    }
    clauses.push(statusClause);
  }

  const where = clauses.join(' AND ');
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
              c.updated_by AS updatedBy, c.updated_name AS updatedName, c.updated_at AS updatedAt
       FROM contract_requests c
       LEFT JOIN contract_types ct ON ct.id = c.contract_type_id
       WHERE ${where}
       -- Grouped display (Company -> master contract -> renew/amend/claim/terminate children,
       -- see ContractTable.jsx) needs same-company/same-master rows contiguous, so this sorts by
       -- supplier, then by the master contract_no (a child's refer_contract_no points back to it),
       -- then by id so the master (lowest id in its group) leads its own children.
       ORDER BY c.supplier_name ASC, COALESCE(NULLIF(c.refer_contract_no, ''), c.contract_no) ASC, c.id ASC
       LIMIT ${size} OFFSET ${offset}`,
      replacements
    ),
  ]);

  res.json({ items, total: Number(totalRows[0].count), page: pageNum, pageSize: size });
}
