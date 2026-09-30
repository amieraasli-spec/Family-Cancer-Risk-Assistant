-- IKN Medical Report Tracking & Performance System — initial schema.
--
-- Portability contract (see docs/11-integration-notes.md):
--   * Timestamps are TEXT holding ISO-8601 UTC with a trailing Z. Display and all
--     business-date arithmetic convert to Asia/Kuala_Lumpur in the domain layer,
--     never in SQL, so the same SQL runs on SQLite and PostgreSQL.
--   * Money is INTEGER **sen** (1/100 RM). No float ever touches an amount.
--   * Booleans are INTEGER 0/1 rather than BOOLEAN, which SQLite lacks.
--   * Identifiers are application-generated TEXT, so no SERIAL/IDENTITY dialect.
--   * Partial unique indexes are used and are supported by both engines.

-- ---------------------------------------------------------------- organisation

CREATE TABLE departments (
  department_id   TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE doctors (
  doctor_id       TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  department_id   TEXT NOT NULL REFERENCES departments(department_id),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  is_synthetic    INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0,1))
);

CREATE TABLE users (
  user_id             TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN (
                        'records_officer','doctor','hod','finance_officer',
                        'director','system_admin')),
  -- Records supervisors hold the reopen permission; ordinary officers do not.
  is_supervisor       INTEGER NOT NULL DEFAULT 0 CHECK (is_supervisor IN (0,1)),
  -- Set only for role='doctor'. Scopes every task and claim query.
  doctor_id           TEXT REFERENCES doctors(doctor_id),
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  mfa_required        INTEGER NOT NULL DEFAULT 0 CHECK (mfa_required IN (0,1)),
  policy_clearance    TEXT NOT NULL DEFAULT 'STANDARD',
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at          TEXT NOT NULL,
  CHECK ((role = 'doctor') = (doctor_id IS NOT NULL))
);

