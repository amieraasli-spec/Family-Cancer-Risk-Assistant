/**
 * Password hashing for the prototype's local accounts.
 *
 * Production should use IKN staff SSO where available (see
 * `docs/11-integration-notes.md`); these local accounts exist so the prototype is
 * runnable and so the permission matrix can be tested end to end. scrypt with a
 * per-user salt is used because it ships in Node's standard library and needs no
 * native build.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  return { hash: derive(password, salt), salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(derive(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  // Compare in constant time, and only when the lengths already match, so the
  // comparison itself leaks nothing about the stored hash.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(password: string, salt: string): string {
  return scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_COST).toString('hex');
}
