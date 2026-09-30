/**
 * Acceptance check 4 — a doctor sees only permitted assignments and their own
 * claims, and the API enforces the same restrictions as the interface.
 *
 * Also asserts the prohibitions `docs/03-permission-matrix.md` states as absolute,
 * so an edit that quietly widens the model fails the build rather than shipping.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORBIDDEN_BY_ROLE, GRANTS, PERMISSIONS, scopeFor,
  type Permission } from '../server/auth/permissions.ts';
import { ROLES } from '../../ikn-report-tracking/shared/domain.ts';
import { applyEvent } from '../server/services/workflow.ts';
import { assessEligibility, submitClaim } from '../server/services/claims.ts';
import { createDoctor, createFixture, principalFor, registerApplication, request, signIn,
  type Fixture } from './harness.ts';

describe('the permission model matches the documented matrix', () => {
  it('grants nothing by default: an unlisted permission is denied', () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        const granted = scopeFor(role, permission);
        if (granted === undefined) continue;
        assert.ok(Object.prototype.hasOwnProperty.call(GRANTS[role], permission),
          `${role} was granted ${permission} without an explicit entry`);
      }
    }
  });

  it('holds every prohibition the matrix states as absolute', () => {
    for (const [role, forbidden] of Object.entries(FORBIDDEN_BY_ROLE)) {
      for (const permission of forbidden as readonly Permission[]) {
        assert.equal(scopeFor(role as keyof typeof GRANTS, permission), undefined,
          `${role} must never hold ${permission}`);
      }
    }
  });

  it('gives the system administrator no patient, clinical or payment permission', () => {
    const admin = GRANTS.system_admin;
    for (const permission of Object.keys(admin)) {
      assert.ok(permission.startsWith('admin.') || permission === 'import.run',
        `system_admin unexpectedly holds ${permission}`);
    }
  });

  it('scopes every doctor permission to their own records', () => {
    for (const [permission, scope] of Object.entries(GRANTS.doctor)) {
      if (permission === 'policy.document.read') continue;   // reference material
      assert.equal(scope, 'OWN', `doctor permission ${permission} is scoped ${scope}, not OWN`);
    }
  });

  it('separates claim submission from claim approval', () => {
    assert.equal(scopeFor('doctor', 'claim.submit'), 'OWN');
    assert.equal(scopeFor('doctor', 'claim.approve'), undefined);
    assert.equal(scopeFor('finance_officer', 'claim.submit'), undefined);
    assert.equal(scopeFor('finance_officer', 'claim.approve'), 'NOT_OWN_SUBMISSION');
  });
});

describe('a doctor is confined to their own work over the API', () => {
  let fixture: Fixture;
  let mine: string;
  let theirs: string;
  let myClaimItem: string;

  before(async () => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-MINE', 'Dr Mine', 'DEPT-RTO');
    createDoctor(fixture.handle, 'T-THEIRS', 'Dr Theirs', 'DEPT-SUR');
    const records = principalFor(fixture.handle, 'records1');

    const setUp = (doctorId: string, departmentId: string) => {
      const { applicationId } = registerApplication(fixture.handle, { departmentId });
      applyEvent(fixture.handle, {
        applicationId, event: 'MARK_COMPLETE', actor: records,
        payload: { completeAt: new Date().toISOString() },
      });
      applyEvent(fixture.handle, {
        applicationId, event: 'ASSIGN', actor: records, payload: { doctorId },
      });
      return applicationId;
    };
    mine = setUp('T-MINE', 'DEPT-RTO');
    theirs = setUp('T-THEIRS', 'DEPT-SUR');

    // Complete my report so it carries an eligible claim item.
    const me = principalFor(fixture.handle, 't-mine');
    applyEvent(fixture.handle, { applicationId: mine, event: 'ACKNOWLEDGE', actor: me });
    applyEvent(fixture.handle, { applicationId: mine, event: 'SUBMIT_SIGNED', actor: me });
    applyEvent(fixture.handle, { applicationId: mine, event: 'BEGIN_RECORDS_CHECK', actor: records });
    applyEvent(fixture.handle, { applicationId: mine, event: 'ACCEPT_COMPLETION', actor: records });
    ({ claimItemId: myClaimItem } = assessEligibility(fixture.handle,
      { applicationId: mine, eligible: true, actor: records, claimedAmountSen: 6000 }));
  });
  after(() => fixture.close());

  it('lists only the doctor’s own tasks', async () => {
    const cookie = await signIn(fixture.app, 't-mine');
    const response = await request(fixture.app, 'GET', '/api/staff/my-tasks', undefined, cookie);
    assert.equal(response.status, 200);
    const tasks = (response.body as { tasks: { application_id: string }[] }).tasks;
    assert.ok(tasks.every((t) => t.application_id === mine),
      'a doctor must not see another doctor’s assignments');
  });

  it('refuses a doctor’s attempt to act on another doctor’s task', async () => {
    const cookie = await signIn(fixture.app, 't-mine');
    const response = await request(fixture.app, 'POST',
      `/api/staff/applications/${theirs}/events`, { event: 'ACKNOWLEDGE' }, cookie);
    assert.equal(response.status, 403,
      'the API must refuse the same thing the interface does not offer');
  });

  it('refuses a doctor’s attempt to read another doctor’s case', async () => {
    const cookie = await signIn(fixture.app, 't-mine');
    const response = await request(fixture.app, 'GET',
      `/api/staff/applications/${theirs}`, undefined, cookie);
    assert.equal(response.status, 403);
  });

  it('shows a doctor no patient fee even on their own case', async () => {
    const cookie = await signIn(fixture.app, 't-mine');
    const response = await request(fixture.app, 'GET',
      `/api/staff/applications/${mine}`, undefined, cookie);
    assert.equal(response.status, 200);
    const body = response.body as { fee: unknown; feeVisibilityNotice: string | null };
    assert.equal(body.fee, null, 'a patient fee is not doctor remuneration and is not shown');
    assert.ok(body.feeVisibilityNotice, 'the absence is explained rather than silent');
  });

  it('refuses a doctor the hospital metrics, finance panels and exports', async () => {
    const cookie = await signIn(fixture.app, 't-mine');
    for (const path of ['/api/staff/metrics/overview', '/api/staff/metrics/insights',
      '/api/staff/claims', '/api/staff/exports/monthly', '/api/staff/audit',
      '/api/staff/config', '/api/staff/metrics/forecast']) {
      const response = await request(fixture.app, 'GET', path, undefined, cookie);
      assert.equal(response.status, 403, `${path} was not refused to a doctor`);
    }
  });

  it('refuses a doctor’s attempt to submit another doctor’s claim', async () => {
    const theirsDoctor = principalFor(fixture.handle, 't-theirs');
    assert.throws(() => submitClaim(fixture.handle, {
      claimItemIds: [myClaimItem], actor: theirsDoctor, formReference: 'F-X',
      amountsSen: { [myClaimItem]: 6000 },
    }), (err: unknown) => (err as { code?: string }).code === 'FORBIDDEN');
  });

  it('confines a head of department to their own department', async () => {
    const cookie = await signIn(fixture.app, 'hod.rto');
    const inScope = await request(fixture.app, 'GET',
      `/api/staff/applications/${mine}`, undefined, cookie);
    const outOfScope = await request(fixture.app, 'GET',
      `/api/staff/applications/${theirs}`, undefined, cookie);
    assert.equal(inScope.status, 200, 'a head of department sees their own department');
    assert.equal(outOfScope.status, 403, 'and not another department');
  });

  it('refuses the system administrator any patient content', async () => {
    const cookie = await signIn(fixture.app, 'sysadmin');
    for (const path of [`/api/staff/applications/${mine}`, '/api/staff/applications',
      '/api/staff/claims', '/api/staff/metrics/overview']) {
      const response = await request(fixture.app, 'GET', path, undefined, cookie);
      assert.equal(response.status, 403, `${path} was not refused to the system administrator`);
    }
    // The administration routes it does hold still work.
    const config = await request(fixture.app, 'GET', '/api/staff/config', undefined, cookie);
    assert.equal(config.status, 200);
  });

  it('records every denial in the audit trail', () => {
    const denials = fixture.handle.all<{ action: string; permission: string | null }>(
      "SELECT action, permission FROM audit_events WHERE outcome = 'DENIED'");
    assert.ok(denials.length > 0, 'refusals must be audited, not only returned');
    assert.ok(denials.some((d) => d.action === 'AUTHORISE'),
      'an authorisation refusal must be recorded as such');
  });
});