CREATE TABLE user_departments (
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  department_id   TEXT NOT NULL REFERENCES departments(department_id),
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE sessions (
  session_id_hash TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  mfa_satisfied   INTEGER NOT NULL DEFAULT 0 CHECK (mfa_satisfied IN (0,1)),
  revoked_at      TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------- versioned rules and config

CREATE TABLE business_calendar_versions (
  calendar_version    TEXT PRIMARY KEY,
  description         TEXT NOT NULL,
  timezone            TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  -- 1 = the day completeness was achieved counts as working day 1.
  -- 0 = the clock starts the next working day. Assumption #2, UNVERIFIED.
  include_start_day   INTEGER NOT NULL CHECK (include_start_day IN (0,1)),
  weekend_days        TEXT NOT NULL DEFAULT '0,6',   -- ISO day numbers, Sun=0
  effective_from      TEXT NOT NULL,
  verification_state  TEXT NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_state IN ('UNVERIFIED','PENDING_IKN','CONFIRMED')),
  confirmed_by        TEXT,
  confirmed_at        TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE business_calendar_days (
  calendar_version    TEXT NOT NULL REFERENCES business_calendar_versions(calendar_version),
  calendar_date       TEXT NOT NULL,           -- YYYY-MM-DD, Asia/Kuala_Lumpur
  day_kind            TEXT NOT NULL CHECK (day_kind IN
                        ('PUBLIC_HOLIDAY','REPLACEMENT_HOLIDAY','WORKING_OVERRIDE')),
  label               TEXT NOT NULL,
  PRIMARY KEY (calendar_version, calendar_date)
);

CREATE TABLE sla_rules (
  sla_rule_version        TEXT PRIMARY KEY,
  description             TEXT NOT NULL,
  service_working_days    INTEGER NOT NULL,
  doctor_working_days     INTEGER NOT NULL,
  review_buffer_days      INTEGER NOT NULL,
  -- JSON object: { "<report_type>": <working days> }. Empty = no exceptions.
  by_report_type_json     TEXT NOT NULL DEFAULT '{}',
  completion_endpoint     TEXT NOT NULL DEFAULT 'accepted_completed_at'
                            CHECK (completion_endpoint IN
                              ('signed_submitted_at','accepted_completed_at','ready_at',
                               'notified_at','collection_or_delivery_at')),
  on_time_target_percent  INTEGER NOT NULL DEFAULT 85,
  calendar_version        TEXT NOT NULL REFERENCES business_calendar_versions(calendar_version),
  effective_from          TEXT NOT NULL,
  verification_state      TEXT NOT NULL DEFAULT 'UNVERIFIED'
                            CHECK (verification_state IN ('UNVERIFIED','PENDING_IKN','CONFIRMED')),
  created_at              TEXT NOT NULL
);

CREATE TABLE fee_rules (
  fee_rule_version            TEXT PRIMARY KEY,
  description                 TEXT NOT NULL,
  -- JSON object: { "<report_type>": <amount in sen> }
  amounts_sen_json            TEXT NOT NULL,
  release_requires_settled    INTEGER NOT NULL DEFAULT 0
                                CHECK (release_requires_settled IN (0,1)),
  currency                    TEXT NOT NULL DEFAULT 'MYR',
  effective_from              TEXT NOT NULL,
  verification_state          TEXT NOT NULL DEFAULT 'UNVERIFIED'
                                CHECK (verification_state IN ('UNVERIFIED','PENDING_IKN','CONFIRMED')),
  created_at                  TEXT NOT NULL
);

CREATE TABLE claim_eligibility_rules (
  eligibility_rule_version    TEXT PRIMARY KEY,
  description                 TEXT NOT NULL,
  -- JSON object describing which completed reports create one eligible item.
  criteria_json               TEXT NOT NULL,
  effective_from              TEXT NOT NULL,
  verification_state          TEXT NOT NULL DEFAULT 'UNVERIFIED'
                                CHECK (verification_state IN ('UNVERIFIED','PENDING_IKN','CONFIRMED')),
  created_at                  TEXT NOT NULL
);

-- Every policy-dependent prototype assumption, editable and versioned at runtime.
CREATE TABLE config_settings (
  config_key          TEXT NOT NULL,
  version             INTEGER NOT NULL,
  value_json          TEXT NOT NULL,
  verification_state  TEXT NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_state IN ('UNVERIFIED','PENDING_IKN','CONFIRMED')),
  owner_to_confirm    TEXT,
  basis              TEXT,
  effective_from      TEXT NOT NULL,
  superseded_at       TEXT,
  changed_by          TEXT REFERENCES users(user_id),
  created_at          TEXT NOT NULL,
  PRIMARY KEY (config_key, version)
);
CREATE INDEX idx_config_active ON config_settings(config_key, superseded_at);

-- --------------------------------------------------------------- applications

CREATE TABLE applications (
  application_id              TEXT PRIMARY KEY,
  -- Sequential, human-quotable, and deliberately NOT a credential.
  internal_report_number      TEXT NOT NULL UNIQUE,
  applicant_role              TEXT NOT NULL CHECK (applicant_role IN
                                ('PATIENT','GUARDIAN','AUTHORISED_REPRESENTATIVE')),
  -- Pseudonymous handle. Full identifiers are deliberately not stored here;
  -- see docs/06-data-dictionary.md on the protected patient reference.
  protected_patient_reference TEXT NOT NULL,
  verified_contact_reference  TEXT,
  authority_verified_at       TEXT,
  authority_verified_by       TEXT REFERENCES users(user_id),
  report_type                 TEXT NOT NULL,
  request_purpose             TEXT NOT NULL,
  department_id               TEXT NOT NULL REFERENCES departments(department_id),
  received_at                 TEXT NOT NULL,
  -- True time completeness was achieved, distinct from when staff recorded it.
  application_complete_at     TEXT,
  completeness_recorded_at    TEXT,
  sla_rule_version            TEXT NOT NULL REFERENCES sla_rules(sla_rule_version),
  fee_rule_version            TEXT NOT NULL REFERENCES fee_rules(fee_rule_version),
  original_service_due_at     TEXT,
  revised_due_at              TEXT,
  internal_status             TEXT NOT NULL CHECK (internal_status IN (
                                'RECEIVED','AWAITING_DOCUMENTS','COMPLETE_UNASSIGNED',
                                'ASSIGNED','ACKNOWLEDGED','IN_PREPARATION',
                                'SIGNED_SUBMITTED','RECORDS_VERIFICATION',
                                'READY_FOR_RELEASE','COLLECTED_OR_DELIVERED','CANCELLED')),
  public_status               TEXT NOT NULL CHECK (public_status IN (
                                'PERMOHONAN_DITERIMA','TINDAKAN_PEMOHON_DIPERLUKAN',
                                'SEDANG_DIPROSES','DALAM_SEMAKAN_AKHIR',
                                'SEDIA_UNTUK_DIAMBIL','SELESAI','DIBATALKAN')),
  next_action_owner           TEXT NOT NULL DEFAULT 'NONE' CHECK (next_action_owner IN
                                ('NONE','APPLICANT','RECORDS','DOCTOR','FINANCE')),
  priority_reason             TEXT,
  responsible_officer_id      TEXT REFERENCES users(user_id),
  cancellation_reason         TEXT,
  cancellation_public_message TEXT,
  cancelled_at                TEXT,
  last_public_update_at       TEXT NOT NULL,
  is_synthetic                INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0,1)),
  source_system               TEXT NOT NULL DEFAULT 'MANUAL',
  imported_at                 TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX idx_app_status ON applications(internal_status);
