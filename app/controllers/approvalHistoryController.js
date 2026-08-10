import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Approval > My History — one row per Approve/Return/Reject action the logged-in
// user has taken (not a contract_requests row directly, so this is its own paginated
// query rather than reusing contractController.listContracts).
// ---------------------------------------------------------------------------
export async function listApprovalHistory(req, res) {
  const {
    emId = '',
    supplier = '',
    contractNo = '',
    type = '',
    section = '',
    status = '', // maps to cah.action (Approve/Return/Reject) — same filter shape as ContractFilters' STATUS field
    page = '1',
    pageSize = '10',
  } = req.query;
  if (!emId) return res.json({ items: [], total: 0, page: 1, pageSize: Number(pageSize) || 10 });

  const clauses = ['cah.created_by = :emId', 'cah.deleted_at IS NULL', 'cr.deleted_at IS NULL'];
  const replacements = { emId };

  if (supplier) {
    clauses.push('cr.supplier_name LIKE :supplier');
    replacements.supplier = `%${supplier}%`;
  }
  if (contractNo) {
    clauses.push('cr.contract_no LIKE :contractNo');
    replacements.contractNo = `%${contractNo}%`;
  }
  if (type) {
    clauses.push('ct.name LIKE :type');
    replacements.type = `%${type}%`;
  }
  if (section) {
    clauses.push('cr.requestor_section LIKE :section');
    replacements.section = `%${section}%`;
  }
  if (status) {
    clauses.push('cah.action LIKE :status');
    replacements.status = `%${status}%`;
  }

  const where = clauses.join(' AND ');
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.max(1, parseInt(pageSize, 10) || 10);
  const offset = (pageNum - 1) * size;

  const [totalRows, items] = await Promise.all([
    select(
      `SELECT COUNT(*) AS count FROM contract_approval_history cah
       JOIN contract_requests cr ON cr.id = cah.contract_request_id
       LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
       WHERE ${where}`,
      replacements
    ),
    select(
      `SELECT cah.id, cah.contract_request_id AS contractRequestId, cah.action,
              cah.created_by_name AS updatedName, cah.created_at AS updatedAt,
              cr.supplier_name AS supplier, cr.contract_no AS contractNo, cr.remark AS remark,
              ct.name AS type, cr.contract_purpose AS purpose
       FROM contract_approval_history cah
       JOIN contract_requests cr ON cr.id = cah.contract_request_id
       LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
       WHERE ${where}
       ORDER BY cah.created_at DESC
       LIMIT ${size} OFFSET ${offset}`,
      replacements
    ),
  ]);

  res.json({ items, total: Number(totalRows[0].count), page: pageNum, pageSize: size });
}
