import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { select } from '../../config/mysql.js';
import { hasConfidentialAccess } from '../../helpers/contractRequestHelper.js';
import { generateFilledXlsx } from '../../services/excel/contractExcelService.js';
import { convertXlsxToPdf } from '../../services/pdf/libreOfficeService.js';
import { ApiError } from '../utils/apiError.js';
import { handleApprovalError } from '../middleware/errorHandler.js';

// Every PDF request gets its own scratch directory (and, inside libreOfficeService,
// its own LibreOffice user profile) under the OS temp dir — never a fixed path —
// so multiple users generating a PDF at the same moment can't collide with or
// overwrite each other's in-flight files.
async function withJobDir(fn) {
  const jobDir = path.join(os.tmpdir(), `pdf-job-${randomUUID()}`);
  await fs.mkdir(jobDir, { recursive: true });
  try {
    return await fn(jobDir);
  } finally {
    // Best-effort cleanup on both the success and error paths — a failed conversion
    // shouldn't leave its scratch files behind any more than a successful one should.
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function downloadContractPdf(req, res) {
  const { id } = req.params;

  try {
    const rows = await select(
      `SELECT contract_no, confidentiality, created_by, approver1_em_id, approver2_em_id, approver3_em_id
       FROM contract_requests WHERE id = :id AND deleted_at IS NULL`,
      { id }
    );
    const row = rows[0];
    if (!row) throw new ApiError(404, 'Contract request not found.');
    if (!hasConfidentialAccess(row, req.user)) {
      throw new ApiError(403, 'You do not have permission to download this contract.');
    }

    await withJobDir(async jobDir => {
      const xlsxPath = path.join(jobDir, 'generated.xlsx');
      const profileDir = path.join(jobDir, 'lo-profile');

      const { contractNo } = await generateFilledXlsx(id, xlsxPath);
      const pdfPath = await convertXlsxToPdf(xlsxPath, jobDir, profileDir);

      const downloadName = `${contractNo || `Contract-${id}`}.pdf`;
      await new Promise((resolve, reject) => {
        res.download(pdfPath, downloadName, err => (err ? reject(err) : resolve()));
      });
    });
  } catch (err) {
    // res.download may have already started/flushed the response on a late failure
    // (e.g. the client disconnecting mid-transfer) — only send an error response if
    // nothing has gone out yet, matching this project's other download endpoints.
    if (res.headersSent) return;
    handleApprovalError(err, res);
  }
}
