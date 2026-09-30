/**
 * The deadline engine: three clocks that are deliberately kept apart.
 *
 *  1. Patient journey   — first receipt → ready, and first receipt → actual
 *                         collection. Reported in **calendar** days, and it runs
 *                         even while the application is still incomplete, so a
 *                         long wait for documents cannot be hidden.
 *  2. Service deadline  — receipt of a **complete** application → the configured
 *                         completion endpoint, in **working** days.
 *  3. Doctor task       — assignment → completion accepted by Records, in working
 *                         days, capped so the review buffer still fits inside the
 *                         service deadline.
 *
 * Nothing in this module resets a service deadline. Reassignment, leave, returns
 * for correction, claim processing and internal rework all leave
 * `original_service_due_at` untouched; only an authorised extension writes a
 * `revised_due_at`, and it keeps the original alongside it.
 */
import type { Handle } from '../db/database.ts';
import { addWorkingDays, loadCalendar, workingDaysBetween, workingDaysUntil,
  type CalendarVersion } from './calendar.ts';
import { calendarDaysBetween, toBusinessDate, type BusinessDate, type Instant } from './time.ts';
import type { SlaRule } from './rules.ts';

export interface ServiceDeadline {
  /** The business date the clock started: the day completeness was achieved. */
  startDate: BusinessDate;
  /** Working-day allowance applied, after any report-type exception. */
  allowanceWorkingDays: number;
  /** Whether a report-type exception changed the general allowance. */
  allowanceSource: 'GENERAL' | 'REPORT_TYPE_EXCEPTION';
  dueDate: BusinessDate;
  calendarVersion: string;
  slaRuleVersion: string;
}

/**
 * The service deadline for a complete application.
 *
 * `completeAt` must be the instant completeness was genuinely achieved, not the
 * instant a clerk keyed it in. Passing the recording time here is how a late
 * registration would silently restart the clock, so callers pass
 * `application_complete_at` and the recording time is stored separately.
 */
export function computeServiceDeadline(
  handle: Handle, sla: SlaRule, reportType: string, completeAt: Instant,
): ServiceDeadline {
  const cal = loadCalendar(handle, sla.calendarVersion);
  const exception = sla.byReportType[reportType];
  const allowance = typeof exception === 'number' ? exception : sla.serviceWorkingDays;
  const startDate = toBusinessDate(completeAt);
  return {
    startDate,
    allowanceWorkingDays: allowance,
    allowanceSource: typeof exception === 'number' ? 'REPORT_TYPE_EXCEPTION' : 'GENERAL',
    dueDate: addWorkingDays(cal, startDate, allowance),
    calendarVersion: cal.calendarVersion,
    slaRuleVersion: sla.slaRuleVersion,
  };
}

export interface DoctorDeadline {
  startDate: BusinessDate;
  allowanceWorkingDays: number;
  dueDate: BusinessDate;
  /** True when the review buffer, not the allowance, set the due date. */
  cappedByReviewBuffer: boolean;
  reviewBufferDays: number;
  calendarVersion: string;
}

/**
 * The doctor task deadline.
 *
 * The allowance is an **internal IKN-approved allocation** — assumption #4,
 * UNVERIFIED and invented for the prototype. Whatever it is set to, the due date
 * is pulled back so that `review_buffer_days` working days remain before the
 * service deadline, because Records still has to check and release the report
 * inside the overall service commitment.
 */
export function computeDoctorDeadline(
  handle: Handle, sla: SlaRule, assignedAt: Instant, serviceDueDate: BusinessDate | null,
): DoctorDeadline {
  const cal = loadCalendar(handle, sla.calendarVersion);
  const startDate = toBusinessDate(assignedAt);
  const fromAllowance = addWorkingDays(cal, startDate, sla.doctorWorkingDays);

  if (!serviceDueDate) {
    return {
      startDate, allowanceWorkingDays: sla.doctorWorkingDays, dueDate: fromAllowance,
      cappedByReviewBuffer: false, reviewBufferDays: sla.reviewBufferDays,
      calendarVersion: cal.calendarVersion,
    };
  }

  const latestAllowed = subtractWorkingDays(cal, serviceDueDate, sla.reviewBufferDays);
  const capped = latestAllowed < fromAllowance;
  const dueDate = capped ? latestAllowed : fromAllowance;
  return {
    startDate,
    allowanceWorkingDays: workingDaysBetween(cal, startDate, dueDate),
    dueDate,
    cappedByReviewBuffer: capped,
    reviewBufferDays: sla.reviewBufferDays,
    calendarVersion: cal.calendarVersion,
  };
}

