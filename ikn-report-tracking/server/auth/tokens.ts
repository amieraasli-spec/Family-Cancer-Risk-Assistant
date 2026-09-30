/**
 * Keyed hashing for bearer secrets: public tracking references, session ids and
 * one-time codes.
 *
 * A plain SHA-256 of a tracking reference would let anyone holding the database
 * grind candidate references offline. HMAC under a server-side pepper that never
 * enters the database means a stolen dump alone cannot resolve a reference back
 * to an application.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

let cachedPepper: string | undefined;

function pepper(): string {
  if (cachedPepper) return cachedPepper;
  const fromEnv = process.env.IKN_TOKEN_PEPPER;
  if (fromEnv && fromEnv.length >= 32 && fromEnv !== 'replace-me-with-64-hex-characters') {
    cachedPepper = fromEnv;
    return cachedPepper;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('IKN_TOKEN_PEPPER must be set to a 32+ character secret in production');
  }
  // Development convenience only: a per-process pepper. Restarting the process
  // invalidates previously issued references, which is the correct failure mode
  // for a missing secret — it never silently falls back to an unkeyed hash.
  cachedPepper = randomBytes(32).toString('hex');
  process.env.IKN_TOKEN_PEPPER = cachedPepper;
  return cachedPepper;
}

/** Overrides the pepper. Used by the seeder and by tests, never by a request path. */
export function setPepper(value: string): void {
  cachedPepper = value;
  process.env.IKN_TOKEN_PEPPER = value;
}

export function hashSecret(secret: string, domain: string): string {
  return createHmac('sha256', `${pepper()}:${domain}`).update(secret).digest('hex');
}

export function secretMatchesHash(secret: string, domain: string, expected: string): boolean {
  const a = Buffer.from(hashSecret(secret, domain), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}
