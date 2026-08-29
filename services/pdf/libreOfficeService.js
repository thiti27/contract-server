import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ApiError } from '../../app/utils/apiError.js';

// Overridable so a machine without `soffice` on PATH (or a non-standard install) can
// still point at the right binary via env — same override idiom config.js/config/env
// use elsewhere in this project (real env var wins, otherwise a sane default).
const LIBREOFFICE_BIN = process.env.LIBREOFFICE_BIN || 'soffice';

// Generous but bounded — LibreOffice headless conversion of a single-sheet form is
// normally a couple of seconds; this only exists to fail a stuck/hung `soffice`
// process instead of letting a request hang forever (see "Handle Timeout" requirement).
const CONVERT_TIMEOUT_MS = 60_000;

// Runs `soffice --headless --convert-to pdf ...` against one .xlsx and resolves once
// the .pdf actually exists on disk next to it (in `outDir`). Every concurrent caller
// gets its OWN LibreOffice user profile (`-env:UserInstallation=file://<profileDir>`) —
// without this, two simultaneous conversions fight over the same profile lock file and
// one of them fails outright, since headless LibreOffice otherwise treats concurrent
// invocations as the same running instance.
export async function convertXlsxToPdf(xlsxPath, outDir, profileDir) {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const profileUrl = `file://${profileDir.replace(/\\/g, '/')}`;

  await new Promise((resolve, reject) => {
    execFile(
      LIBREOFFICE_BIN,
      [`-env:UserInstallation=${profileUrl}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, xlsxPath],
      { timeout: CONVERT_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          if (err.killed || err.signal) {
            return reject(new ApiError(504, 'PDF generation timed out. Please try again.'));
          }
          if (err.code === 'ENOENT') {
            return reject(new ApiError(500, 'PDF conversion is not available on this server.'));
          }
          return reject(new Error(`LibreOffice conversion failed: ${stderr || err.message}`));
        }
        resolve(stdout);
      }
    );
  });

  const expectedName = `${path.basename(xlsxPath, path.extname(xlsxPath))}.pdf`;
  const pdfPath = path.join(outDir, expectedName);

  try {
    await fs.access(pdfPath);
  } catch {
    throw new Error('LibreOffice did not produce the expected PDF file.');
  }

  return pdfPath;
}
