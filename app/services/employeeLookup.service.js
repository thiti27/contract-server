import { select } from '../../config/mysql.js';

// Approver email resolution — eds_db.employee (the same cross-database table
// employeeController.js/authController.js already query, one Sequelize connection, no
// new connection here either), looked up by em_id. Contract requests only ever store
// an approver's em_id (approver1_em_id/approver2_em_id/approver3_em_id), never an
// email address, so this is what turns one into the other before calling
// sendContractRequestEmail (contractEmail.service.js) — that function itself never
// does this lookup, it only ever takes a ready-made data.approverEmail string.
export async function getEmployeeEmail(emId) {
  if (!emId) return null;
  const rows = await select(`SELECT email FROM eds_db.employee WHERE em_id = :emId`, { emId });
  return rows[0]?.email || null;
}
