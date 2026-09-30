/**
 * Test harness.
 *
 * Each suite gets its own throwaway database, seeded with reference data, so no
 * test can be made to pass by another test's leftovers. The synthetic dataset is
 * loaded only where a suite genuinely needs the volume, because seeding 1,000
 * applications takes a few seconds.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, db, migrate, type Handle } from '../server/db/database.ts';
import { seedPolicyRegistry, seedReference, seedStaffUsers,
  DEPARTMENTS } from '../server/db/seed/reference.ts';
import { seedSynthetic, type SeedSummary } from '../server/db/seed/synthetic.ts';
import { setPepper } from '../server/auth/tokens.ts';
import { invalidateCalendarCache } from '../server/domain/calendar.ts';
import { resolveSession, login, satisfyMfa, type Principal } from '../server/auth/session.ts';
import { createApp } from '../server/http/app.ts';
import type { Express } from 'express';

export const DEMO_PASSWORD = 'ikn-prototype-2026';

export interface Fixture {
  handle: Handle;
  app: Express;
  directory: string;
  summary?: SeedSummary;
  close: () => void;
}

/** Creates an isolated database. `withSynthetic` loads the full 1,000-row dataset. */
export function createFixture(withSynthetic = false): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'ikn-test-'));
  process.env.IKN_DB_FILE = join(directory, 'test.sqlite');
  process.env.IKN_DATA_CLASS = 'SYNTHETIC';
  process.env.IKN_NOTIFY_PROVIDER = 'SIMULATION';
  process.env.NODE_ENV = 'test';
  closeDatabase();
  invalidateCalendarCache();
  setPepper('test-pepper-0000000000000000000000000000000000');

  const handle = db();
  migrate(handle);
  let summary: SeedSummary | undefined;
  handle.transaction(() => {
    seedReference(handle);
    seedStaffUsers(handle);
    seedPolicyRegistry(handle);
    if (withSynthetic) summary = seedSynthetic(handle);
  });

  return {
    handle,
    app: createApp(),
    directory,
    ...(summary ? { summary } : {}),
    close: () => {
      closeDatabase();
      invalidateCalendarCache();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Signs a user in and returns their principal, clearing MFA where required. */
export function principalFor(handle: Handle, username: string): Principal {
  const result = login(handle, username, DEMO_PASSWORD, 'test');
  if (!result) throw new Error(`could not sign in as ${username}`);
  if (result.mfaPending) satisfyMfa(handle, result.sessionId, '000000');
  const principal = resolveSession(handle, result.sessionId);
  if (!principal) throw new Error(`no session for ${username}`);
  return principal;
}

/** Signs in over HTTP and returns the session cookie, for route-level tests. */
export async function signIn(app: Express, username: string): Promise<string> {
  const response = await request(app, 'POST', '/api/auth/login',
    { username, password: DEMO_PASSWORD });
  const cookie = extractCookie(response.headers['set-cookie']);
  if (!cookie) throw new Error(`no session cookie for ${username}`);
  if ((response.body as { mfaPending?: boolean }).mfaPending) {
    await request(app, 'POST', '/api/auth/mfa', { code: '000000' }, cookie);
  }
  return cookie;
}

function extractCookie(header: unknown): string | null {
  const values = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  for (const value of values) {
    const match = /(^|;\s*)ikn_staff_session=([^;]+)/.exec(value);
    if (match) return `ikn_staff_session=${match[2]}`;
  }
  return null;
}

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Drives the Express app over a real socket.
 *
 * Going through HTTP rather than calling handlers directly is the point: an
 * access-control test that bypasses the router proves nothing about the route.
 */
export async function request(
  app: Express, method: string, path: string, body?: unknown,
  cookie?: string, extraHeaders?: Record<string, string>,
): Promise<TestResponse> {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return {
      status: response.status,
      body: parsed,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);

/**
 * Creates a doctor and the login that goes with it.
 *
 * The synthetic seeder creates eighteen of these; a suite that does not need the
 * full dataset makes just the one or two it exercises.
 */
export function createDoctor(
  handle: Handle, doctorId: string, displayName: string, departmentId = DEPARTMENT_IDS[0]!,
): { doctorId: string; username: string } {
  const { hashPassword } = passwordsModule;
  const { hash, salt } = hashPassword(DEMO_PASSWORD);
  const username = doctorId.toLowerCase();
  handle.run(
    'INSERT INTO doctors (doctor_id, display_name, department_id, active, is_synthetic) VALUES (?,?,?,1,1)',
    doctorId, displayName, departmentId);
  handle.run(
    `INSERT INTO users (user_id, username, display_name, role, is_supervisor, doctor_id,
       password_hash, password_salt, mfa_required, policy_clearance, active, created_at)
     VALUES (?,?,?,'doctor',0,?,?,?,0,'STANDARD',1,?)`,
    `usr_${username}`, username, displayName, doctorId, hash, salt, new Date().toISOString());
  handle.run('INSERT INTO user_departments (user_id, department_id) VALUES (?,?)',
    `usr_${username}`, departmentId);
  return { doctorId, username };
}

/** Registers an application directly, returning its id and public reference. */
export function registerApplication(
  handle: Handle, overrides: Partial<{
    reportType: string; departmentId: string; receivedAt: string; applicantRole: string;
  }> = {},
): { applicationId: string; reference: string } {
  const { newId, newPublicTrackingReference, normaliseTrackingReference,
    formatInternalReportNumber } = requireIds();
  const { hashSecret } = requireTokens();
  const { activeFeeRule, activeSlaRule } = requireRules();

  const receivedAt = overrides.receivedAt ?? new Date().toISOString();
  const sla = activeSlaRule(handle, receivedAt);
  const fee = activeFeeRule(handle, receivedAt);
  const applicationId = newId('app');
  const reference = newPublicTrackingReference();
  const sequence = (handle.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM applications')?.n ?? 0) + 1;
  const reportType = overrides.reportType ?? 'Specialist summary';

  handle.run(
    `INSERT INTO applications (application_id, internal_report_number, applicant_role,
       protected_patient_reference, verified_contact_reference, report_type, request_purpose,
       department_id, received_at, sla_rule_version, fee_rule_version, internal_status,
       public_status, next_action_owner, responsible_officer_id, last_public_update_at,
       is_synthetic, source_system, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'RECEIVED','PERMOHONAN_DITERIMA','RECORDS',
       'usr_records_1',?,1,'TEST',?,?)`,
    applicationId, formatInternalReportNumber(2026, sequence),
    overrides.applicantRole ?? 'PATIENT', `PSEUDO-${applicationId}`,
    `CONTACT-REF-${applicationId}`, reportType, 'Insurance',
    overrides.departmentId ?? DEPARTMENT_IDS[0]!, receivedAt,
    sla.slaRuleVersion, fee.feeRuleVersion, receivedAt, receivedAt, receivedAt);

  handle.run(
    'INSERT INTO public_tracking_tokens (token_hash, application_id, issued_at) VALUES (?,?,?)',
    hashSecret(normaliseTrackingReference(reference), 'tracking'), applicationId, receivedAt);

  const amountSen = fee.amountsSen[reportType] ?? 0;
  handle.run(
    `INSERT INTO patient_fees (application_id, amount_due_sen, amount_received_sen, currency,
       fee_status, fee_rule_version, created_at, updated_at) VALUES (?,?,0,?,?,?,?,?)`,
    applicationId, amountSen, fee.currency,
    amountSen > 0 ? 'AWAITING_PAYMENT' : 'NOT_REQUIRED', fee.feeRuleVersion,
    receivedAt, receivedAt);

  return { applicationId, reference };
}

// Imported lazily so the harness can be loaded before the database exists.
function requireIds() { return idsModule; }
function requireTokens() { return tokensModule; }
function requireRules() { return rulesModule; }

import * as idsModule from '../server/domain/ids.ts';
import * as tokensModule from '../server/auth/tokens.ts';
import * as rulesModule from '../server/domain/rules.ts';
import * as passwordsModule from '../server/auth/passwords.ts';
