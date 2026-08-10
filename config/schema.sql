-- Contract Center — database schema
-- Dialect: MySQL 8+ (uses CHECK constraints, enforced since 8.0.16)
--
-- Convention used on every single table in this file:
--   id           INT AUTO_INCREMENT PRIMARY KEY
--   created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
--   updated_at   DATETIME                      -- set by the app on every update
--   deleted_at   DATETIME                      -- soft delete marker; NULL = not deleted
--   created_by   VARCHAR(6)                    -- short user/em_id code of whoever created the row
--   updated_by   VARCHAR(6)
--   deleted_by   VARCHAR(6)
--
-- Soft delete is the default everywhere (deleted_at/deleted_by instead of DELETE),
-- matching how /api/uploads already soft-deletes. Every table also carries its own
-- `active` flag for "is this record currently usable" (e.g. an employee who left,
-- a contract type retired) as a separate concept from "was this row deleted."


-- =========================================================================
-- Employees — master list used for approver / signature pickers
-- =========================================================================
CREATE TABLE IF NOT EXISTS employees (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  em_id         VARCHAR(6) NOT NULL UNIQUE,        -- numeric employee code, e.g. "020001", "020014"
  first_name    VARCHAR(150) NOT NULL,
  last_name     VARCHAR(150) NOT NULL,
  department    VARCHAR(150) NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME,
  deleted_at    DATETIME,
  created_by    VARCHAR(6),
  updated_by    VARCHAR(6),
  deleted_by    VARCHAR(6)
);

CREATE INDEX idx_employees_active ON employees (active);


-- =========================================================================
-- Admin users — permission assignment per employee. Three independent bit
-- flags instead of a single role column: an employee can hold any combination
-- of View / Admin / Legal access. `em_id` is NOT a foreign key to `employees` —
-- employee master data is expected to move to an external API later, so nothing
-- here should depend on a local table for referential integrity.
-- =========================================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  em_id         VARCHAR(6) NOT NULL,
  first_name    VARCHAR(150) NOT NULL,
  last_name     VARCHAR(150) NOT NULL,
  view          TINYINT(1) NOT NULL DEFAULT 0,
  admin         TINYINT(1) NOT NULL DEFAULT 0,
  legal         TINYINT(1) NOT NULL DEFAULT 0,
  active        TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME,
  deleted_at    DATETIME,
  created_by    VARCHAR(6),
  updated_by    VARCHAR(6),
  deleted_by    VARCHAR(6)
);

CREATE INDEX idx_admin_users_em_id ON admin_users (em_id);


-- =========================================================================
-- App users — login credentials. Separate from admin_users: this is "who can log
-- in", admin_users is "what an employee is allowed to do" (looked up by em_id at
-- login time). `first_name`/`last_name`/`section` are copied onto the account so the
-- frontend can render a session (and the Approved By "Signature" format, see
-- formatSignature on the frontend) immediately after login without an extra join.
-- Password is stored as plain text — no hashing — per project decision for this
-- mock system. `em_id` is NOT a foreign key, same reasoning as admin_users above.
-- =========================================================================
CREATE TABLE IF NOT EXISTS app_users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(100) NOT NULL UNIQUE,
  password       VARCHAR(100) NOT NULL,
  first_name     VARCHAR(150) NOT NULL,
  last_name      VARCHAR(150) NOT NULL,
  role           VARCHAR(50) NOT NULL,
  section        VARCHAR(150),
  em_id          VARCHAR(6),
  active         TINYINT(1) NOT NULL DEFAULT 1,

  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME,
  deleted_at     DATETIME,
  created_by     VARCHAR(6),
  updated_by     VARCHAR(6),
  deleted_by     VARCHAR(6)
);


