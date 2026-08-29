import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { select } from '../../config/mysql.js';
import { toDateOnly } from '../../app/utils/dateUtils.js';
import { ApiError } from '../../app/utils/apiError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/excel/ sits two levels below the project root (where templates/ lives).
const projectRoot = path.join(__dirname, '..', '..');

// The Contract Requisition Form.xlsx template is the real, official company form —
// same file contravct-web/public/ serves as the blank downloadable template on the
// Download Form page. It's duplicated here (not read cross-project from contravct-web)
// because this server's own Docker build context only ever copies contract-server's
// own directory (`COPY . /usr/src/app` in Dockerfile) — a path reaching into a sibling
// project wouldn't exist inside the container. If the official form is ever redesigned,
// both copies need updating together.
export const TEMPLATE_PATH = path.join(projectRoot, 'templates', 'Contract Requisition Form.xlsx');

const SHEET_NAME = 'Sheet1';

// document_type (contract_request_documents) -> the checklist checkbox cell it drives
// on the template's "Related Contract Document" list (rows 28-34).
const DOCUMENT_CHECKBOX_CELL = {
  drafted: 'B28',
  quotation: 'B29',
  specification: 'B30',
  drawing: 'B31',
  schedule: 'B32',
  company_certificate: 'B33',
  other: 'B34',
};

// contract_requests.remark -> the Remark checkbox cell in the Approver/Remark table
// (rows 50-55), one row per remark in the same order the template lists them.
const REMARK_CHECKBOX_CELL = {
  new: 'K50',
  renew: 'K51',
  amend: 'K52',
  claim: 'K53',
  terminate: 'K54',
  cancel: 'K55',
};

// The 3 approver slots' "Signature (signe & date)" cell — top-to-bottom the template
// lists Manager (approver3, the final/top sign-off) then two Supervisor rows
// (approver2, approver1) — same bottom-up numbering used throughout this app (see
// approvalController.js's STAGE_COLUMN / updateEditableFields' approver1EmId mapping).
const APPROVER_SIGNATURE_CELL = { approver3: 'G50', approver2: 'G52', approver1: 'G54' };

// Row 28 through row 41 is the full height of both the "Related Contract Document"
// checklist (column B) and the "Requestor/Supervisor/LG/Others's Comment" list (column
// H) on the template — 14 lines available for comments before running off the printed
// page. A request with more comments than that just shows the most recent ones; there's
// no more physical space on this fixed-layout form for the rest.
const COMMENT_ROWS = Array.from({ length: 14 }, (_, i) => 28 + i);