CREATE INDEX idx_app_dept ON applications(department_id);
CREATE INDEX idx_app_received ON applications(received_at);
CREATE INDEX idx_app_due ON applications(original_service_due_at);

-- A public tracking token is a credential: only its HMAC is stored, and it can
-- be revoked and replaced without touching the application record.
CREATE TABLE public_tracking_tokens (
  token_hash      TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(application_id),
  issued_at       TEXT NOT NULL,
  revoked_at      TEXT,
  revoked_reason  TEXT,
  last_used_at    TEXT
);
CREATE INDEX idx_token_app ON public_tracking_tokens(application_id);

CREATE TABLE doctor_tasks (
  task_id                 TEXT PRIMARY KEY,
  application_id          TEXT NOT NULL REFERENCES applications(application_id),
  doctor_id               TEXT NOT NULL REFERENCES doctors(doctor_id),
  department_id           TEXT NOT NULL REFERENCES departments(department_id),
  sequence_no             INTEGER NOT NULL DEFAULT 1,
  active                  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  assigned_at             TEXT NOT NULL,
  assigned_by             TEXT REFERENCES users(user_id),
  acknowledged_at         TEXT,
  original_doctor_due_at  TEXT NOT NULL,
  current_doctor_due_at   TEXT NOT NULL,
  signed_submitted_at     TEXT,
  accepted_completed_at   TEXT,
  returned_at             TEXT,
  return_count            INTEGER NOT NULL DEFAULT 0,
  reassignment_events     INTEGER NOT NULL DEFAULT 0,
  superseded_at           TEXT,
  delay_reason_code       TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX idx_task_app ON doctor_tasks(application_id);
CREATE INDEX idx_task_doctor ON doctor_tasks(doctor_id);
CREATE INDEX idx_task_dept ON doctor_tasks(department_id);
-- At most one active task per application, so "who owns this now" is unambiguous.
CREATE UNIQUE INDEX uq_task_active ON doctor_tasks(application_id) WHERE active = 1;

CREATE TABLE releases (
  application_id              TEXT PRIMARY KEY REFERENCES applications(application_id),
  report_completed_at         TEXT,
  ready_at                    TEXT,
  notified_at                 TEXT,
  collection_or_delivery_at   TEXT,
  release_method              TEXT CHECK (release_method IN
                                ('COUNTER_COLLECTION','POST','COURIER','APPROVED_EMAIL')),
  release_authorised_by       TEXT REFERENCES users(user_id),
  receipt_of_delivery_reference TEXT,
  collected_by_description    TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

-- ------------------------------------------------------------------- fees

CREATE TABLE patient_fees (
  application_id      TEXT PRIMARY KEY REFERENCES applications(application_id),
  amount_due_sen      INTEGER NOT NULL DEFAULT 0 CHECK (amount_due_sen >= 0),
  amount_received_sen INTEGER NOT NULL DEFAULT 0 CHECK (amount_received_sen >= 0),
  currency            TEXT NOT NULL DEFAULT 'MYR',
  receipt_reference   TEXT,
  fee_status          TEXT NOT NULL CHECK (fee_status IN
                        ('NOT_REQUIRED','AWAITING_PAYMENT','PAID','EXEMPT',
                         'REFUNDED','RECONCILIATION_EXCEPTION')),
  exemption_basis     TEXT,
  verified_at         TEXT,
  verified_by         TEXT REFERENCES users(user_id),
  refund_amount_sen   INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount_sen >= 0),
  fee_rule_version    TEXT NOT NULL REFERENCES fee_rules(fee_rule_version),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  -- "Paid" is never assertable without a receipt, a verified amount and a date.
  CHECK (fee_status <> 'PAID' OR (receipt_reference IS NOT NULL
         AND amount_received_sen > 0 AND verified_at IS NOT NULL)),
  CHECK (fee_status <> 'EXEMPT' OR exemption_basis IS NOT NULL)
);

-- --------------------------------------------------------- claims and payments

CREATE TABLE claims (
  claim_id        TEXT PRIMARY KEY,
  doctor_id       TEXT NOT NULL REFERENCES doctors(doctor_id),
  submitted_by    TEXT REFERENCES users(user_id),
  submitted_at    TEXT,
  created_at      TEXT NOT NULL,
  is_synthetic    INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0,1))
);

