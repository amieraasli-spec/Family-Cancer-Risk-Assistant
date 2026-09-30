/**
 * Idempotency for mutating requests.
 *
 * A retried POST — a flaky tablet connection, a double tap, a replayed import row
 * — must not create a second claim, a second payment or a second notification. The
 * client sends an `Idempotency-Key`; the first completed response is stored and
 * replayed verbatim for any repeat of the same key with the same body.
 */
import { createHash } from 'node:crypto';
import type { Handle } from '../db/database.ts';
import { nowInstant } from '../domain/time.ts';
import { conflict } from './errors.ts';

export interface ReplayedResponse {
  statusCode: number;
  body: unknown;
}

export function requestHash(route: string, body: unknown): string {
  return createHash('sha256').update(`${route}\n${JSON.stringify(body ?? null)}`).digest('hex');
}

/**
 * Looks for a stored response. Returns it when the same key and body have already
 * been handled; throws 409 when the same key arrives with a *different* body,
 * which is a client bug worth surfacing rather than silently answering.
 */
export function lookup(
  handle: Handle, key: string | undefined, route: string, body: unknown,
): ReplayedResponse | null {
  if (!key) return null;
  const row = handle.get<{ request_hash: string; response_json: string; status_code: number }>(
    'SELECT request_hash, response_json, status_code FROM idempotency_keys WHERE idempotency_key = ?',
    key);
  if (!row) return null;
  if (row.request_hash !== requestHash(route, body)) {
    throw conflict('IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used for a different request body.');
  }
  return { statusCode: row.status_code, body: JSON.parse(row.response_json) };
}

export function store(
  handle: Handle, key: string | undefined, route: string, body: unknown,
  userId: string | null, statusCode: number, response: unknown,
): void {
  if (!key) return;
  handle.run(
    `INSERT OR IGNORE INTO idempotency_keys (idempotency_key, route, user_id, request_hash,
       response_json, status_code, created_at) VALUES (?,?,?,?,?,?,?)`,
    key, route, userId, requestHash(route, body), JSON.stringify(response ?? null),
    statusCode, nowInstant());
}
