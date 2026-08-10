import { Sequelize, QueryTypes } from 'sequelize';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
  host: config.db.host,
  port: Number(config.db.port),
  dialect: 'mysql',
  dialectOptions: { charset: 'utf8mb4' }, // explicit — don't rely on the server's default connection charset for Thai/emoji text
  timezone: '+07:00', // Bangkok — applied to both the MySQL session and JS Date <-> DATETIME conversion
  logging: false,
});

export { QueryTypes };

// Thin wrappers so controllers/helpers read a bit less noisily than
// sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) everywhere.
// `options` (e.g. { transaction }) is spread last so callers running inside a
// Sequelize transaction can pass it straight through without a special-cased helper.
export const select = (sql, replacements = {}, options = {}) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...options });

export const exec = (sql, replacements = {}, options = {}) =>
  sequelize.query(sql, { replacements, type: QueryTypes.RAW, ...options });

// INSERT helper that returns the new row's auto-increment id.
export const insert = async (sql, replacements = {}, options = {}) => {
  const [id] = await sequelize.query(sql, { replacements, type: QueryTypes.INSERT, ...options });
  return id;
};

// ---------------------------------------------------------------------------
// One-time schema + seed bootstrap, run once at startup (see initDatabase below,
// called once from server.js). Moved here verbatim from the old db/init.js —
// conceptually part of "configuring mysql" for this app (ensuring its schema and
// seed data exist) rather than a recurring job or a route-driven controller.
// ---------------------------------------------------------------------------

async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Note: chunks legitimately start with a `--` comment block (the header above each
  // CREATE TABLE) followed by real SQL on a later line — MySQL parses that fine as one
  // statement, so don't filter those out, only drop genuinely empty chunks.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await exec(statement);
    } catch (err) {
      // CREATE INDEX has no IF NOT EXISTS in MySQL — ignore "already exists" on reruns
      // so this script stays safely idempotent across server restarts.
      if (err.original?.code === 'ER_DUP_KEYNAME') continue;
      throw err;
    }
  }
}

async function countRows(table) {
  const rows = await select(`SELECT COUNT(*) AS count FROM \`${table}\``);
  return Number(rows[0].count);
}

// One-time structural migration for databases created before app_users/admin_users
// split their single name column into first_name/last_name (needed for the Approved
// By "Signature" format, first_name + first 2 letters of last_name). No-ops once the
// old column is gone — a fresh DB never has it, since schema.sql already creates
// these tables with first_name/last_name directly.
async function migrateNameColumn(table, oldColumn) {
  const cols = await select(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :oldColumn`,
    { table, oldColumn }
  );
  if (!cols.length) return;

  await exec(`ALTER TABLE \`${table}\` ADD COLUMN first_name VARCHAR(150) NOT NULL DEFAULT '' AFTER \`${oldColumn}\``);
  await exec(`ALTER TABLE \`${table}\` ADD COLUMN last_name VARCHAR(150) NOT NULL DEFAULT '' AFTER first_name`);
  await exec(
    `UPDATE \`${table}\`
     SET first_name = TRIM(SUBSTRING_INDEX(\`${oldColumn}\`, ' ', 1)),
         last_name = TRIM(SUBSTRING(\`${oldColumn}\`, LENGTH(SUBSTRING_INDEX(\`${oldColumn}\`, ' ', 1)) + 2))`
  );
  await exec(`ALTER TABLE \`${table}\` DROP COLUMN \`${oldColumn}\``);
}