CREATE TABLE claim_items (
  claim_item_id               TEXT PRIMARY KEY,
  claim_id                    TEXT REFERENCES claims(claim_id),
  application_id              TEXT NOT NULL REFERENCES applications(application_id),
  task_id                     TEXT NOT NULL REFERENCES doctor_tasks(task_id),
  doctor_id                   TEXT NOT NULL REFERENCES doctors(doctor_id),
  department_id               TEXT NOT NULL REFERENCES departments(department_id),
  eligibility_status          TEXT NOT NULL CHECK (eligibility_status IN
                                ('UNASSESSED','ELIGIBLE','NOT_ELIGIBLE')),
  eligibility_rule_version    TEXT REFERENCES claim_eligibility_rules(eligibility_rule_version),
  eligibility_assessed_by     TEXT REFERENCES users(user_id),
  eligible_at                 TEXT,
  not_eligible_reason         TEXT,
  form_attachment_reference   TEXT,
  submitted_at                TEXT,
  submitted_by                TEXT REFERENCES users(user_id),
  finance_received_at         TEXT,
  verified_at                 TEXT,
  verified_by                 TEXT REFERENCES users(user_id),
  approved_at                 TEXT,
  approved_by                 TEXT REFERENCES users(user_id),
  instructed_at               TEXT,
  status                      TEXT NOT NULL CHECK (status IN (
                                'NOT_SUBMITTED','SUBMITTED','UNDER_VERIFICATION','RETURNED',
                                'VERIFIED','APPROVED','PAYMENT_PROCESSING','PARTIALLY_PAID',
                                'PAID','PAYMENT_FAILED','REVERSED','REJECTED','WITHDRAWN')),
  claimed_amount_sen          INTEGER NOT NULL DEFAULT 0 CHECK (claimed_amount_sen >= 0),
  approved_amount_sen         INTEGER,
  return_reason               TEXT,
  is_synthetic                INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0,1)),
  source_system               TEXT NOT NULL DEFAULT 'MANUAL',
  imported_at                 TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  CHECK (eligibility_status <> 'ELIGIBLE' OR
         (eligible_at IS NOT NULL AND eligibility_rule_version IS NOT NULL)),
  CHECK (status = 'NOT_SUBMITTED' OR submitted_at IS NOT NULL),
  CHECK (approved_at IS NULL OR approved_amount_sen IS NOT NULL),
  -- Approval must be a different user from submission: separation of duty.
  CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by)
);
CREATE INDEX idx_ci_app ON claim_items(application_id);
CREATE INDEX idx_ci_doctor ON claim_items(doctor_id);
CREATE INDEX idx_ci_status ON claim_items(status);
CREATE INDEX idx_ci_eligible ON claim_items(eligible_at);