-- =========================================================================
-- File uploads — every uploaded document in the system goes through this table.
-- Storage convention: the file on disk is named after `storage_name` (a UUID)
-- with NO extension. `file_name` + `extension` are only ever recombined at
-- download time (Content-Disposition), so a leaked storage path reveals
-- neither the original name nor the file type. `storage_name` is separate from
-- the auto-increment `id` so the on-disk name never leaks a guessable sequence.
-- =========================================================================
CREATE TABLE IF NOT EXISTS file_uploads (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  storage_name  VARCHAR(36) NOT NULL UNIQUE,   -- UUID; the actual filename on disk
  file_name     VARCHAR(255) NOT NULL,          -- original name WITHOUT extension
  extension     VARCHAR(20) NOT NULL,           -- e.g. '.pdf', '.docx' (leading dot included)
  active        TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME,
  deleted_at    DATETIME,
  created_by    VARCHAR(6),
  updated_by    VARCHAR(6),
  deleted_by    VARCHAR(6)
);


-- =========================================================================
-- Contract types — drives the "Contract Type" dropdown on the New Request form
-- AND the tabs on the Home > DOWNLOAD FORM page. Display/sort order is just the
-- auto-increment `id` (creation order) — no separate editable sort field.
-- `description` is the explanatory subtitle shown under the type's name (e.g. on
-- the Download Form page header).
-- =========================================================================
CREATE TABLE IF NOT EXISTS contract_types (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(200) NOT NULL,
  description           VARCHAR(500),
  allow_custom_purpose  TINYINT(1) NOT NULL DEFAULT 0, -- true => Contract Purpose becomes free text
  active                TINYINT(1) NOT NULL DEFAULT 1,

  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME,
  deleted_at            DATETIME,
  created_by            VARCHAR(6),
  updated_by            VARCHAR(6),
  deleted_by            VARCHAR(6)
);

-- One contract type has many selectable purposes (only used when allow_custom_purpose = 0).
-- Also doubles as the item list for that type's Download Form tab (see form_items below).
CREATE TABLE IF NOT EXISTS contract_type_purposes (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  contract_type_id  INT NOT NULL,
  purpose_text      VARCHAR(300) NOT NULL,
  description       VARCHAR(500),
  active            TINYINT(1) NOT NULL DEFAULT 1,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME,
  deleted_at        DATETIME,
  created_by        VARCHAR(6),
  updated_by        VARCHAR(6),
  deleted_by        VARCHAR(6)
);

CREATE INDEX idx_contract_type_purposes_type ON contract_type_purposes (contract_type_id);


