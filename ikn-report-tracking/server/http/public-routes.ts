/**
 * The public status API — deliberately separate from the staff and finance APIs.
 *
 * Design rules this router enforces:
 *  - The tracking reference travels in a **POST body**, never in a URL. That keeps
 *    it out of access logs, browser history, `Referer` headers and analytics.
 *  - Every lookup failure returns one identical 404, so a caller cannot tell an
 *    unknown reference from a revoked one, and cannot enumerate.
 *  - A predictable internal report number alone returns **no status**. It only
 *    starts a one-time-code challenge to an already-verified contact.
 *  - The router reads through the read-only handle; it can write only to its own
 *    rate-limit and challenge tables.
 *  - Responses are built by the allowlist serialiser in `services/public-status.ts`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, readOnly } from '../db/database.ts';
import { hashSecret, secretMatchesHash } from '../auth/tokens.ts';
import { newOneTimeCode, newId, normaliseTrackingReference } from '../domain/ids.ts';
import { nowInstant } from '../domain/time.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { badRequest, publicLookupFailed, tooManyRequests } from './errors.ts';
import { clientHint, handler, publicReadHandle } from './context.ts';
import { consume, enforce, PUBLIC_LIMITS } from './rate-limit.ts';
import { buildPublicStatus, loadForPublic, outstandingItemsFor } from '../services/public-status.ts';
import type { Language } from '../../shared/public-text.ts';

const OTP_TTL_MS = 10 * 60 * 1000;

const languageSchema = z.enum(['ms', 'en']).default('ms');

const statusSchema = z.object({
  reference: z.string().min(8).max(64),
  language: languageSchema,
  /** Returned by `/verify` when a one-time code was cleared for this application. */
  verificationToken: z.string().max(200).optional(),
});

const challengeSchema = z.object({
  reportNumber: z.string().min(6).max(64),
  language: languageSchema,
});

const verifySchema = z.object({
  challengeId: z.string().min(8).max(80),
  code: z.string().regex(/^\d{6}$/),
  language: languageSchema,
});

