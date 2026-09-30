/**
 * Acceptance checks 2 and 3 — a complete application creates the correct service
 * deadline around weekends and holidays under the agreed starting-day convention,
 * and reassignment, revision and claim processing preserve the original deadline.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingDays, isWorkingDay, loadCalendar, workingDaysBetween,
  type CalendarVersion } from '../server/domain/calendar.ts';
import { computeDoctorDeadline, computeServiceDeadline, subtractWorkingDays } from '../server/domain/deadlines.ts';
import { slaRule } from '../server/domain/rules.ts';
import { applyEvent } from '../server/services/workflow.ts';
import { assessEligibility, submitClaim, applyFinanceAction } from '../server/services/claims.ts';
import { toBusinessDate } from '../server/domain/time.ts';
import { CALENDAR_VERSION, SLA_RULE_VERSION } from '../server/db/seed/reference.ts';
import * as grants from '../server/auth/permissions.ts';
import { createDoctor, createFixture, principalFor, registerApplication,
  type Fixture } from './harness.ts';

describe('deadline engine', () => {
  let fixture: Fixture;
  let calendar: CalendarVersion;

  before(() => {
    fixture = createFixture();
    calendar = loadCalendar(fixture.handle, CALENDAR_VERSION);
  });
  after(() => fixture.close());

  it('treats Saturday and Sunday as non-working', () => {
    assert.equal(isWorkingDay(calendar, '2026-01-03'), false, '3 Jan 2026 is a Saturday');
    assert.equal(isWorkingDay(calendar, '2026-01-04'), false, '4 Jan 2026 is a Sunday');
    assert.equal(isWorkingDay(calendar, '2026-01-05'), true, '5 Jan 2026 is a Monday');
  });

  it('treats a seeded federal holiday as non-working', () => {
    // 2026-05-01 is Labour Day and a Friday, so it is a working day but for the holiday.
    assert.equal(new Date('2026-05-01T00:00:00Z').getUTCDay(), 5);
    assert.equal(isWorkingDay(calendar, '2026-05-01'), false,
      'Labour Day must be excluded from the working calendar');
  });

  it('excludes the starting day under the seeded convention', () => {
    assert.equal(calendar.includeStartDay, false,
      'the seeded convention starts the clock the working day after completeness');
    // Completeness on Monday 5 January 2026 with a 1-day allowance is Tuesday the 6th.
    assert.equal(addWorkingDays(calendar, '2026-01-05', 1), '2026-01-06');
    // A 5-day allowance from that Monday lands on the following Monday, skipping the weekend.
    assert.equal(addWorkingDays(calendar, '2026-01-05', 5), '2026-01-12');
  });

  it('steps over a weekend that falls inside the allowance', () => {
    // Completeness on Thursday 8 January 2026, allowance 3: Fri, Mon, Tue.
    assert.equal(addWorkingDays(calendar, '2026-01-08', 3), '2026-01-13');
  });

  it('steps over a holiday that falls inside the allowance', () => {
    // Completeness Wednesday 29 April 2026, allowance 3: Thu 30, [Fri 1 May holiday], Mon 4, Tue 5.
    assert.equal(addWorkingDays(calendar, '2026-04-29', 3), '2026-05-05');
  });

  it('computes the 28 working-day service deadline from a complete application', () => {
    const sla = slaRule(fixture.handle, SLA_RULE_VERSION);
    assert.equal(sla.serviceWorkingDays, 28);
    const deadline = computeServiceDeadline(
      fixture.handle, sla, 'Specialist summary', '2026-01-05T01:00:00.000Z');
    assert.equal(deadline.allowanceSource, 'GENERAL');
    assert.equal(deadline.allowanceWorkingDays, 28);
    assert.equal(workingDaysBetween(calendar, deadline.startDate, deadline.dueDate), 28,
      'the due date must be exactly 28 working days from completeness under this convention');
    assert.equal(isWorkingDay(calendar, deadline.dueDate), true,
      'a deadline must land on a working day');
  });

  it('caps the doctor deadline so the review buffer still fits', () => {
    const sla = slaRule(fixture.handle, SLA_RULE_VERSION);
    const service = computeServiceDeadline(
      fixture.handle, sla, 'Specialist summary', '2026-01-05T01:00:00.000Z');

    // Assigned promptly: the allowance governs, and the buffer is not binding.
    const prompt = computeDoctorDeadline(
      fixture.handle, sla, '2026-01-06T02:00:00.000Z', service.dueDate);
    assert.equal(prompt.cappedByReviewBuffer, false);

    // Assigned late: the buffer pulls the doctor deadline back.
    const late = computeDoctorDeadline(
      fixture.handle, sla, '2026-02-02T02:00:00.000Z', service.dueDate);
    assert.equal(late.cappedByReviewBuffer, true);
    assert.equal(late.dueDate,
      subtractWorkingDays(calendar, service.dueDate, sla.reviewBufferDays),
      'the capped doctor deadline must leave exactly the review buffer');
    assert.ok(late.dueDate < service.dueDate,
      'the doctor deadline must never fall on or after the service deadline');
  });
});

describe('the original deadline survives everything that is not an authorised extension', () => {
  let fixture: Fixture;
  let applicationId: string;
  let originalDue: string;

  before(() => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
    createDoctor(fixture.handle, 'T-D2', 'Dr Two', 'DEPT-RTO');
    const records = principalFor(fixture.handle, 'records1');
    ({ applicationId } = registerApplication(fixture.handle,
      { receivedAt: '2026-01-05T01:00:00.000Z' }));

    const complete = applyEvent(fixture.handle, {
      applicationId, event: 'MARK_COMPLETE', actor: records,
      occurredAt: '2026-01-05T02:00:00.000Z',
      payload: { completeAt: '2026-01-05T02:00:00.000Z' },
    });
    originalDue = complete.originalServiceDueDate!;
    assert.ok(originalDue, 'completeness must set the original service deadline');
  });
  after(() => fixture.close());

  const dueNow = () => {
    const row = fixture.handle.get<{ original_service_due_at: string; revised_due_at: string | null }>(
      'SELECT original_service_due_at, revised_due_at FROM applications WHERE application_id = ?',
      applicationId)!;
    return {
      original: toBusinessDate(row.original_service_due_at),
      revised: row.revised_due_at ? toBusinessDate(row.revised_due_at) : null,
    };
  };

  it('is unchanged by assignment and reassignment', () => {
    const records = principalFor(fixture.handle, 'records1');
    applyEvent(fixture.handle, {
      applicationId, event: 'ASSIGN', actor: records,
      occurredAt: '2026-01-06T02:00:00.000Z', payload: { doctorId: 'T-D1' },
    });
    assert.equal(dueNow().original, originalDue);

    applyEvent(fixture.handle, {
      applicationId, event: 'REASSIGN', actor: records,
      occurredAt: '2026-01-20T02:00:00.000Z',
      payload: { doctorId: 'T-D2', reasonCode: 'DOCTOR_ON_LEAVE' },
    });
    assert.equal(dueNow().original, originalDue,
      'reassignment must not buy the hospital more time');
  });

  it('is unchanged by a return for correction', () => {
    const records = principalFor(fixture.handle, 'records1');
    const doctor = principalFor(fixture.handle, 't-d2');
    applyEvent(fixture.handle, { applicationId, event: 'ACKNOWLEDGE', actor: doctor });
    applyEvent(fixture.handle, { applicationId, event: 'SUBMIT_SIGNED', actor: doctor });
    applyEvent(fixture.handle, { applicationId, event: 'BEGIN_RECORDS_CHECK', actor: records });
    applyEvent(fixture.handle, {
      applicationId, event: 'RETURN_FOR_CORRECTION', actor: records,
      payload: { reasonCode: 'REVISION_REQUIRED' },
    });
    assert.equal(dueNow().original, originalDue,
      'internal rework must not extend the service deadline');
    assert.equal(dueNow().revised, null, 'rework must not create a revised deadline');
  });

  it('is unchanged by claim submission and finance processing', () => {
    const records = principalFor(fixture.handle, 'records1');
    const doctor = principalFor(fixture.handle, 't-d2');
    const finance1 = principalFor(fixture.handle, 'finance1');
    const finance2 = principalFor(fixture.handle, 'finance2');

    applyEvent(fixture.handle, { applicationId, event: 'SUBMIT_SIGNED', actor: doctor });
    applyEvent(fixture.handle, { applicationId, event: 'BEGIN_RECORDS_CHECK', actor: records });
    applyEvent(fixture.handle, { applicationId, event: 'ACCEPT_COMPLETION', actor: records });

    const { claimItemId } = assessEligibility(fixture.handle,
      { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 });
    submitClaim(fixture.handle, {
      claimItemIds: [claimItemId], actor: doctor, formReference: 'F-1',
      amountsSen: { [claimItemId]: 6000 },
    });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'FINANCE_RECEIVE', actor: finance1 });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'VERIFY_CLAIM', actor: finance1 });
    applyFinanceAction(fixture.handle, {
      claimItemId, action: 'APPROVE_CLAIM', actor: finance2, approvedAmountSen: 6000,
    });

    assert.equal(dueNow().original, originalDue,
      'claim activity must have no effect on the report deadline');
  });

  it('refuses to extend a report that has already been completed', () => {
    const director = principalFor(fixture.handle, 'director');
    // The application above is now READY_FOR_RELEASE. A deadline that has already
    // been met is not extendable — there is nothing left to give more time to.
    assert.throws(
      () => applyEvent(fixture.handle, {
        applicationId, event: 'GRANT_EXTENSION', actor: director,
        payload: { revisedDueDate: '2099-01-01', reason: 'too late' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_TRANSITION');
  });

  it('records an authorised extension on an open case without losing the original', () => {
    const records = principalFor(fixture.handle, 'records1');
    const director = principalFor(fixture.handle, 'director');
    const { applicationId: open } = registerApplication(fixture.handle,
      { receivedAt: '2026-02-02T01:00:00.000Z' });
    const complete = applyEvent(fixture.handle, {
      applicationId: open, event: 'MARK_COMPLETE', actor: records,
      payload: { completeAt: '2026-02-02T02:00:00.000Z' },
    });
    const openOriginal = complete.originalServiceDueDate!;
    const revised = addWorkingDays(
      loadCalendar(fixture.handle, CALENDAR_VERSION), openOriginal, 5);

    applyEvent(fixture.handle, {
      applicationId: open, event: 'GRANT_EXTENSION', actor: director,
      payload: { revisedDueDate: revised, reason: 'Records retrieval from an external hospital' },
    });

    const row = fixture.handle.get<{ original_service_due_at: string; revised_due_at: string }>(
      'SELECT original_service_due_at, revised_due_at FROM applications WHERE application_id = ?',
      open)!;
    assert.equal(toBusinessDate(row.original_service_due_at), openOriginal,
      'the original deadline must be preserved');
    assert.equal(toBusinessDate(row.revised_due_at), revised,
      'the revised deadline is recorded alongside it');

    const extension = fixture.handle.get<{ reason: string; approved_by: string }>(
      'SELECT reason, approved_by FROM deadline_extensions WHERE application_id = ?', open);
    assert.ok(extension, 'an extension must be recorded with its reason and approver');
    assert.equal(extension!.approved_by, director.userId);

    // And a revision that is not actually later is refused.
    assert.throws(
      () => applyEvent(fixture.handle, {
        applicationId: open, event: 'GRANT_EXTENSION', actor: director,
        payload: { revisedDueDate: openOriginal, reason: 'no' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'EXTENSION_NOT_LATER');
  });

  it('lets only an authorised manager grant an extension', () => {
    const records = principalFor(fixture.handle, 'records1');
    const { applicationId: open } = registerApplication(fixture.handle,
      { receivedAt: '2026-02-09T01:00:00.000Z' });
    applyEvent(fixture.handle, {
      applicationId: open, event: 'MARK_COMPLETE', actor: records,
      payload: { completeAt: '2026-02-09T02:00:00.000Z' },
    });
    // The workflow itself does not check permissions — the route does — so this
    // asserts the grant, which is what the route consults.
    const { scopeFor } = grants;
    assert.equal(scopeFor('records_officer', 'application.extension.grant'), undefined,
      'a Records officer must not be able to grant an extension');
    assert.equal(scopeFor('director', 'application.extension.grant'), 'ALL');
  });

  it('refuses completeness dated before receipt or in the future', () => {
    const records = principalFor(fixture.handle, 'records1');
    const { applicationId: other } = registerApplication(fixture.handle,
      { receivedAt: '2026-03-02T01:00:00.000Z' });

    assert.throws(
      () => applyEvent(fixture.handle, {
        applicationId: other, event: 'MARK_COMPLETE', actor: records,
        payload: { completeAt: '2026-03-01T01:00:00.000Z' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'COMPLETENESS_BEFORE_RECEIPT');

    assert.throws(
      () => applyEvent(fixture.handle, {
        applicationId: other, event: 'MARK_COMPLETE', actor: records,
        payload: { completeAt: '2099-01-01T00:00:00.000Z' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'FUTURE_COMPLETENESS');
  });

  it('keeps the true completeness time apart from the time staff recorded it', () => {
    const records = principalFor(fixture.handle, 'records1');
    const { applicationId: late } = registerApplication(fixture.handle,
      { receivedAt: '2026-03-02T01:00:00.000Z' });

    // Completeness genuinely happened a week before a clerk keyed it in.
    const trueTime = '2026-03-03T02:00:00.000Z';
    applyEvent(fixture.handle, {
      applicationId: late, event: 'MARK_COMPLETE', actor: records,
      payload: { completeAt: trueTime },
    });

    const row = fixture.handle.get<{ application_complete_at: string; completeness_recorded_at: string;
      original_service_due_at: string }>(
      `SELECT application_complete_at, completeness_recorded_at, original_service_due_at
       FROM applications WHERE application_id = ?`, late)!;

    assert.equal(row.application_complete_at, trueTime);
    assert.ok(row.completeness_recorded_at > trueTime,
      'the recording time must be stored separately and be later than the true time');

    const expected = computeServiceDeadline(fixture.handle,
      slaRule(fixture.handle, SLA_RULE_VERSION), 'Specialist summary', trueTime);
    assert.equal(toBusinessDate(row.original_service_due_at), expected.dueDate,
      'the clock must run from the true completeness date, not from the entry date');
  });
});