-- =========================================================================
-- Contract requests — the single source of truth for a contract's entire life:
-- from New Request form submission (draft or sent) through approval, drafting,
-- legal check and beyond. This used to be split across a separate "contracts"
-- registry table (Home / Job Status / Approval / Legal list screens) and this
-- "contract_requests" table (New Request submissions) — they were the same
-- entity twice over, so everything now lives here and `status` carries the
-- full lifecycle (draft-time 'Saved' through 'Waiting Approver N', 'Drafted',
-- 'Waiting Legal Check', 'Active', 'Expired', 'Rejected', ...).
--
-- Approvers and payment installments used to be child tables, but a contract
-- request has at most 3 approvers and 8 payment installments, so both are
-- flattened onto this row instead of normalized into their own tables.
-- =========================================================================
CREATE TABLE IF NOT EXISTS contract_requests (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  status              VARCHAR(50) NOT NULL DEFAULT 'Saved', -- Saved / Waiting Approver N / Drafted / Active / ...
  confidentiality     TINYINT(1) NOT NULL DEFAULT 0, -- true => "HIGH CONFIDENTIAL"

  contract_type_id    INT,
  contract_purpose    VARCHAR(300),        -- dropdown choice OR free text, per contract_types.allow_custom_purpose
  other_specify       VARCHAR(300),

  supplier_name       VARCHAR(300) NOT NULL,
  contract_no         VARCHAR(100),        -- NULL until officially issued
  contract_year       SMALLINT NOT NULL,
  expire_date         DATE,

  request_date        DATE NOT NULL,
  delivery_date       DATE,
  location            VARCHAR(300),
  warranty_period     VARCHAR(100),
  refer_contract_no   VARCHAR(100),
  brief_description   TEXT,

  total_net_price     DECIMAL(14, 2),
  vat                 VARCHAR(20),          -- free text, e.g. "7%"
  currency            VARCHAR(10),
  trade_term          VARCHAR(100),
  payment_other       TEXT,
  payment1            VARCHAR(500),
  payment2            VARCHAR(500),
  payment3            VARCHAR(500),
  payment4            VARCHAR(500),
  payment5            VARCHAR(500),
  payment6            VARCHAR(500),
  payment7            VARCHAR(500),
  payment8            VARCHAR(500),

  requestor_name      VARCHAR(300) NOT NULL,
  requestor_section   VARCHAR(150) NOT NULL,
  remark              VARCHAR(20) NOT NULL DEFAULT 'new'
                        CHECK (remark IN ('new', 'renew', 'amend', 'claim', 'terminate')),

  -- 3 signature slots: Manager (required), Supervisor #1 (required), Supervisor #2
  -- (optional). Each stores employees.em_id directly, not the surrogate id — and not
  -- as a foreign key, since employee master data is expected to move to an external
  -- API later. `approverN_name` is the Signature-format string (first name + first 2
  -- letters of last name) captured from the acting approver at the moment they
  -- approved that stage, alongside `approverN_approved_at` — both are stored directly
  -- so display never needs to join back to app_users/admin_users.
  approver1_em_id       VARCHAR(6),
  approver1_name        VARCHAR(150),
  approver1_approved_at DATETIME,
  approver2_em_id       VARCHAR(6),
  approver2_name        VARCHAR(150),
  approver2_approved_at DATETIME,
  approver3_em_id       VARCHAR(6),
  approver3_name        VARCHAR(150),
  approver3_approved_at DATETIME,

  -- Independent of `status` on purpose (Legal > Waiting shouldn't drive the main
  -- workflow) — 0 = Waiting Legal Review, 1 = Legal Checked. Set to 1 by the Check
  -- action (see services/legalService.js), which drops the row off Legal > Waiting
  -- without touching `status` at all.
  legal_check         TINYINT(1) NOT NULL DEFAULT 0,

  -- Upload Sign Contract (More > Upload Sign Contract, only offered while status =
  -- 'Drafted') — captured on upload, which also flips status to 'Signed'.
  -- `expire_date` above doubles as Contract End Date; there's no separate column.
  signed_file_id              INT,             -- file_uploads.id of the signed PDF
  has_expiry                  TINYINT(1),      -- 1 = has an expiry date, 0 = none, NULL = not uploaded yet
  contract_start_date         DATE,
  auto_renewal                TINYINT(1),      -- 1 = Auto Renewal, 0 = No Auto Renewal (only meaningful when has_expiry = 1)
  auto_renewal_years          INT,             -- only set when auto_renewal = 1
  renewal_condition           VARCHAR(500),    -- unused — the Renewal Condition field was removed from
                                                -- Upload Sign Contract; column kept only for existing rows
  reminder_before_expiry_days SMALLINT,        -- one of 15/30/45/60/90, only when has_expiry = 1 AND auto_renewal = 1

  active              TINYINT(1) NOT NULL DEFAULT 1,

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME,
  deleted_at          DATETIME,
  created_by          VARCHAR(6),
  updated_by          VARCHAR(6),
  updated_name        VARCHAR(300),  -- display name of whoever last created/updated this row, alongside updated_by's em_id
  deleted_by          VARCHAR(6)
);

CREATE INDEX idx_contract_requests_status ON contract_requests (status);
CREATE INDEX idx_contract_requests_section ON contract_requests (requestor_section);