-- One live claim item per eligible service. Terminal non-consuming outcomes
-- (rejected, withdrawn, reversed) free the slot; everything else blocks a
-- duplicate, whether it arrives by resubmission or by spreadsheet import.
CREATE UNIQUE INDEX uq_claim_item_active
  ON claim_items(application_id, task_id, eligibility_rule_version)
  WHERE status NOT IN ('REJECTED','WITHDRAWN','REVERSED')
    AND eligibility_status = 'ELIGIBLE';

CREATE TABLE payment_allocations (
  payment_id          TEXT PRIMARY KEY,
  claim_item_id       TEXT NOT NULL REFERENCES claim_items(claim_item_id),
  payment_reference   TEXT,
  voucher_reference   TEXT,
  instructed_at       TEXT,
  paid_at             TEXT,
  reconciled_at       TEXT,
  reconciled_by       TEXT REFERENCES users(user_id),
  amount_paid_sen     INTEGER NOT NULL DEFAULT 0,
  payment_status      TEXT NOT NULL CHECK (payment_status IN
                        ('INSTRUCTED','RECONCILED','FAILED','REVERSED')),
  failure_reason      TEXT,
  reversal_reference  TEXT,
  reverses_payment_id TEXT REFERENCES payment_allocations(payment_id),
  is_synthetic        INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0,1)),
  source_system       TEXT NOT NULL DEFAULT 'MANUAL',
  created_at          TEXT NOT NULL,
  -- A reconciled payment is only evidence when it carries reference, amount and date.
  CHECK (payment_status <> 'RECONCILED' OR (payment_reference IS NOT NULL
         AND paid_at IS NOT NULL AND reconciled_at IS NOT NULL AND amount_paid_sen <> 0))
);
CREATE INDEX idx_pay_item ON payment_allocations(claim_item_id);
CREATE UNIQUE INDEX uq_pay_reference
  ON payment_allocations(claim_item_id, payment_reference)
  WHERE payment_reference IS NOT NULL;

-- ------------------------------------------------- events, evidence, controls

