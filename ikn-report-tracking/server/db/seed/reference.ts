/**
 * Reference data: calendar, versioned rules, configuration, departments and
 * accounts. Every policy-dependent value written here is UNVERIFIED and is
 * cross-referenced to `docs/05-assumptions-register.md` by number.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Handle } from '../database.ts';
import { hashPassword } from '../../auth/passwords.ts';
import { nowInstant } from '../../domain/time.ts';
import { parseCsv } from '../../../scripts/lib/csv.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const CALENDAR_VERSION = 'CAL-2024-2026-v1';
export const SLA_RULE_VERSION = 'SLA-PROTOTYPE-v1';
export const FEE_RULE_VERSION = 'FEE-DEMO-v1';
export const ELIGIBILITY_RULE_VERSION = 'DEMO-ELIG-1';

export const DEPARTMENTS: readonly { id: string; name: string }[] = [
  { id: 'DEPT-RTO', name: 'Radiotherapy & Oncology' },
  { id: 'DEPT-SUR', name: 'Surgery' },
  { id: 'DEPT-GYN', name: 'Gynaecological Oncology' },
  { id: 'DEPT-NUC', name: 'Nuclear Medicine' },
  { id: 'DEPT-PAL', name: 'Palliative & Supportive Care' },
  { id: 'DEPT-OMF', name: 'Oral & Maxillofacial Surgery' },
];

/**
 * Prototype accounts. The passwords are printed by the seeder and are meaningless
 * outside a local demonstration; production uses IKN staff SSO with MFA for
 * privileged roles.
 */
export const DEMO_PASSWORD = 'ikn-prototype-2026';

