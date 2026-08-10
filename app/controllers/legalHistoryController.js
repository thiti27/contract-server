import { select } from '../../config/mysql.js';

// ---------------------------------------------------------------------------
// Legal > History — one row per Check/Terminate/Cancel/No Need action any legal
// user has taken. Unlike Approval > My History, this is NOT filtered by created_by:
// legal is a shared role queue, so every legal user sees the same combined history.
// ---------------------------------------------------------------------------
export async function listLegalHistory(req, res) {
  const {
    supplier = '',
    contractNo = '',
    type = '',
    section = '',
    status = '', // maps to clh.action (Check/Terminate) — same filter shape as ContractFilters' STATUS field
    page = '1',
    pageSize = '10',
  } = req.query;

  const clauses = ['clh.deleted_at IS NULL', 'cr.deleted_at IS NULL'];
  const replacements = {};

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
    clauses.push('clh.action LIKE :status');
    replacements.status = `%${status}%`;
  }

  const where = clauses.join(' AND ');
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.max(1, parseInt(pageSize, 10) || 10);
  const offset = (pageNum - 1) * size;

  const [totalRows, items] = await Promise.all([
    select(
      `SELECT COUNT(*) AS count FROM contract_legal_history clh
       JOIN contract_requests cr ON cr.id = clh.contract_request_id
       LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
       WHERE ${where}`,
      replacements
    ),
    select(
      `SELECT clh.id, clh.contract_request_id AS contractRequestId, clh.action,
              clh.\`by\` AS updatedName, clh.created_at AS updatedAt,
              cr.supplier_name AS supplier, cr.contract_no AS contractNo, cr.remark AS remark,
              ct.name AS type, cr.contract_purpose AS purpose
       FROM contract_legal_history clh
       JOIN contract_requests cr ON cr.id = clh.contract_request_id
       LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
       WHERE ${where}
       ORDER BY clh.created_at DESC
       LIMIT ${size} OFFSET ${offset}`,
      replacements
    ),
  ]);

  res.json({ items, total: Number(totalRows[0].count), page: pageNum, pageSize: size });
}