-- A contract request can accumulate multiple comments over its lifecycle (requestor,
-- supervisor, legal, others — see the Comment section's subtitle on the New Request
-- form), so this is a child table rather than a single `comment` column.
CREATE TABLE IF NOT EXISTS contract_request_comments (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  contract_request_id  INT NOT NULL,
  comment              TEXT NOT NULL,
  commenter_name       VARCHAR(300), -- "by" display name, captured at post time (localStorage user.name)
  role                 VARCHAR(20),  -- Requester / Supervisor / Manager / Others — see computeCommentRole/computeApprovalCommentRole
  active               TINYINT(1) NOT NULL DEFAULT 1,

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME,
  deleted_at           DATETIME,
  created_by           VARCHAR(6),
  updated_by           VARCHAR(6),
  deleted_by           VARCHAR(6)
);

CREATE INDEX idx_crc_request ON contract_request_comments (contract_request_id);

-- Approval workflow history (Approve / Return / Reject) — one row per action taken on a
-- request. Comments live only in contract_request_comments; this table is action log only.
-- `created_by_name` is the acting user's display name captured at the moment of the
-- action (their own session, see /api/login's first_name/last_name) so the Approval >
-- My History screen never needs to join back to app_users to show "Updated By".
CREATE TABLE IF NOT EXISTS contract_approval_history (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  contract_request_id  INT NOT NULL,
  action               VARCHAR(20) NOT NULL CHECK (action IN ('Approve', 'Return', 'Reject')),
  created_by_name      VARCHAR(300),
  active               TINYINT(1) NOT NULL DEFAULT 1,

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME,
  deleted_at           DATETIME,
  created_by           VARCHAR(6),
  updated_by           VARCHAR(6),
  deleted_by           VARCHAR(6)
);

CREATE INDEX idx_cah_request ON contract_approval_history (contract_request_id);

-- Legal review history (Check / Terminate) — one row per action taken by Legal on a
-- request. Comments live only in contract_request_comments (role 'LG'); this table is
-- action log only, shown on Legal > History (not filtered by created_by — every legal
-- user shares one queue and one history). `by` is the acting user's display name
-- (localStorage user.name), captured at action time so display never needs a join.
CREATE TABLE IF NOT EXISTS contract_legal_history (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  contract_request_id  INT NOT NULL,
  action               VARCHAR(20) NOT NULL CHECK (action IN ('Check', 'Terminate', 'No Need', 'Cancel')),
  `by`                 VARCHAR(300), -- backtick-quoted: `by` is a reserved word in MySQL
  active               TINYINT(1) NOT NULL DEFAULT 1,

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME,
  deleted_at           DATETIME,
  created_by           VARCHAR(6),
  updated_by           VARCHAR(6),
  deleted_by           VARCHAR(6)
);

CREATE INDEX idx_clh_request ON contract_legal_history (contract_request_id);

-- Atomic per-year running counter for DSSTXX-YYYY contract numbers — a dedicated row per
-- year lets `INSERT ... ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`
-- serialize concurrent approvals via MySQL's row lock on the `year` primary key, then read
-- the freshly incremented value back with `SELECT LAST_INSERT_ID()` in the same round trip.
-- Pure mechanical counter, so it intentionally skips the audit-column convention used above.
CREATE TABLE IF NOT EXISTS contract_no_sequences (
  year         INT PRIMARY KEY,
  last_number  INT NOT NULL DEFAULT 0
);

-- Same atomic-counter pattern, keyed by the referenced contract number, for DSSTXX-YYYY-NN
-- revision numbers (see "Refer to Contract No." handling on the New Request / Edit form).
CREATE TABLE IF NOT EXISTS contract_revision_sequences (
  contract_no     VARCHAR(100) PRIMARY KEY,
  last_revision   INT NOT NULL DEFAULT 0
);

-- Related Contract Document checklist (Drafted Contract, Quotation, Specification, ...)
CREATE TABLE IF NOT EXISTS contract_request_documents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  contract_request_id  INT NOT NULL,
  document_type        VARCHAR(50) NOT NULL CHECK (
                          document_type IN (
                            'drafted', 'quotation', 'specification',
                            'drawing', 'schedule', 'company_certificate', 'other'
                          )
                        ),
  checked              TINYINT(1) NOT NULL DEFAULT 0,
  active               TINYINT(1) NOT NULL DEFAULT 1,

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME,
  deleted_at           DATETIME,
  created_by           VARCHAR(6),
  updated_by           VARCHAR(6),
  deleted_by           VARCHAR(6),

  UNIQUE (contract_request_id, document_type)
);