function formatMoney(value) {
  if (value == null || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignatureCell(name, approvedAt) {
  if (!name) return '';
  const date = toDateOnly(approvedAt);
  return date ? `${name}\n${date}` : name;
}

async function loadContractRequest(id) {
  const rows = await select(
    `SELECT cr.*, ct.name AS contract_type_name
     FROM contract_requests cr
     LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
     WHERE cr.id = :id AND cr.deleted_at IS NULL`,
    { id }
  );
  if (!rows.length) throw new ApiError(404, 'Contract request not found.');
  return rows[0];
}

async function loadDocumentChecklist(id) {
  return select(
    `SELECT document_type, checked FROM contract_request_documents
     WHERE contract_request_id = :id AND active = 1 AND deleted_at IS NULL`,
    { id }
  );
}

async function loadComments(id) {
  return select(
    `SELECT comment, commenter_name, role, created_at
     FROM contract_request_comments
     WHERE contract_request_id = :id AND active = 1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    { id }
  );
}

function setCell(sheet, address, value) {
  sheet.getCell(address).value = value ?? '';
}

// The template's checklist/remark boxes are real Excel Form Control checkboxes (a
// shape linked to a boolean cell) — ExcelJS has no support for that legacy VML/
// ctrlProps object model, so re-saving the workbook silently drops the shapes and
// leaves the raw boolean showing through as literal "TRUE"/"FALSE" text. Writing a
// checkbox glyph directly into the cell instead reproduces the same visual outcome
// without needing the (unsupported) form control. Forced onto "DejaVu Sans" — always
// present on the Debian image this runs in — rather than the cell's own Tahoma, since
// Tahoma is aliased to a Thai-only font in fontconfig (see docker/fontconfig-tahoma-
// thai.conf) that isn't guaranteed to carry these particular Unicode ballot-box glyphs.
const CHECKBOX_CHECKED = '☑'; // ☑
const CHECKBOX_UNCHECKED = '☐'; // ☐
const CHECKBOX_FONT_NAME = 'DejaVu Sans';

function setCheckbox(sheet, address, checked) {
  const cell = sheet.getCell(address);
  cell.value = checked ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED;
  cell.font = { ...(cell.font || {}), name: CHECKBOX_FONT_NAME };
}

// Fills the official template's cells from one contract_requests row and saves the
// result to `outputXlsxPath`. Everything this form has a place to show (Contract Info,
// Payment Term, Document checklist, Requestor/Section, Approver signatures, Remark,
// recent Comments) is filled in; the newer Renew/Amend/Terminate/Claim Note/Cancel
// "___ Information" fields (see ActionInfoSection.jsx) have no corresponding section on
// this physical form and are intentionally left out rather than bolted on as new rows —
// this must stay the real, unmodified company template, not a redesigned one.
export async function generateFilledXlsx(contractRequestId, outputXlsxPath) {
  const [row, documents, comments] = await Promise.all([
    loadContractRequest(contractRequestId),
    loadDocumentChecklist(contractRequestId),
    loadComments(contractRequestId),
  ]);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`Template is missing the expected "${SHEET_NAME}" worksheet.`);

  setCell(sheet, 'A4', row.contract_type_name);
  setCell(sheet, 'L3', row.contract_no);
  setCell(sheet, 'L4', toDateOnly(row.approver3_approved_at));

  setCell(sheet, 'C7', row.supplier_name);
  setCell(sheet, 'K7', toDateOnly(row.request_date));
  setCell(sheet, 'C8', toDateOnly(row.delivery_date));
  setCell(sheet, 'K8', row.location);
  setCell(sheet, 'C9', row.warranty_period);
  setCell(sheet, 'K9', row.refer_contract_no);
  setCell(sheet, 'D10', row.brief_description);

  setCell(sheet, 'C16', formatMoney(row.total_net_price));
  setCell(sheet, 'F16', row.vat);
  setCell(sheet, 'I16', row.currency);
  setCell(sheet, 'L16', row.trade_term);
  setCell(sheet, 'C18', row.payment1);
  setCell(sheet, 'J18', row.payment2);
  setCell(sheet, 'C19', row.payment3);
  setCell(sheet, 'J19', row.payment4);
  setCell(sheet, 'C20', row.payment5);
  setCell(sheet, 'J20', row.payment6);
  setCell(sheet, 'C21', row.payment7);
  setCell(sheet, 'J21', row.payment8);
  setCell(sheet, 'D22', row.payment_other);

  const checkedByType = Object.fromEntries(documents.map(d => [d.document_type, !!d.checked]));
  for (const [documentType, cellAddress] of Object.entries(DOCUMENT_CHECKBOX_CELL)) {
    setCheckbox(sheet, cellAddress, !!checkedByType[documentType]);
  }

  setCell(sheet, 'C47', row.requestor_name);
  setCell(sheet, 'K47', row.requestor_section);

  for (const [remark, cellAddress] of Object.entries(REMARK_CHECKBOX_CELL)) {
    setCheckbox(sheet, cellAddress, remark === row.remark);
  }

  setCell(sheet, APPROVER_SIGNATURE_CELL.approver3, formatSignatureCell(row.approver3_name, row.approver3_approved_at));
  setCell(sheet, APPROVER_SIGNATURE_CELL.approver2, formatSignatureCell(row.approver2_name, row.approver2_approved_at));
  setCell(sheet, APPROVER_SIGNATURE_CELL.approver1, formatSignatureCell(row.approver1_name, row.approver1_approved_at));

  comments.slice(0, COMMENT_ROWS.length).forEach((comment, index) => {
    const rowNumber = COMMENT_ROWS[index];
    const label = [comment.role, comment.commenter_name].filter(Boolean).join(' - ');
    setCell(sheet, `H${rowNumber}`, label ? `${label}: ${comment.comment}` : comment.comment);
  });

  await workbook.xlsx.writeFile(outputXlsxPath);
  return { contractNo: row.contract_no || null };
}