export function seedReference(handle: Handle): void {
  const now = nowInstant();

  // ---------------------------------------------------------------- calendar
  // Assumption #2: include_start_day = 0, i.e. the clock starts the working day
  // after completeness. UNVERIFIED — Records must confirm before production.
  handle.run(
    `INSERT INTO business_calendar_versions (calendar_version, description, timezone,
       include_start_day, weekend_days, effective_from, verification_state, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    CALENDAR_VERSION,
    'Mon–Fri working week with fixed-date Federal Territory (Putrajaya) public holidays. '
      + 'Variable-date and replacement holidays are NOT loaded — see data/calendar/README.md.',
    'Asia/Kuala_Lumpur', 0, '0,6', '2023-01-01T00:00:00.000Z', 'UNVERIFIED', now,
  );

  for (const file of ['holidays-fixed.csv', 'holidays-variable.csv']) {
    const rows = parseCsv(readFileSync(join(ROOT, 'data', 'calendar', file), 'utf8'));
    for (const r of rows) {
      if (!r.calendar_date) continue;
      handle.run(
        `INSERT OR IGNORE INTO business_calendar_days
           (calendar_version, calendar_date, day_kind, label) VALUES (?,?,?,?)`,
        CALENDAR_VERSION, r.calendar_date, r.day_kind ?? 'PUBLIC_HOLIDAY', r.label ?? '');
    }
  }

  // ----------------------------------------------------------------- SLA rule
  // #1 service allowance 28 working days — IKN public FAQ, from receipt of a
  //    COMPLETE application.
  // #4 doctor allowance 18 working days — INVENTED for the prototype. No official
  //    IKN allocation was supplied, and 14 and 21 are asserted nowhere.
  // #5 review buffer 3 working days — prototype choice.
  // #6 completion endpoint accepted_completed_at — the point Records can defend.
  // #7 target 85% — KKM Piagam Pelanggan reference for state/specialist hospitals;
  //    IKN's own approved target is unconfirmed.
  handle.run(
    `INSERT INTO sla_rules (sla_rule_version, description, service_working_days,
       doctor_working_days, review_buffer_days, by_report_type_json, completion_endpoint,
       on_time_target_percent, calendar_version, effective_from, verification_state, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    SLA_RULE_VERSION,
    'Prototype configuration. 28 working days general service allowance (IKN FAQ); '
      + '18 working day doctor allowance and 3 working day review buffer are prototype '
      + 'values, not IKN rules.',
    28, 18, 3, '{}', 'accepted_completed_at', 85,
    CALENDAR_VERSION, '2023-01-01T00:00:00.000Z', 'UNVERIFIED', now,
  );

  // ----------------------------------------------------------------- fee rule
  // #9 fictional amounts from the dummy workbook. #10 release is NOT fee-gated.
  handle.run(
    `INSERT INTO fee_rules (fee_rule_version, description, amounts_sen_json,
       release_requires_settled, currency, effective_from, verification_state, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    FEE_RULE_VERSION,
    'Fictional demonstration charges taken from the dummy workbook. Not official IKN charges.',
    JSON.stringify({
      'Ordinary report': 5000,
      'Specialist summary': 10000,
      'Detailed specialist report': 25000,
    }),
    0, 'MYR', '2023-01-01T00:00:00.000Z', 'UNVERIFIED', now,
  );

  // ------------------------------------------------------- eligibility rule
  // #11 invented criteria. Real eligibility criteria were not supplied.
  handle.run(
    `INSERT INTO claim_eligibility_rules (eligibility_rule_version, description,
       criteria_json, effective_from, verification_state, created_at)
     VALUES (?,?,?,?,?,?)`,
    ELIGIBILITY_RULE_VERSION,
    'Prototype criterion: one eligible item per chargeable report accepted as complete '
      + 'by Records. Invented for the prototype; not an IKN claim rule.',
    JSON.stringify({
      chargeableReportTypes: ['Ordinary report', 'Specialist summary', 'Detailed specialist report'],
      requiresEndpoint: 'accepted_completed_at',
    }),
    '2023-01-01T00:00:00.000Z', 'UNVERIFIED', now,
  );

  // ------------------------------------------------------------ configuration
  const config: [string, unknown, string, string][] = [
    ['sla.service.working_days', 28, 'IKN public FAQ — Rekod Perubatan', 'Records Unit head'],
    ['calendar.include_start_day', false, 'Convention not published; dummy dataset excludes the start day', 'Records Unit head'],
    ['sla.doctor.working_days', 18, 'Invented for the prototype', 'Clinical HODs + Records Unit'],
    ['sla.review_buffer.working_days', 3, 'Prototype choice', 'Records Unit head'],
    ['kpi.completion_endpoint', 'accepted_completed_at', 'Prototype choice; KPI specification not supplied', 'IKN KPI owner'],
    ['kpi.on_time_target_percent', 85, 'KKM Piagam Pelanggan reference for state/specialist hospitals', 'IKN KPI owner'],
    ['fee.release_requires_settled', false, 'No policy obtained permitting fee-gated release', 'Records Unit head + Finance'],
    ['payment.evidence_required', ['payment_reference', 'amount_paid', 'paid_at', 'reconciled_at'], 'Prototype control', 'Finance'],
    ['sla.finance.working_days', null, 'No finance allocation supplied; turnaround is reported, not judged', 'Finance'],
    ['notify.reminder_offsets', [7, 3, 1], 'Proposed operational setting, not a verified KKM rule', 'Records Unit head'],
    ['notify.escalation_chain', ['HOD', 'RECORDS_SUPERVISOR', 'AUTHORISED_MANAGER'], 'Proposed; local escalation policy not obtained', 'Records Unit head'],
    ['analytics.min_sample_size', 5, 'Prototype disclosure control', 'Records Unit head'],
    ['deploy.public_host', null, 'ICT-approved host required', 'IKN ICT'],
    ['notify.provider', 'SIMULATION', 'No approved gateway supplied', 'IKN ICT'],
    ['rag.collection_version', null, 'No approved, versioned policy collection supplied', 'Document owners'],
    ['integration.registration', 'MANUAL_IMPORT', 'No documented interface supplied', 'IKN ICT'],
    ['integration.finance', 'MANUAL_IMPORT', 'No documented interface supplied', 'Finance + ICT'],
  ];
  for (const [key, value, basis, owner] of config) {
    handle.run(
      `INSERT INTO config_settings (config_key, version, value_json, verification_state,
         owner_to_confirm, basis, effective_from, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      key, 1, JSON.stringify(value ?? null), 'UNVERIFIED', owner, basis, now, now);
  }

  // -------------------------------------------------------------- departments
  for (const d of DEPARTMENTS) {
    handle.run('INSERT INTO departments (department_id, name, active) VALUES (?,?,1)', d.id, d.name);
  }
}

export interface SeededUser { userId: string; username: string; role: string }

/** Creates the prototype staff accounts. Doctors are created by the synthetic seeder. */
export function seedStaffUsers(handle: Handle): SeededUser[] {
  const now = nowInstant();
  const created: SeededUser[] = [];

  const add = (
    userId: string, username: string, displayName: string, role: string,
    opts: { supervisor?: boolean; doctorId?: string | null; departments?: string[]; mfa?: boolean;
      clearance?: string } = {},
  ) => {
    const { hash, salt } = hashPassword(DEMO_PASSWORD);
    handle.run(
      `INSERT INTO users (user_id, username, display_name, role, is_supervisor, doctor_id,
         password_hash, password_salt, mfa_required, policy_clearance, active, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      userId, username, displayName, role, opts.supervisor ? 1 : 0, opts.doctorId ?? null,
      hash, salt, opts.mfa ? 1 : 0, opts.clearance ?? 'STANDARD', now);
    for (const dept of opts.departments ?? []) {
      handle.run('INSERT INTO user_departments (user_id, department_id) VALUES (?,?)', userId, dept);
    }
    created.push({ userId, username, role });
  };

  add('usr_records_1', 'records1', 'Pegawai Rekod Demo 1', 'records_officer');
  add('usr_records_sup', 'records.super', 'Penyelia Rekod Demo', 'records_officer', { supervisor: true });
  add('usr_finance_1', 'finance1', 'Pegawai Kewangan Demo 1', 'finance_officer', { mfa: true });
  // A second finance officer exists so claim approval can be performed by
  // somebody other than the person who handled the submission.
  add('usr_finance_2', 'finance2', 'Pegawai Kewangan Demo 2', 'finance_officer', { mfa: true });
  add('usr_director', 'director', 'Pengarah Demo', 'director', { mfa: true, clearance: 'DIRECTOR' });
  add('usr_admin', 'sysadmin', 'Pentadbir Sistem Demo', 'system_admin', { mfa: true });

  DEPARTMENTS.forEach((d, i) => {
    add(`usr_hod_${i + 1}`, `hod.${d.id.slice(5).toLowerCase()}`, `Ketua Jabatan Demo — ${d.name}`,
      'hod', { departments: [d.id] });
  });

  return created;
}

/**
 * Registers the policy documents the recommendation panel *would* cite, all in
 * state NOT_SUPPLIED. Nothing is citable until an approved copy is loaded, so the
 * RAG path withholds every policy claim and the deterministic panel serves instead.
 */
export function seedPolicyRegistry(handle: Handle): void {
  const now = nowInstant();
  const docs: [string, string, string][] = [
    ['doc_ikn_sop', 'IKN Records Unit SOP — medical report processing', 'Records Unit'],
    ['doc_kpk_16_2010', 'Surat Pekeliling KPK Bil. 16/2010 — preparation of medical reports', 'KKM'],
    ['doc_kpi_spec', 'IKN medical report KPI technical specification', 'IKN KPI owner'],
    ['doc_claim_circular', 'Claim and payment circular for medical report remuneration', 'Finance'],
    ['doc_escalation', 'IKN local escalation policy for overdue medical reports', 'Records Unit'],
    ['doc_ict_confidentiality', 'IKN ICT security and patient confidentiality requirements', 'IKN ICT'],
  ];
  for (const [id, title, owner] of docs) {
    handle.run(
      `INSERT INTO policy_documents (document_id, title, document_version, effective_date,
         issuer, internal_link, required_clearance, collection_version, approval_state, owner, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, title, 'NOT SUPPLIED', null, owner, null, 'STANDARD', 'NONE', 'NOT_SUPPLIED', owner, now);
  }
}