-- A document checklist item can have multiple attached files (many-to-many via this join table)
CREATE TABLE IF NOT EXISTS contract_request_document_files (
  id                              INT AUTO_INCREMENT PRIMARY KEY,
  contract_request_document_id   INT NOT NULL,
  file_upload_id                 INT NOT NULL,
  active                         TINYINT(1) NOT NULL DEFAULT 1,

  created_at                     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                     DATETIME,
  deleted_at                     DATETIME,
  created_by                     VARCHAR(6),
  updated_by                     VARCHAR(6),
  deleted_by                     VARCHAR(6)
);

CREATE INDEX idx_crdf_document ON contract_request_document_files (contract_request_document_id);


-- =========================================================================
-- Download Form templates (Home > DOWNLOAD FORM page) — Contract Type tabs
-- (contract_types, ordered by `step`), each listing its purposes
-- (contract_type_purposes) that have a downloadable file attached here.
-- A purpose with no form_item row simply doesn't show up as a download item —
-- there's no longer a separate "forms" concept, it rides entirely on the same
-- contract type / purpose taxonomy used by the New Request form.
-- Files themselves are static bundled assets (served from storage/forms via
-- /files/*), not part of the dynamic upload flow, so paths are stored directly
-- instead of a file_uploads FK.
-- =========================================================================
-- file_eng_path / file_tha_path are independently nullable — the admin can attach
-- just the English file, just the Thai file, or both; each language is managed
-- (attached/replaced/removed) on its own from the Settings > Contract Type page.
CREATE TABLE IF NOT EXISTS form_items (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  contract_type_purpose_id  INT NOT NULL,
  file_eng_path             VARCHAR(500),
  file_tha_path             VARCHAR(500),
  active                    TINYINT(1) NOT NULL DEFAULT 1,

  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME,
  deleted_at                DATETIME,
  created_by                VARCHAR(6),
  updated_by                VARCHAR(6),
  deleted_by                VARCHAR(6)
);

CREATE INDEX idx_form_items_purpose ON form_items (contract_type_purpose_id);


-- =========================================================================
-- Global documents — singleton files that aren't tied to any contract type or
-- purpose: "Contract Procedure" (linked from the Home page), "User Manual"
-- (also linked from the Home page), and "Check Sheet" (linked from every row
-- on the Download Form page). Exactly one row per doc_key; it's created the
-- first time that document is uploaded from Settings > Contract Type, and
-- replaced (not duplicated) on every re-upload. file_id/file_name/extension
-- are a denormalized copy of the file_uploads row at upload time (same
-- convention as approverN_name, contract_legal_history.by, etc. elsewhere in
-- this schema) so the Settings list can show file name/uploader/date without
-- a join; updated_by_name is the acting user's display name for the same reason.
-- =========================================================================
CREATE TABLE IF NOT EXISTS global_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  doc_key         VARCHAR(50) NOT NULL UNIQUE, -- 'contract_procedure' | 'check_sheet' | 'user_manual'
  file_path       VARCHAR(500),
  file_id         INT,
  file_name       VARCHAR(255),
  extension       VARCHAR(20),
  updated_by_name VARCHAR(300),
  active          TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME,
  deleted_at    DATETIME,
  created_by    VARCHAR(6),
  updated_by    VARCHAR(6),
  deleted_by    VARCHAR(6)
);