export function publicRouter(): Router {
  const router = Router();

  // No caching, and no indexing, anywhere on the public API.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  /**
   * Status by public tracking reference.
   *
   * POST, not GET, so the reference never lands in a URL.
   */
  router.post('/status', handler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A tracking reference is required.');
    const { reference, language, verificationToken } = parsed.data;

    const hint = clientHint(req);
    enforce(db(), 'public.status', hint, PUBLIC_LIMITS.statusLookup);

    const normalised = normaliseTrackingReference(reference);
    const read = publicReadHandle();
    const token = read.get<{ application_id: string; revoked_at: string | null }>(
      'SELECT application_id, revoked_at FROM public_tracking_tokens WHERE token_hash = ?',
      hashSecret(normalised, 'tracking'));

    // One response for "no such reference" and for "revoked reference". The
    // distinction is exactly what an enumerator would want.
    if (!token || token.revoked_at) throw publicLookupFailed();

    const application = loadForPublic(read, token.application_id);
    if (!application) throw publicLookupFailed();

    // A verification token is scoped to one application; presenting one for a
    // different application grants nothing.
    const verified = verificationToken
      ? consumeVerification(verificationToken, token.application_id) : false;

    res.json(buildPublicStatus(read, application, {
      language: language as Language,
      presentedReference: normalised,
      verified,
      outstandingItems: verified
        ? outstandingItemsFor(read, token.application_id, language as Language) : undefined,
    }));
  }));

  /**
   * Step-up challenge for an applicant who has only the predictable internal
   * report number.
   *
   * This returns **no status**, by design: a report number plus a few identifier
   * digits is not strong verification. It sends a one-time code to a contact the
   * Records Unit has already verified, and it answers identically whether or not
   * the report number exists, so it cannot be used to enumerate.
   */
  router.post('/verify/challenge', handler(async (req, res) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A report number is required.');
    const { reportNumber, language } = parsed.data;

    const hint = clientHint(req);
    const perClient = consume(db(), 'public.otp.client', hint, PUBLIC_LIMITS.otpRequest);
    if (!perClient.allowed) throw tooManyRequests();

    const read = readOnly();
    const found = read.get<{ application_id: string; verified_contact_reference: string | null }>(
      `SELECT application_id, verified_contact_reference FROM applications
       WHERE internal_report_number = ?`, reportNumber.trim().toUpperCase());

    // The uniform response. An unknown report number, a known one with no verified
    // contact, and a known one with a contact all look the same from outside.
    const uniform = {
      challengeId: null as string | null,
      destinationMasked: null as string | null,
      // Present so the portal always has something honest to show.
      message: language === 'ms'
        ? 'Jika nombor laporan ini sah dan kami mempunyai maklumat hubungan yang telah '
          + 'disahkan, satu kod sekali guna akan dihantar. Jika anda tidak menerimanya, '
          + 'sila hadir ke kaunter Unit Rekod Perubatan untuk bantuan.'
        : 'If this report number is valid and we hold a previously verified contact for it, '
          + 'a one-time code has been sent. If you do not receive it, please attend the '
          + 'Medical Records Unit counter for assistance.',
      staffAssistedRoute: language === 'ms'
        ? 'Pemohon yang tidak dapat menerima kod boleh disahkan di kaunter oleh pegawai rekod.'
        : 'Applicants who cannot receive a code can be verified at the counter by a Records officer.',
    };

    if (!found?.verified_contact_reference) {
      // Still consumed a rate-limit unit above, so probing costs the same.
      appendAuditEvent(db(), {
        action: 'PUBLIC_OTP_CHALLENGE', outcome: 'DENIED', clientHint: hint,
        detail: { reason: found ? 'no_verified_contact' : 'unknown_report_number' },
      });
      res.json(uniform);
      return;
    }

    // Per-application throttle, so one report number cannot be used to flood a
    // patient's telephone from many clients.
    const perApplication = consume(
      db(), 'public.otp.application', found.application_id, PUBLIC_LIMITS.otpPerApplication);
    if (!perApplication.allowed) {
      appendAuditEvent(db(), {
        action: 'PUBLIC_OTP_CHALLENGE', outcome: 'DENIED', clientHint: hint,
        resourceType: 'APPLICATION', resourceId: found.application_id,
        detail: { reason: 'per_application_limit' },
      });
      res.json(uniform);
      return;
    }

    const challengeId = newId('otc');
    const code = newOneTimeCode();
    const masked = maskDestination(found.verified_contact_reference);
    db().run(
      `INSERT INTO otp_challenges (challenge_id, application_id, destination_hash,
         destination_masked, code_hash, issued_at, expires_at)
       VALUES (?,?,?,?,?,?,?)`,
      challengeId, found.application_id,
      hashSecret(found.verified_contact_reference, 'contact'), masked,
      hashSecret(code, 'otp'), nowInstant(), new Date(Date.now() + OTP_TTL_MS).toISOString());

    // The notification adapter is in simulation mode: the code is written to the
    // notification log and no network call is made, so no real person is messaged.
    db().run(
      `INSERT INTO notifications (notification_id, application_id, recipient_kind,
         recipient_reference, channel, template_key, body_preview, provider, simulated,
         status, attempt_count, dedupe_key, sent_at, created_at)
       VALUES (?,?,'APPLICANT',?,'SMS','OTP_CODE',?,'SIMULATION',1,'SENT',1,?,?,?)`,
      newId('ntf'), found.application_id, found.verified_contact_reference,
      'Kod sekali guna untuk semakan status laporan perubatan anda.',
      `OTP:${challengeId}`, nowInstant(), nowInstant());

    res.json({ ...uniform, challengeId, destinationMasked: masked });
  }));

  /** Exchanges a one-time code for a short-lived, application-scoped token. */
  router.post('/verify', handler(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A six-digit code is required.');
    const { challengeId, code } = parsed.data;

    const hint = clientHint(req);
    enforce(db(), 'public.otp.verify', hint, PUBLIC_LIMITS.otpVerify);

    const row = readOnly().get<{
      application_id: string; code_hash: string; attempts: number; max_attempts: number;
      expires_at: string; consumed_at: string | null;
    }>('SELECT * FROM otp_challenges WHERE challenge_id = ?', challengeId);

    if (!row || row.consumed_at || row.expires_at <= nowInstant()
      || row.attempts >= row.max_attempts) {
      throw publicLookupFailed();
    }

    db().run('UPDATE otp_challenges SET attempts = attempts + 1 WHERE challenge_id = ?', challengeId);
    if (!secretMatchesHash(code, 'otp', row.code_hash)) throw publicLookupFailed();

    db().run('UPDATE otp_challenges SET consumed_at = ? WHERE challenge_id = ?',
      nowInstant(), challengeId);
    appendAuditEvent(db(), {
      action: 'PUBLIC_OTP_VERIFY', outcome: 'ALLOWED', clientHint: hint,
      resourceType: 'APPLICATION', resourceId: row.application_id,
    });

    res.json({
      verificationToken: issueVerification(row.application_id),
      applicationScoped: true,
      expiresInSeconds: VERIFICATION_TTL_MS / 1000,
    });
  }));

  return router;
}

// ------------------------------------------------- short-lived verification token

const VERIFICATION_TTL_MS = 15 * 60 * 1000;
/**
 * In-process store for verification tokens.
 *
 * Kept out of the database on purpose: it holds nothing that must survive a
 * restart, and a restart invalidating it is the safe direction. A multi-instance
 * deployment replaces this with the shared session store named in
 * `docs/11-integration-notes.md`.
 */
const verifications = new Map<string, { applicationId: string; expiresAt: number }>();

function issueVerification(applicationId: string): string {
  const token = newId('vfy');
  verifications.set(token, { applicationId, expiresAt: Date.now() + VERIFICATION_TTL_MS });
  return token;
}

function consumeVerification(token: string, applicationId: string): boolean {
  const entry = verifications.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) { verifications.delete(token); return false; }
  // Scoped to one application: a token for case A never unlocks case B.
  return entry.applicationId === applicationId;
}

/** Shows enough of a destination to be recognisable, and no more. */
function maskDestination(reference: string): string {
  const tail = reference.slice(-3);
  return `••••••${tail}`;
}