-- Append-only. No UPDATE or DELETE statement in the codebase targets this table.
CREATE TABLE status_events (
  event_id            TEXT PRIMARY KEY,
  entity_type         TEXT NOT NULL CHECK (entity_type IN
                        ('APPLICATION','DOCTOR_TASK','PATIENT_FEE','CLAIM_ITEM','PAYMENT','RELEASE')),
  entity_id           TEXT NOT NULL,
  application_id      TEXT REFERENCES applications(application_id),
  event_type          TEXT NOT NULL,
  from_status         TEXT,
  to_status           TEXT,
  occurred_at         TEXT NOT NULL,      -- when the thing happened
  recorded_at         TEXT NOT NULL,      -- when the system was told
  actor_user_id       TEXT REFERENCES users(user_id),
  actor_role          TEXT,
  reason_code         TEXT,
  note                TEXT,
  payload_json        TEXT,
  idempotency_key     TEXT,
  sequence_no         INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_se_entity ON status_events(entity_type, entity_id, sequence_no);
CREATE INDEX idx_se_app ON status_events(application_id, occurred_at);
CREATE INDEX idx_se_type ON status_events(event_type, occurred_at);

CREATE TABLE delay_events (
  delay_event_id  TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(application_id),
  task_id         TEXT REFERENCES doctor_tasks(task_id),
  -- Which stage owned the delay. Keeps delay off the doctor by default.
  stage           TEXT NOT NULL CHECK (stage IN
                    ('REGISTRATION','COMPLETENESS','ASSIGNMENT','DOCTOR_PREPARATION',
                     'RECORDS_VERIFICATION','RELEASE','COLLECTION','FINANCE')),
  attributed_to   TEXT NOT NULL CHECK (attributed_to IN
                    ('APPLICANT','RECORDS','DOCTOR','FINANCE','EXTERNAL','UNATTRIBUTED')),
  reason_code     TEXT NOT NULL,
  note            TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  recorded_by     TEXT REFERENCES users(user_id),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_delay_app ON delay_events(application_id);

CREATE TABLE deadline_extensions (
  extension_id        TEXT PRIMARY KEY,
  application_id      TEXT NOT NULL REFERENCES applications(application_id),
  original_due_at     TEXT NOT NULL,
  revised_due_at      TEXT NOT NULL,
  reason              TEXT NOT NULL,
  approved_by         TEXT NOT NULL REFERENCES users(user_id),
  requested_at        TEXT NOT NULL,
  approved_at         TEXT NOT NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_ext_app ON deadline_extensions(application_id);

CREATE TABLE notifications (
  notification_id     TEXT PRIMARY KEY,
  application_id      TEXT REFERENCES applications(application_id),
  recipient_kind      TEXT NOT NULL CHECK (recipient_kind IN
                        ('APPLICANT','DOCTOR','RECORDS','HOD','FINANCE','MANAGER')),
  recipient_reference TEXT NOT NULL,
  channel             TEXT NOT NULL CHECK (channel IN ('SMS','EMAIL','APPROVED_MESSAGING','IN_APP')),
  template_key        TEXT NOT NULL,
  -- Minimal administrative content only. No clinical text, no full identifiers.
  body_preview        TEXT NOT NULL,
  provider            TEXT NOT NULL,
  simulated           INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0,1)),
  status              TEXT NOT NULL CHECK (status IN
                        ('QUEUED','SENT','DELIVERED','FAILED','SUPPRESSED','ACKNOWLEDGED')),
  failure_reason      TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  dedupe_key          TEXT NOT NULL,
  scheduled_for       TEXT,
  sent_at             TEXT,
  delivered_at        TEXT,
  acknowledged_at     TEXT,
  created_at          TEXT NOT NULL
);
-- Prevents the same reminder going out twice however many times a job retries.
CREATE UNIQUE INDEX uq_notify_dedupe ON notifications(dedupe_key);
CREATE INDEX idx_notify_app ON notifications(application_id);
CREATE INDEX idx_notify_status ON notifications(status);

CREATE TABLE contact_enquiries (
  enquiry_id      TEXT PRIMARY KEY,
  application_id  TEXT REFERENCES applications(application_id),
  channel         TEXT NOT NULL CHECK (channel IN ('PHONE','COUNTER_VISIT','EMAIL','PORTAL')),
  enquiry_kind    TEXT NOT NULL CHECK (enquiry_kind IN
                    ('STATUS_CHECK','DOCUMENT_QUERY','FEE_QUERY','COLLECTION_QUERY','OTHER')),
  occurred_at     TEXT NOT NULL,
  logged_by       TEXT REFERENCES users(user_id),
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_enquiry_when ON contact_enquiries(occurred_at);

CREATE TABLE audit_events (
  audit_id        TEXT PRIMARY KEY,
  occurred_at     TEXT NOT NULL,
  actor_user_id   TEXT REFERENCES users(user_id),
  actor_role      TEXT,
  action          TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('ALLOWED','DENIED','ERROR')),
  resource_type   TEXT,
  resource_id     TEXT,
  permission      TEXT,
  request_method  TEXT,
  request_path    TEXT,
  client_hint     TEXT,
  detail_json     TEXT
);
CREATE INDEX idx_audit_when ON audit_events(occurred_at);
CREATE INDEX idx_audit_actor ON audit_events(actor_user_id, occurred_at);

CREATE TABLE attachments (
  attachment_id   TEXT PRIMARY KEY,
  application_id  TEXT REFERENCES applications(application_id),
  claim_item_id   TEXT REFERENCES claim_items(claim_item_id),
  -- Administrative attachments only. Clinical report authoring stays in the
  -- existing approved workflow; see docs/11-integration-notes.md.
  kind            TEXT NOT NULL CHECK (kind IN
                    ('AUTHORITY_LETTER','CONSENT_FORM','FEE_RECEIPT','CLAIM_FORM',
                     'DELIVERY_RECEIPT','IMPORT_FILE','OTHER_ADMINISTRATIVE')),
  filename        TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  scan_status     TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','SKIPPED_SIMULATION')),
  uploaded_by     TEXT REFERENCES users(user_id),
  uploaded_at     TEXT NOT NULL
);
CREATE INDEX idx_att_app ON attachments(application_id);

CREATE TABLE policy_documents (
  document_id         TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  document_version    TEXT NOT NULL,
  effective_date      TEXT,
  issuer              TEXT,
  internal_link       TEXT,
  required_clearance  TEXT NOT NULL DEFAULT 'STANDARD',
  collection_version  TEXT NOT NULL,
  approval_state      TEXT NOT NULL DEFAULT 'NOT_SUPPLIED'
                        CHECK (approval_state IN ('NOT_SUPPLIED','PENDING_APPROVAL','APPROVED','SUPERSEDED')),
  superseded_by       TEXT REFERENCES policy_documents(document_id),
  owner               TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE policy_passages (
  passage_id      TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES policy_documents(document_id),
  clause_or_page  TEXT NOT NULL,
  passage_text    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE recommendation_acceptances (
  acceptance_id   TEXT PRIMARY KEY,
  recommendation_key TEXT NOT NULL,
  period_key      TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('ACCEPTED','DECLINED','DEFERRED')),
  action_owner    TEXT,
  review_date     TEXT,
  note            TEXT,
  decided_by      TEXT NOT NULL REFERENCES users(user_id),
  decided_at      TEXT NOT NULL
);

CREATE TABLE monthly_snapshot_versions (
  snapshot_id       TEXT PRIMARY KEY,
  period_month      TEXT NOT NULL,          -- YYYY-MM, Asia/Kuala_Lumpur
  revision          INTEGER NOT NULL,
  data_as_of        TEXT NOT NULL,
  sla_rule_version  TEXT NOT NULL,
  calendar_version  TEXT NOT NULL,
  formula_version   TEXT NOT NULL,
  data_class        TEXT NOT NULL CHECK (data_class IN ('SYNTHETIC','LIVE')),
  frozen_at         TEXT NOT NULL,
  frozen_by         TEXT NOT NULL REFERENCES users(user_id),
  supersedes        TEXT REFERENCES monthly_snapshot_versions(snapshot_id),
  revision_reason   TEXT,
  metrics_json      TEXT NOT NULL,
  UNIQUE (period_month, revision)
);

CREATE TABLE import_batches (
  batch_id        TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  target_entity   TEXT NOT NULL,
  filename        TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  accepted_count  INTEGER NOT NULL DEFAULT 0,
  rejected_count  INTEGER NOT NULL DEFAULT 0,
  conflict_count  INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT NOT NULL,
  imported_by     TEXT REFERENCES users(user_id),
  reconciled_by   TEXT REFERENCES users(user_id),
  reconciled_at   TEXT,
  -- An import is a manual reconciliation, never described in the UI as live integration.
  integration_mode TEXT NOT NULL DEFAULT 'MANUAL_IMPORT'
                    CHECK (integration_mode IN ('MANUAL_IMPORT','APPROVED_INTERFACE')),
  notes           TEXT
);

CREATE TABLE import_rows (
  batch_id        TEXT NOT NULL REFERENCES import_batches(batch_id),
  row_number      INTEGER NOT NULL,
  natural_key     TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED','DUPLICATE','CONFLICT')),
  message         TEXT,
  PRIMARY KEY (batch_id, row_number)
);

-- Replay protection for every mutating staff/finance request.
CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  route           TEXT NOT NULL,
  user_id         TEXT REFERENCES users(user_id),
  request_hash    TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

-- One-time codes for step-up verification. Only the hash is stored.
CREATE TABLE otp_challenges (
  challenge_id        TEXT PRIMARY KEY,
  application_id      TEXT NOT NULL REFERENCES applications(application_id),
  destination_hash    TEXT NOT NULL,
  destination_masked  TEXT NOT NULL,
  code_hash           TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  issued_at           TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  consumed_at         TEXT
);
CREATE INDEX idx_otp_app ON otp_challenges(application_id);

-- Fixed-window counters. Keyed by a salted hash of the client hint, never a raw IP.
CREATE TABLE rate_limit_buckets (
  bucket_key      TEXT NOT NULL,
  window_start    TEXT NOT NULL,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- `schema_migrations` is created by the migration runner itself
-- (server/db/database.ts) before any file is applied, so it is not declared here.
