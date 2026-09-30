/**
 * Acceptance check 11 — imports and notification retries are idempotent, and
 * outages and failed notifications are visible to the responsible staff member.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent } from '../server/services/workflow.ts';
import { integrationFreshness } from '../server/analytics/panels.ts';
import { newId } from '../server/domain/ids.ts';
import { nowInstant } from '../server/domain/time.ts';
import { createDoctor, createFixture, principalFor, registerApplication, request, signIn,
  type Fixture } from './harness.ts';

describe('a retried request acts once', () => {
  let fixture: Fixture;
  let cookie: string;

  before(async () => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
    cookie = await signIn(fixture.app, 'records1');
  });
  after(() => fixture.close());

  const body = {
    applicantRole: 'PATIENT', protectedPatientReference: 'PSEUDO-IDEM',
    reportType: 'Specialist summary', requestPurpose: 'Insurance', departmentId: 'DEPT-RTO',
  };

  it('replays the stored response for a repeated registration', async () => {
    const key = `idem-${newId('k')}`;
    const first = await request(fixture.app, 'POST', '/api/staff/applications', body, cookie,
      { 'Idempotency-Key': key });
    const second = await request(fixture.app, 'POST', '/api/staff/applications', body, cookie,
      { 'Idempotency-Key': key });

    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body,
      'a retried registration must replay, not register a second application');

    const count = fixture.handle.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE protected_patient_reference = 'PSEUDO-IDEM'")!;
    assert.equal(count.n, 1, 'exactly one application exists after the retry');
  });

  it('creates a separate application when the key differs', async () => {
    await request(fixture.app, 'POST', '/api/staff/applications', body, cookie,
      { 'Idempotency-Key': `idem-${newId('k')}` });
    const count = fixture.handle.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE protected_patient_reference = 'PSEUDO-IDEM'")!;
    assert.equal(count.n, 2, 'a genuinely new intent carries a new key and is not suppressed');
  });

  it('refuses a key reused with a different body', async () => {
    const key = `idem-${newId('k')}`;
    await request(fixture.app, 'POST', '/api/staff/applications', body, cookie,
      { 'Idempotency-Key': key });
    const conflicting = await request(fixture.app, 'POST', '/api/staff/applications',
      { ...body, protectedPatientReference: 'PSEUDO-OTHER' }, cookie,
      { 'Idempotency-Key': key });

    assert.equal(conflicting.status, 409,
      'the same key with a different body is a client bug worth surfacing');
    assert.equal((conflicting.body as { error: { code: string } }).error.code,
      'IDEMPOTENCY_KEY_REUSED');
  });

  it('replays a repeated workflow event rather than applying it twice', async () => {
    const { applicationId } = registerApplication(fixture.handle);
    const key = `idem-${newId('k')}`;
    const payload = { event: 'MARK_COMPLETE' };

    const first = await request(fixture.app, 'POST',
      `/api/staff/applications/${applicationId}/events`, payload, cookie,
      { 'Idempotency-Key': key });
    const second = await request(fixture.app, 'POST',
      `/api/staff/applications/${applicationId}/events`, payload, cookie,
      { 'Idempotency-Key': key });

    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body);

    const events = fixture.handle.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM status_events
       WHERE application_id = ? AND event_type = 'MARK_COMPLETE'`, applicationId)!;
    assert.equal(events.n, 1, 'the event trail records the transition once');
  });

  it('rejects a genuine repeat that is not idempotent, rather than silently accepting it', () => {
    const records = principalFor(fixture.handle, 'records1');
    const { applicationId } = registerApplication(fixture.handle);
    applyEvent(fixture.handle, {
      applicationId, event: 'MARK_COMPLETE', actor: records,
      payload: { completeAt: new Date().toISOString() },
    });
    // No idempotency key, so this is a second genuine attempt; the state machine
    // refuses it because the application has already moved on.
    assert.throws(
      () => applyEvent(fixture.handle, {
        applicationId, event: 'MARK_COMPLETE', actor: records,
        payload: { completeAt: new Date().toISOString() },
      }),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_TRANSITION');
  });
});

describe('notification retries and outages are visible', () => {
  let fixture: Fixture;

  before(() => { fixture = createFixture(); });
  after(() => fixture.close());

  it('sends one notification however many times a job retries', () => {
    const { applicationId } = registerApplication(fixture.handle);
    const insert = () => fixture.handle.run(
      `INSERT OR IGNORE INTO notifications (notification_id, application_id, recipient_kind,
         recipient_reference, channel, template_key, body_preview, provider, simulated, status,
         attempt_count, dedupe_key, created_at)
       VALUES (?,?,'APPLICANT',?, 'SMS','REPORT_READY','Laporan sedia.','SIMULATION',1,'SENT',1,?,?)`,
      newId('ntf'), applicationId, `CONTACT-REF-${applicationId}`,
      `READY:${applicationId}`, nowInstant());

    insert(); insert(); insert();

    const count = fixture.handle.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE application_id = ?', applicationId)!;
    assert.equal(count.n, 1,
      'the dedupe key makes a retried reminder a no-op, so nobody is messaged three times');
  });

  it('surfaces failed deliveries rather than burying them in a log', async () => {
    const { applicationId } = registerApplication(fixture.handle);
    fixture.handle.run(
      `INSERT INTO notifications (notification_id, application_id, recipient_kind,
         recipient_reference, channel, template_key, body_preview, provider, simulated, status,
         failure_reason, attempt_count, dedupe_key, created_at)
       VALUES (?,?,'APPLICANT',?, 'SMS','REPORT_READY','Laporan sedia.','SIMULATION',1,'FAILED',
         'SIMULATED_DELIVERY_FAILURE',3,?,?)`,
      newId('ntf'), applicationId, `CONTACT-REF-${applicationId}`,
      `FAILED:${applicationId}`, nowInstant());

    const freshness = integrationFreshness(fixture.handle);
    assert.equal(freshness.messaging.failedCount, 1,
      'the count of failed notifications reaches the dashboard strip');

    const cookie = await signIn(fixture.app, 'sysadmin');
    const response = await request(fixture.app, 'GET', '/api/staff/notifications',
      undefined, cookie);
    assert.equal(response.status, 200);
    const body = response.body as { recentFailures: { failure_reason: string }[]; simulation: boolean };
    assert.equal(body.recentFailures.length, 1);
    assert.equal(body.recentFailures[0]!.failure_reason, 'SIMULATED_DELIVERY_FAILURE');
    assert.equal(body.simulation, true);
  });

  it('states plainly that nothing is connected, rather than implying integration', () => {
    const freshness = integrationFreshness(fixture.handle);
    assert.equal(freshness.registration.connected, false);
    assert.equal(freshness.finance.connected, false);
    assert.match(freshness.registration.notice, /Not connected/);
    assert.match(freshness.finance.notice, /never initiates a bank transfer/);
  });

  it('records a spreadsheet import as a manual reconciliation, not an interface', async () => {
    const cookie = await signIn(fixture.app, 'sysadmin');
    const response = await request(fixture.app, 'POST', '/api/staff/imports/dry-run', {
      targetEntity: 'APPLICATIONS', source: 'Records Unit spreadsheet',
      csv: 'application_id,report_type\nNEW-1,Ordinary report\nNEW-2,Ordinary report\n',
    }, cookie);

    assert.equal(response.status, 200);
    const body = response.body as { integrationMode: string; notice: string; accepted: number };
    assert.equal(body.integrationMode, 'MANUAL_IMPORT');
    assert.match(body.notice, /not a live integration/);
    assert.equal(body.accepted, 2);
  });

  it('blocks a duplicate claim item arriving by import, exactly as by submission', async () => {
    const fresh = createFixture();
    try {
      createDoctor(fresh.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
      const records = principalFor(fresh.handle, 'records1');
      const doctor = principalFor(fresh.handle, 't-d1');
      const { applicationId } = registerApplication(fresh.handle, { departmentId: 'DEPT-RTO' });
      applyEvent(fresh.handle, {
        applicationId, event: 'MARK_COMPLETE', actor: records,
        payload: { completeAt: nowInstant() },
      });
      applyEvent(fresh.handle, {
        applicationId, event: 'ASSIGN', actor: records, payload: { doctorId: 'T-D1' },
      });
      applyEvent(fresh.handle, { applicationId, event: 'ACKNOWLEDGE', actor: doctor });
      applyEvent(fresh.handle, { applicationId, event: 'SUBMIT_SIGNED', actor: doctor });
      applyEvent(fresh.handle, { applicationId, event: 'BEGIN_RECORDS_CHECK', actor: records });
      applyEvent(fresh.handle, { applicationId, event: 'ACCEPT_COMPLETION', actor: records });

      const { assessEligibility } = await import('../server/services/claims.ts');
      assessEligibility(fresh.handle,
        { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 });

      const cookie = await signIn(fresh.app, 'sysadmin');
      const response = await request(fresh.app, 'POST', '/api/staff/imports/dry-run', {
        targetEntity: 'CLAIM_ITEMS', source: 'Finance spreadsheet',
        csv: `application_id,claim_item_id\n${applicationId},IMPORTED-1\n`,
      }, cookie);

      const body = response.body as { outcomes: { outcome: string; message: string }[] };
      assert.equal(body.outcomes[0]!.outcome, 'DUPLICATE',
        'an import cannot create a second live claim for one eligible service');
      assert.match(body.outcomes[0]!.message, /already exists/);
    } finally { fresh.close(); }
  });
});
