/**
 * Staff sessions.
 *
 * The session id is a 256-bit random value sent in an HttpOnly, SameSite=Strict
 * cookie; only its HMAC is stored, so a database dump cannot be replayed as a
 * live session. Sessions expire, can be revoked, and privileged roles must clear
 * MFA before any permission is granted.
 */
import type { Handle } from '../db/database.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { nowInstant } from '../domain/time.ts';
import { verifyPassword } from './passwords.ts';
import { hashSecret, newSessionId } from './tokens.ts';
import type { Role } from '../../shared/domain.ts';

export const SESSION_COOKIE = 'ikn_staff_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;     // one working day
const IDLE_NOTE = 'Session expiry is deliberately short; staff re-authenticate each shift.';

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  isSupervisor: boolean;
  doctorId: string | null;
  departmentIds: readonly string[];
  mfaRequired: boolean;
  mfaSatisfied: boolean;
  policyClearance: string;
}

export interface LoginResult {
  sessionId: string;
  principal: Principal;
  /** True when the account needs a second factor before permissions apply. */
  mfaPending: boolean;
}

export function login(
  handle: Handle, username: string, password: string, clientHint: string | null,
): LoginResult | null {
  const row = handle.get<{
    user_id: string; username: string; display_name: string; role: Role; is_supervisor: number;
    doctor_id: string | null; password_hash: string; password_salt: string; mfa_required: number;
    policy_clearance: string; active: number;
  }>('SELECT * FROM users WHERE username = ?', username.trim().toLowerCase());

  // The same failure is returned for an unknown username and a wrong password,
  // and the password check still runs against a dummy salt for an unknown user so
  // the two paths take comparable time.
  if (!row || row.active !== 1) {
    verifyPassword(password, '0'.repeat(32), '0'.repeat(128));
    appendAuditEvent(handle, {
      action: 'AUTH_LOGIN', outcome: 'DENIED', clientHint,
      detail: { reason: 'unknown_or_inactive_account' },
    });
    return null;
  }
  if (!verifyPassword(password, row.password_salt, row.password_hash)) {
    appendAuditEvent(handle, {
      actorUserId: row.user_id, actorRole: row.role, action: 'AUTH_LOGIN', outcome: 'DENIED',
      clientHint, detail: { reason: 'bad_password' },
    });
    return null;
  }

  const departments = handle.all<{ department_id: string }>(
    'SELECT department_id FROM user_departments WHERE user_id = ?', row.user_id)
    .map((d) => d.department_id);

  const sessionId = newSessionId();
  const now = nowInstant();
  handle.run(
    `INSERT INTO sessions (session_id_hash, user_id, created_at, expires_at, mfa_satisfied)
     VALUES (?,?,?,?,?)`,
    hashSecret(sessionId, 'session'), row.user_id, now,
    new Date(Date.now() + SESSION_TTL_MS).toISOString(), row.mfa_required === 1 ? 0 : 1);

  appendAuditEvent(handle, {
    actorUserId: row.user_id, actorRole: row.role, action: 'AUTH_LOGIN', outcome: 'ALLOWED',
    clientHint, detail: { mfaRequired: row.mfa_required === 1, note: IDLE_NOTE },
  });

  return {
    sessionId,
    mfaPending: row.mfa_required === 1,
    principal: {
      userId: row.user_id, username: row.username, displayName: row.display_name,
      role: row.role, isSupervisor: row.is_supervisor === 1, doctorId: row.doctor_id,
      departmentIds: departments, mfaRequired: row.mfa_required === 1,
      mfaSatisfied: row.mfa_required !== 1, policyClearance: row.policy_clearance,
    },
  };
}

export function resolveSession(handle: Handle, sessionId: string | undefined): Principal | null {
  if (!sessionId) return null;
  const row = handle.get<{
    user_id: string; expires_at: string; revoked_at: string | null; mfa_satisfied: number;
    username: string; display_name: string; role: Role; is_supervisor: number;
    doctor_id: string | null; mfa_required: number; policy_clearance: string; active: number;
  }>(`SELECT s.user_id, s.expires_at, s.revoked_at, s.mfa_satisfied, u.username, u.display_name,
             u.role, u.is_supervisor, u.doctor_id, u.mfa_required, u.policy_clearance, u.active
      FROM sessions s JOIN users u ON u.user_id = s.user_id
      WHERE s.session_id_hash = ?`, hashSecret(sessionId, 'session'));

  if (!row || row.revoked_at || row.active !== 1) return null;
  if (row.expires_at <= nowInstant()) return null;

  const departments = handle.all<{ department_id: string }>(
    'SELECT department_id FROM user_departments WHERE user_id = ?', row.user_id)
    .map((d) => d.department_id);

  return {
    userId: row.user_id, username: row.username, displayName: row.display_name, role: row.role,
    isSupervisor: row.is_supervisor === 1, doctorId: row.doctor_id, departmentIds: departments,
    mfaRequired: row.mfa_required === 1, mfaSatisfied: row.mfa_satisfied === 1,
    policyClearance: row.policy_clearance,
  };
}

/**
 * Marks the second factor satisfied.
 *
 * The prototype has no enrolled authenticator, so this accepts a fixed
 * demonstration code and says so in the audit trail. Production wires this to the
 * IKN-approved MFA provider; the permission layer already refuses every request
 * from a session where `mfaSatisfied` is false, so the control is real even while
 * the factor is simulated.
 */
export const DEMO_MFA_CODE = '000000';

export function satisfyMfa(handle: Handle, sessionId: string, code: string): boolean {
  if (code !== DEMO_MFA_CODE) return false;
  const changed = handle.run(
    'UPDATE sessions SET mfa_satisfied = 1 WHERE session_id_hash = ? AND revoked_at IS NULL',
    hashSecret(sessionId, 'session')).changes;
  if (changed > 0) {
    appendAuditEvent(handle, {
      action: 'AUTH_MFA', outcome: 'ALLOWED',
      detail: { simulated: true, note: 'Prototype MFA: fixed demonstration code.' },
    });
  }
  return changed > 0;
}

export function logout(handle: Handle, sessionId: string | undefined): void {
  if (!sessionId) return;
  handle.run('UPDATE sessions SET revoked_at = ? WHERE session_id_hash = ?',
    nowInstant(), hashSecret(sessionId, 'session'));
}