/** Walks back `n` working days from `date`, landing on a working day. */
export function subtractWorkingDays(
  cal: CalendarVersion, date: BusinessDate, n: number,
): BusinessDate {
  let cursor = date;
  let remaining = n;
  while (remaining > 0) {
    cursor = previousDay(cursor);
    if (isWorking(cal, cursor)) remaining -= 1;
  }
  while (!isWorking(cal, cursor)) cursor = previousDay(cursor);
  return cursor;
}

function previousDay(date: BusinessDate): BusinessDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function isWorking(cal: CalendarVersion, date: BusinessDate): boolean {
  if (cal.workingOverrides.has(date)) return true;
  if (cal.nonWorking.has(date)) return false;
  return !cal.weekendDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export interface DeadlinePosition {
  dueDate: BusinessDate | null;
  /** Positive: working days remaining. Negative: working days overdue. */
  workingDaysRemaining: number | null;
  workingDaysOverdue: number | null;
  state: 'NO_DEADLINE_YET' | 'ON_TRACK' | 'DUE_TODAY' | 'OVERDUE' | 'CLOSED';
}

/**
 * Where a case stands against a deadline as at `asOf`.
 *
 * `closedAt` is the endpoint that stops the clock. When it is present the
 * position is historical, so the answer is CLOSED and no "overdue" count is
 * implied for a case that finished, however late.
 */
export function deadlinePosition(
  handle: Handle, calendarVersion: string, dueDate: BusinessDate | null,
  asOf: BusinessDate, closedAt: Instant | null,
): DeadlinePosition {
  if (!dueDate) {
    return { dueDate: null, workingDaysRemaining: null, workingDaysOverdue: null, state: 'NO_DEADLINE_YET' };
  }
  if (closedAt) {
    return { dueDate, workingDaysRemaining: null, workingDaysOverdue: null, state: 'CLOSED' };
  }
  const cal = loadCalendar(handle, calendarVersion);
  const delta = workingDaysUntil(cal, asOf, dueDate);
  if (delta > 0) return { dueDate, workingDaysRemaining: delta, workingDaysOverdue: 0, state: 'ON_TRACK' };
  if (delta === 0) return { dueDate, workingDaysRemaining: 0, workingDaysOverdue: 0, state: 'DUE_TODAY' };
  return { dueDate, workingDaysRemaining: 0, workingDaysOverdue: -delta, state: 'OVERDUE' };
}

export interface PatientJourney {
  /** Calendar days from first receipt to ready for release. */
  receiptToReadyCalendarDays: number | null;
  /** Calendar days from first receipt to actual collection or delivery. */
  receiptToCollectionCalendarDays: number | null;
  /** Calendar days elapsed so far, shown even while the application is incomplete. */
  elapsedCalendarDays: number;
}

export function patientJourney(
  receivedAt: Instant, readyAt: Instant | null, collectedAt: Instant | null, asOf: Instant,
): PatientJourney {
  const received = toBusinessDate(receivedAt);
  return {
    receiptToReadyCalendarDays: readyAt ? calendarDaysBetween(received, toBusinessDate(readyAt)) : null,
    receiptToCollectionCalendarDays: collectedAt
      ? calendarDaysBetween(received, toBusinessDate(collectedAt)) : null,
    elapsedCalendarDays: calendarDaysBetween(received, toBusinessDate(asOf)),
  };
}

/**
 * Turnaround in working days: completeness → the configured completion endpoint.
 *
 * Returns `null` when either end is missing, which the metrics layer reports as a
 * data-quality exception rather than treating as on-time or as zero.
 */
export function turnaroundWorkingDays(
  handle: Handle, calendarVersion: string,
  completeAt: Instant | null, completedAt: Instant | null,
): number | null {
  if (!completeAt || !completedAt) return null;
  const cal = loadCalendar(handle, calendarVersion);
  return workingDaysBetween(cal, toBusinessDate(completeAt), toBusinessDate(completedAt));
}
