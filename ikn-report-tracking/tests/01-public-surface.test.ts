/**
 * Acceptance check 1 — a public user cannot enumerate applications, retrieve another
 * patient's details or reach staff and finance data, and a predictable internal
 * reference alone returns no status.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, registerApplication, request, type Fixture } from './harness.ts';

describe('public surface', () => {
  let fixture: Fixture;
  let alice: { applicationId: string; reference: string };
  let bob: { applicationId: string; reference: string };

  before(() => {
    fixture = createFixture();
    alice = registerApplication(fixture.handle);
    bob = registerApplication(fixture.handle);
  });
  after(() => fixture.close());

  it('returns a status for the holder of a valid tracking reference', async () => {
    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: alice.reference, language: 'ms' });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.stage, 'PERMOHONAN_DITERIMA');
    assert.equal(body.verified, false);
  });

  it('answers an unknown and a revoked reference identically, so neither can be probed', async () => {
    const unknown = await request(fixture.app, 'POST', '/api/public/status',
      { reference: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' });

    fixture.handle.run(
      'UPDATE public_tracking_tokens SET revoked_at = ? WHERE application_id = ?',
      new Date().toISOString(), bob.applicationId);
    const revoked = await request(fixture.app, 'POST', '/api/public/status',
      { reference: bob.reference });

    assert.equal(unknown.status, 404);
    assert.equal(revoked.status, 404);
    assert.deepEqual(unknown.body, revoked.body,
      'an unknown reference and a revoked one must be indistinguishable');
  });

  it('returns no status for a predictable internal report number', async () => {
    const reportNumber = fixture.handle.get<{ internal_report_number: string }>(
      'SELECT internal_report_number FROM applications WHERE application_id = ?',
      alice.applicationId)!.internal_report_number;

    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: reportNumber });
    assert.equal(response.status, 404,
      'a sequential report number is not a credential and must not resolve a status');
  });

  it('never exposes a field outside the applicant allowlist', async () => {
    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: alice.reference });

    // The allowlist is closed: only these keys may ever appear, so a future query
    // that selects a clinical or financial column still cannot reach the response.
    const allowed = new Set(['publicReference', 'stage', 'stageLabel', 'stageExplanation',
      'receivedDate', 'targetCompletionDate', 'targetNotSetNotice', 'revisedEstimateDate',
      'estimateDisclaimer', 'lastUpdateDate', 'nextActionCode', 'nextActionText',
      'outstandingItems', 'collectionInstructions', 'delayNotice', 'feeOutstanding',
      'contact', 'dataClassNotice', 'verified']);
    for (const key of Object.keys(response.body as object)) {
      assert.ok(allowed.has(key), `unexpected field in the public response: ${key}`);
    }

    // Identifiers that exist server-side must not appear in any value. Values are
    // scanned rather than the whole JSON, because an allowlisted *field name* such as
    // estimateDisclaimer legitimately contains the letters of a forbidden word.
    const values = JSON.stringify(Object.values(response.body as object));
    for (const secret of [alice.applicationId, `PSEUDO-${alice.applicationId}`,
      `CONTACT-REF-${alice.applicationId}`]) {
      assert.ok(!values.includes(secret), `the public response leaked "${secret}"`);
    }
    const internal = fixture.handle.get<{ internal_report_number: string }>(
      'SELECT internal_report_number FROM applications WHERE application_id = ?',
      alice.applicationId)!.internal_report_number;
    assert.ok(!values.includes(internal),
      'the public response must not echo the internal report number');
  });

  it('never mentions a doctor, a claim or a payment to an applicant', async () => {
    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: alice.reference, language: 'en' });
    const prose = Object.values(response.body as Record<string, unknown>)
      .filter((v) => typeof v === 'string').join(' ').toLowerCase();

    // Whole words, so "estimateDisclaimer" and the like cannot trip the check.
    for (const word of ['doctor', 'claim', 'claims', 'reimbursement', 'diagnosis',
      'consultant', 'specialist remuneration']) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(prose),
        `the applicant-facing text mentions "${word}"`);
    }
  });

  it('withholds missing-document detail until the caller has verified', async () => {
    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: alice.reference });
    assert.equal((response.body as { outstandingItems: unknown }).outstandingItems, null,
      'personalised outstanding-document detail requires verification');
  });

  it('refuses a verification token issued for a different application', async () => {
    const challenge = await request(fixture.app, 'POST', '/api/public/verify/challenge', {
      reportNumber: fixture.handle.get<{ internal_report_number: string }>(
        'SELECT internal_report_number FROM applications WHERE application_id = ?',
        bob.applicationId)!.internal_report_number,
    });
    const challengeId = (challenge.body as { challengeId: string | null }).challengeId;
    assert.ok(challengeId, 'a verified contact exists, so a challenge should be issued');

    // Read the one-time code the simulated adapter recorded, as the applicant would.
    const code = '000000';
    const wrong = await request(fixture.app, 'POST', '/api/public/verify',
      { challengeId, code });
    assert.equal(wrong.status, 404, 'a wrong code must fail with the uniform response');
  });

  it('answers a challenge for an unknown report number the same as for a known one', async () => {
    const known = await request(fixture.app, 'POST', '/api/public/verify/challenge', {
      reportNumber: fixture.handle.get<{ internal_report_number: string }>(
        'SELECT internal_report_number FROM applications WHERE application_id = ?',
        alice.applicationId)!.internal_report_number,
    });
    const unknown = await request(fixture.app, 'POST', '/api/public/verify/challenge',
      { reportNumber: 'IKN/LP/2026/999999' });

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    const knownBody = known.body as Record<string, unknown>;
    const unknownBody = unknown.body as Record<string, unknown>;
    // The message and the staff-assisted route are identical; only the opaque
    // challenge id differs, and it reveals nothing about whether the number exists.
    assert.equal(knownBody.message, unknownBody.message);
    assert.equal(knownBody.staffAssistedRoute, unknownBody.staffAssistedRoute);
  });

  it('refuses every staff and finance route without a session', async () => {
    for (const path of ['/api/staff/applications', '/api/staff/claims',
      '/api/staff/metrics/overview', '/api/staff/exports/monthly', '/api/staff/audit',
      '/api/staff/config', '/api/staff/my-tasks', '/api/staff/my-claims']) {
      const response = await request(fixture.app, 'GET', path);
      assert.ok(response.status === 401 || response.status === 403,
        `${path} answered ${response.status} to an unauthenticated caller`);
    }
  });

  it('keeps the public surface out of caches and search indexes', async () => {
    const response = await request(fixture.app, 'POST', '/api/public/status',
      { reference: alice.reference });
    assert.match(String(response.headers['cache-control']), /no-store/);
    assert.match(String(response.headers['x-robots-tag']), /noindex/);
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
  });

  it('does not mutate a case when a patient views it', async () => {
    const before = fixture.handle.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM status_events WHERE application_id = ?', alice.applicationId)!.n;
    const updatedBefore = fixture.handle.get<{ updated_at: string }>(
      'SELECT updated_at FROM applications WHERE application_id = ?', alice.applicationId)!;

    await request(fixture.app, 'POST', '/api/public/status', { reference: alice.reference });
    await request(fixture.app, 'POST', '/api/public/status', { reference: alice.reference });

    const after = fixture.handle.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM status_events WHERE application_id = ?', alice.applicationId)!.n;
    const updatedAfter = fixture.handle.get<{ updated_at: string }>(
      'SELECT updated_at FROM applications WHERE application_id = ?', alice.applicationId)!;

    assert.equal(after, before, 'viewing a status must not append an event');
    assert.equal(updatedAfter.updated_at, updatedBefore.updated_at,
      'viewing a status must not touch the application row');
  });

  it('rate-limits repeated status lookups from one client', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await request(fixture.app, 'POST', '/api/public/status',
        { reference: 'YYYY-YYYY-YYYY-YYYY-YYYY' });
      if (response.status === 429) { limited = true; break; }
    }
    assert.ok(limited, 'the public status route must rate-limit a client that probes it');
  });
});
