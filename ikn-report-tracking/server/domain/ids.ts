import { randomBytes, randomUUID } from 'node:crypto';

/** Stable internal identifier for an entity. Opaque, never shown to applicants. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Sequential, human-quotable internal report number.
 *
 * Deliberately predictable, and deliberately **not** a credential: on its own it
 * returns no status from the public API (see `server/http/public-routes.ts`).
 */
export function formatInternalReportNumber(year: number, sequence: number): string {
  return `IKN/LP/${year}/${String(sequence).padStart(6, '0')}`;
}

/**
 * Public tracking reference: 160 bits of cryptographic randomness, comfortably
 * over the 128-bit floor in the brief, rendered in Crockford base32 without the
 * letters I, L, O and U so it can be read over the telephone without ambiguity.
 *
 * Only the HMAC of this value is stored. It is a bearer credential and is kept
 * out of logs, analytics, URLs and referrers — it travels in a POST body.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newPublicTrackingReference(): string {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  // 32 characters, grouped in fours for legibility on a printed receipt.
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

/** Normalises a reference typed by an applicant: case, spacing and separators. */
export function normaliseTrackingReference(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Six-digit one-time code for step-up verification. */
export function newOneTimeCode(): string {
  // Rejection-sampled so every code is equally likely.
  for (;;) {
    const n = randomBytes(3).readUIntBE(0, 3);
    if (n < 15_000_000) return String(n % 1_000_000).padStart(6, '0');
  }
}