// One-time additive migration for databases created before contract_requests grew
// approverN_name columns (the Signature captured at approval time, alongside the
// already-existing approverN_approved_at). Safe to rerun — ER_DUP_FIELDNAME means
// it's already there, same idiom as the CREATE INDEX handling in runSchema().
async function migrateApproverNameColumns() {
  const tryAddColumn = async sql => {
    try {
      await exec(sql);
    } catch (err) {
      if (err.original?.code === 'ER_DUP_FIELDNAME') return;
      throw err;
    }
  };

  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN approver1_name VARCHAR(150) AFTER approver1_em_id`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN approver2_name VARCHAR(150) AFTER approver2_em_id`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN approver3_name VARCHAR(150) AFTER approver3_em_id`);
}

// One-time additive migration for databases created before contract_requests grew
// `legal_check` (0 = Waiting Legal Review, 1 = Legal Checked — see legalController.js).
async function migrateLegalCheckColumn() {
  try {
    await exec(`ALTER TABLE contract_requests ADD COLUMN legal_check TINYINT(1) NOT NULL DEFAULT 0 AFTER approver3_approved_at`);
  } catch (err) {
    if (err.original?.code === 'ER_DUP_FIELDNAME') return;
    throw err;
  }
}

// One-time additive migration for databases created before contract_approval_history
// grew `created_by_name` (the acting user's display name, for Approval > My History's
// "Updated By" column — see insertApprovalHistory in approvalController.js).
async function migrateApprovalHistoryNameColumn() {
  try {
    await exec(`ALTER TABLE contract_approval_history ADD COLUMN created_by_name VARCHAR(300) AFTER action`);
  } catch (err) {
    if (err.original?.code === 'ER_DUP_FIELDNAME') return;
    throw err;
  }
}

// One-time additive migration for databases created before global_documents grew
// file_id/file_name/extension (a denormalized copy of the attached file_uploads row)
// and updated_by_name (the acting user's display name) — needed so Settings >
// Contract Type's document list can show file name/uploader/date without a join.
async function migrateGlobalDocumentColumns() {
  const tryAddColumn = async sql => {
    try {
      await exec(sql);
    } catch (err) {
      if (err.original?.code === 'ER_DUP_FIELDNAME') return;
      throw err;
    }
  };

  await tryAddColumn(`ALTER TABLE global_documents ADD COLUMN file_id INT AFTER file_path`);
  await tryAddColumn(`ALTER TABLE global_documents ADD COLUMN file_name VARCHAR(255) AFTER file_id`);
  await tryAddColumn(`ALTER TABLE global_documents ADD COLUMN extension VARCHAR(20) AFTER file_name`);
  await tryAddColumn(`ALTER TABLE global_documents ADD COLUMN updated_by_name VARCHAR(300) AFTER extension`);
}

// One-time additive migration for databases created before contract_requests grew the
// Upload Sign Contract columns (signedContractController.js) — present in schema.sql's
// CREATE TABLE for fresh databases, but CREATE TABLE IF NOT EXISTS is a no-op against
// an already-existing table, so any database created before this feature needs these
// added explicitly.
async function migrateSignedContractColumns() {
  const tryAddColumn = async sql => {
    try {
      await exec(sql);
    } catch (err) {
      if (err.original?.code === 'ER_DUP_FIELDNAME') return;
      throw err;
    }
  };

  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN signed_file_id INT AFTER legal_check`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN has_expiry TINYINT(1) AFTER signed_file_id`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN contract_start_date DATE AFTER has_expiry`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN auto_renewal TINYINT(1) AFTER contract_start_date`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN auto_renewal_years INT AFTER auto_renewal`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN renewal_condition VARCHAR(500) AFTER auto_renewal_years`);
  await tryAddColumn(`ALTER TABLE contract_requests ADD COLUMN reminder_before_expiry_days SMALLINT AFTER renewal_condition`);
}

async function seedEmployees() {
  if ((await countRows('employees')) > 0) return;

  const employees = [
    { emId: '020001', firstName: 'Thitinun', lastName: 'Wongsiri', department: 'Legal' },
    { emId: '020002', firstName: 'Somchai', lastName: 'Boonmee', department: 'Operations' },
    { emId: '020003', firstName: 'Napat', lastName: 'Charoensuk', department: 'Procurement' },
    { emId: '020004', firstName: 'Wipada', lastName: 'Srisuk', department: 'Operations' },
    { emId: '020005', firstName: 'Anucha', lastName: 'Kittisak', department: 'IT' },
    { emId: '020006', firstName: 'Thanakorn', lastName: 'Aksorncha', department: 'Legal' },
    { emId: '020007', firstName: 'Somying', lastName: 'Rattanakul', department: 'Operations' },
    { emId: '020008', firstName: 'Pornthip', lastName: 'Suwannarat', department: 'IT' },
  ];

  for (const e of employees) {
    await exec(
      `INSERT INTO employees (em_id, first_name, last_name, department, created_by)
       VALUES (:emId, :firstName, :lastName, :department, 'seed')`,
      e
    );
  }
}

async function seedAdminUsers() {
  if ((await countRows('admin_users')) > 0) return;

  const assignments = [
    { emId: '020001', firstName: 'Thitinun', lastName: 'Wongsiri', view: 1, admin: 0, legal: 1 },
    { emId: '020005', firstName: 'Anucha', lastName: 'Kittisak', view: 1, admin: 1, legal: 0 },
    { emId: '020002', firstName: 'Somchai', lastName: 'Boonmee', view: 1, admin: 0, legal: 0 },
  ];

  for (const a of assignments) {
    await exec(
      `INSERT INTO admin_users (em_id, first_name, last_name, view, admin, legal, created_by)
       VALUES (:emId, :firstName, :lastName, :view, :admin, :legal, 'seed')`,
      a
    );
  }
}

async function seedAppUsers() {
  if ((await countRows('app_users')) > 0) return;

  // em_id matches an admin_users row (see seedAdminUsers) so /api/login has real
  // permissions to look up for these demo accounts.
  const users = [
    { username: 'admin', password: 'admin123', firstName: 'Admin', lastName: 'User', role: 'Admin', section: 'IT', emId: '020005' },
    { username: '20014', password: '00000', firstName: 'Thitinun', lastName: 'Chaychayanon', role: 'Requester', section: 'Operations', emId: '20014' },
  ];

  for (const u of users) {
    await exec(
      `INSERT INTO app_users (username, password, first_name, last_name, role, section, em_id, created_by)
       VALUES (:username, :password, :firstName, :lastName, :role, :section, :emId, 'seed')`,
      u
    );
  }
}

// Contract types double as the Download Form page's tabs, and each purpose
// doubles as that tab's item list — a purpose only shows up as a downloadable
// item once it has a form_items row (its `files`) attached, seeded inline below.
async function seedContractTypes() {
  if ((await countRows('contract_types')) > 0) return;

  const types = [
    {
      name: 'Lease Contract',
      description: 'สัญญาเช่าพื้นที่ เครื่องจักร หรือยานพาหนะ',
      allowCustomPurpose: false,
      purposes: [{ text: 'เช่าพื้นที่สำนักงาน' }, { text: 'เช่าเครื่องจักร' }, { text: 'เช่ายานพาหนะ' }],
    },
    {
      name: 'Service Agreement',
      description: 'สัญญาว่าจ้างบริการต่างๆ',
      allowCustomPurpose: false,
      purposes: [{ text: 'บำรุงรักษาระบบ IT' }, { text: 'บริการทำความสะอาด' }, { text: 'บริการรักษาความปลอดภัย' }],
    },
    {
      name: 'Procurement',
      description: 'สัญญาจัดซื้อจัดจ้างวัตถุดิบและอุปกรณ์',
      allowCustomPurpose: false,
      purposes: [{ text: 'จัดซื้อวัตถุดิบ' }, { text: 'จัดซื้ออุปกรณ์สำนักงาน' }],
    },
    { name: 'Supply Contract', description: 'สัญญาจัดหาสินค้าหรือวัตถุดิบระยะยาว', allowCustomPurpose: true, purposes: [] },
    { name: 'Consulting', description: 'สัญญาว่าจ้างที่ปรึกษา', allowCustomPurpose: true, purposes: [] },
    {
      name: 'Non-Disclosure Agreement Form (NDA)',
      description: 'แบบฟอร์มสัญญารักษาความลับ',
      allowCustomPurpose: false,
      purposes: [
        {
          text: 'Production Machine & Equipment',
          description: 'ใช้รักษาความลับข้อมูลเพื่อการออกแบบเครื่องจักร แม่พิมพ์ (Mold) หรืออุปกรณ์ที่ใช้ในโรงงาน',
          files: { eng: '/files/forms/nda-production-machine-eng.pdf', tha: '/files/forms/nda-production-machine-tha.pdf' },
        },
      ],
    },
  ];

  for (const t of types) {
    const contractTypeId = await insert(
      `INSERT INTO contract_types (name, description, allow_custom_purpose, created_by)
       VALUES (:name, :description, :allowCustomPurpose, 'seed')`,
      { name: t.name, description: t.description, allowCustomPurpose: t.allowCustomPurpose ? 1 : 0 }
    );

    for (const p of t.purposes) {
      const purposeId = await insert(
        `INSERT INTO contract_type_purposes (contract_type_id, purpose_text, description, created_by)
         VALUES (:contractTypeId, :purposeText, :description, 'seed')`,
        { contractTypeId, purposeText: p.text, description: p.description || null }
      );

      if (p.files) {
        await exec(
          `INSERT INTO form_items (contract_type_purpose_id, file_eng_path, file_tha_path, created_by)
           VALUES (:purposeId, :fileEngPath, :fileThaPath, 'seed')`,
          { purposeId, fileEngPath: p.files.eng, fileThaPath: p.files.tha }
        );
      }
    }
  }
}

// Seed data for the Home / Job Status / Approval / Legal list screens. These used to
// live in a separate "contracts" table; now they're just contract_requests rows that
// already reached some later point in their lifecycle (status), so the demo data
// carries the same minimum required fields as a real New Request submission would.
async function seedContractRequests() {
  if ((await countRows('contract_requests')) > 0) return;

  const typeRows = await select('SELECT id, name FROM contract_types');
  const typeIdByName = Object.fromEntries(typeRows.map(t => [t.name, t.id]));

  const requests = [
    { supplier: 'กรุงเทพ โลจิสติกส์', contractNo: 'DSST01-2027', type: 'Consulting', section: 'Operations', year: 2027, expireDate: '2027-10-02', status: 'Near Expiry' },
    { supplier: 'Advanced Info Service Co., Ltd.', contractNo: 'DSST01-2026', type: 'Service Agreement', section: 'IT', year: 2026, expireDate: null, status: 'Drafted' },
    { supplier: 'Bangkok Cable Co., Ltd.', contractNo: null, type: 'Procurement', section: 'Procurement', year: 2026, expireDate: null, status: 'Waiting Approver 2' },
    { supplier: 'Chevron Thailand Ltd.', contractNo: null, type: 'Supply Contract', section: 'Legal', year: 2026, expireDate: null, status: 'Saved' },
    { supplier: 'Delta Electronics (Thailand) PCL.', contractNo: 'DSST02-2026', type: 'Service Agreement', section: 'IT', year: 2026, expireDate: null, status: 'Drafted' },
    { supplier: 'Esso (Thailand) PCL.', contractNo: null, type: 'Supply Contract', section: 'Legal', year: 2026, expireDate: null, status: 'Waiting Approver 1' },
    { supplier: 'Fortune Parts Industry PCL.', contractNo: null, type: 'Procurement', section: 'Procurement', year: 2026, expireDate: null, status: 'Waiting Approver 3' },
    { supplier: 'Global Power Synergy PCL.', contractNo: null, type: 'Consulting', section: 'Legal', year: 2026, expireDate: null, status: 'Waiting Legal Check' },
    { supplier: 'Home Product Center PCL.', contractNo: 'DSST03-2025', type: 'Service Agreement', section: 'Operations', year: 2025, expireDate: null, status: 'Rejected' },
    { supplier: 'Indorama Ventures PCL.', contractNo: 'DSST04-2024', type: 'Supply Contract', section: 'IT', year: 2024, expireDate: null, status: 'Expired' },
    { supplier: 'JWD InfoLogistics PCL.', contractNo: 'DSST05-2027', type: 'Consulting', section: 'Operations', year: 2027, expireDate: '2028-02-14', status: 'Active' },
  ];

  for (const r of requests) {
    await exec(
      `INSERT INTO contract_requests (
         status, contract_type_id, supplier_name, contract_no, contract_year, expire_date,
         request_date, requestor_name, requestor_section, created_by
       ) VALUES (
         :status, :contractTypeId, :supplier, :contractNo, :year, :expireDate,
         :requestDate, 'Seed User', :section, 'seed'
       )`,
      { contractTypeId: typeIdByName[r.type] ?? null, requestDate: `${r.year}-01-01`, ...r }
    );
  }
}

export async function initDatabase() {
  await sequelize.authenticate();
  await runSchema();
  await migrateNameColumn('app_users', 'name');
  await migrateNameColumn('admin_users', 'full_name');
  await migrateApproverNameColumns();
  await migrateApprovalHistoryNameColumn();
  await migrateLegalCheckColumn();
  await migrateGlobalDocumentColumns();
  await migrateSignedContractColumns();
  await seedEmployees();
  await seedAdminUsers();
  await seedAppUsers();
  await seedContractTypes();
  await seedContractRequests();
}
