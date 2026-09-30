/**
 * Fixed-window rate limiting, persisted so a restart cannot reset an attacker's
 * budget.
 *
 * The bucket key is a salted hash of the client hint, never a raw IP address, so
 * the limiter works without retaining an identifier it has no purpose for.
 */
import type { Handle } from '../db/database.ts';
import { hashSecret } from '../auth/tokens.ts';
import { tooManyRequests } from './errors.ts';

export interface Limit {
  /** Requests permitted per window. */
  max: number;
  windowSeconds: number;
}

/**
 * Prototype limits for the public surface. Deliberately tight: the public routes
 * are the only unauthenticated attack surface in the system.
 */
export const PUBLIC_LIMITS = {
  /** Status lookups by tracking reference. */
  statusLookup: { max: 10, windowSeconds: 300 } satisfies Limit,
  /** Requests for a one-time verification code, per client. */
  otpRequest: { max: 3, windowSeconds: 900 } satisfies Limit,
  /** Requests for a one-time code, per application — blunts SMS flooding. */
  otpPerApplication: { max: 5, windowSeconds: 3600 } satisfies Limit,
  /** One-time code verification attempts. */
  otpVerify: { max: 8, windowSeconds: 900 } satisfies Limit,
  /** Staff sign-in attempts. */
  login: { max: 10, windowSeconds: 900 } satisfies Limit,
} as const;

function windowStart(windowSeconds: number, at = Date.now()): string {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(at / size) * size).toISOString();
}

export interface LimitOutcome {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Consumes one unit from a bucket. Returns the outcome rather than throwing. */
export function consume(
  handle: Handle, namespace: string, identity: string, limit: Limit,
): LimitOutcome {
  const key = `${namespace}:${hashSecret(identity, 'ratelimit')}`;
  const start = windowStart(limit.windowSeconds);
  handle.run(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, hit_count) VALUES (?,?,1)
     ON CONFLICT(bucket_key, window_start) DO UPDATE SET hit_count = hit_count + 1`,
    key, start);
  const row = handle.get<{ hit_count: number }>(
    'SELECT hit_count FROM rate_limit_buckets WHERE bucket_key = ? AND window_start = ?', key, start);
  const used = row?.hit_count ?? 1;
  const elapsed = Math.floor((Date.now() - Date.parse(start)) / 1000);
  return {
    allowed: used <= limit.max,
    remaining: Math.max(0, limit.max - used),
    retryAfterSeconds: Math.max(1, limit.windowSeconds - elapsed),
  };
}

/** Consumes one unit and throws 429 when the bucket is empty. */
export function enforce(
  handle: Handle, namespace: string, identity: string, limit: Limit,
): void {
  const outcome = consume(handle, namespace, identity, limit);
  if (!outcome.allowed) throw tooManyRequests();
}

/** Removes windows older than a day. Called from the maintenance job. */
export function pruneRateLimits(handle: Handle): number {
  return handle.run('DELETE FROM rate_limit_buckets WHERE window_start < ?',
    new Date(Date.now() - 86_400_000).toISOString()).changes;
}
