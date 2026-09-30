/**
 * The metrics engine.
 *
 * Each function takes a loaded cohort and returns a typed metric. Three properties
 * are structural rather than remembered:
 *   - a zero denominator returns `applicable: false` with a message, so no caller
 *     can print 0% or 100% for "no eligible cases";
 *   - a missing completion date never counts as on time;
 *   - excluded and unclassifiable cases are counted and reported, not dropped.
 */
import type { Handle } from '../db/database.ts';
import type { Cohort, CohortApplication } from './cohort.ts';
import { netSettled } from '../services/claims.ts';
import { lastDayOfMonth, monthKey, toBusinessDate, type BusinessDate } from '../domain/time.ts';
import { NOT_APPLICABLE, QUEUE_BUCKETS, TURNAROUND_BINS } from '../../shared/domain.ts';
import type { CountMetric, DataQualityException, DistributionMetric, ExcludedCases,
  MoneyMetric, RateMetric } from '../../shared/metrics.ts';

// ------------------------------------------------------------------ counts

export function received(cohort: Cohort, month: string): CountMetric {
  return {
    kind: 'count', key: 'received', label: 'Received', unit: 'applications',
    value: cohort.applications.filter((a) => a.receivedMonth === month).length,
  };
}

export function completed(cohort: Cohort, month: string): CountMetric {
  return {
    kind: 'count', key: 'completed', label: 'Completed', unit: 'applications',
    value: cohort.applications.filter((a) => a.completionMonth === month).length,
  };
}

export function cancelled(cohort: Cohort, month: string): CountMetric {
  return {
    kind: 'count', key: 'cancelled', label: 'Cancelled', unit: 'applications',
    value: cohort.applications.filter(
      (a) => a.cancelledAt && monthKey(toBusinessDate(a.cancelledAt)) === month).length,
  };
}

export function openBacklog(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'open_backlog', label: 'Open at cutoff', unit: 'applications',
    value: cohort.applications.filter((a) => a.isOpen).length,
  };
}

export function overdueOpen(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'overdue_open', label: 'Overdue open', unit: 'applications',
    value: cohort.applications.filter((a) => a.isOverdueOpen).length,
  };
}

/**
 * Open applications past an **approved revised** deadline.
 *
 * Reported separately from `overdueOpen`, never blended into it: an extension the
 * hospital granted itself should not be able to improve the headline figure.
 */
export function overdueAgainstRevised(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'overdue_open_revised',
    label: 'Overdue against approved revised deadline', unit: 'applications',
    value: cohort.applications.filter(
      (a) => a.isOpen && a.revisedDueDate !== null && a.revisedDueDate < cohort.cutoffDate).length,
  };
}

export function unassignedComplete(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'unassigned_complete', label: 'Complete but unassigned',
    unit: 'applications',
    value: cohort.applications.filter(
      (a) => a.isOpen && a.completeAt !== null && a.taskId === null).length,
  };
}

export function unacknowledgedAssignments(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'unacknowledged_assignments', label: 'Assigned but not acknowledged',
    unit: 'doctor_tasks',
    value: cohort.applications.filter(
      (a) => a.isOpen && a.taskAssignedAt !== null && a.taskAcknowledgedAt === null).length,
  };
}

// -------------------------------------------------------------------- rates

/** Builds a rate, refusing to produce a percentage from a zero denominator. */
export function rate(
  key: string, label: string, numerator: number, denominator: number,
  partialPeriodNotice?: string,
): RateMetric {
  if (denominator === 0) {
    return { kind: 'rate', key, label, applicable: false, numerator: 0, denominator: 0,
      message: NOT_APPLICABLE };
  }
  const base: RateMetric = {
    kind: 'rate', key, label, applicable: true, numerator, denominator,
    percent: (numerator / denominator) * 100,
  };
  return partialPeriodNotice ? { ...base, partialPeriodNotice } : base;
}

export interface DueCohortOptions {
  /** Month whose original due dates define the cohort. */
  month: string;
  /** When true, only deadlines that have already elapsed are counted. */
  monthToDate: boolean;
}

/**
 * The due-cohort on-time rate: the KPI that cannot be flattered by leaving work
 * unfinished, because unfinished applications past their deadline sit in the
 * denominator and not the numerator.
 */
export function dueCohortOnTimeRate(cohort: Cohort, month: string): RateMetric {
  const monthEnd = lastDayOfMonth(month);
  const monthToDate = cohort.cutoffDate < monthEnd;

  const inCohort = cohort.applications.filter((a) => {
    if (!a.deadlineEligible || a.originalDueMonth !== month) return false;
    // Month-to-date: a deadline that has not yet arrived cannot be late, and
    // including it would drag the rate down for no reason.
    if (monthToDate && a.originalDueDate! > cohort.cutoffDate) return false;
    return true;
  });
  const onTime = inCohort.filter((a) => a.onTimeAgainstOriginal === true);

  return rate('due_cohort_on_time_rate', 'Due-cohort on-time rate',
    onTime.length, inCohort.length,
    monthToDate
      ? `Month-to-date: only deadlines falling on or before ${cohort.cutoffDate} are counted.`
      : undefined);
}

/**
 * The completed-cohort rate. Always labelled supplementary, because unfinished
 * cases are absent from the denominator.
 */
export function completedCohortOnTimeRate(cohort: Cohort, month: string): RateMetric {
  const completedThisMonth = cohort.applications.filter(
    (a) => a.completionMonth === month && a.deadlineEligible);
  const onTime = completedThisMonth.filter((a) => a.onTimeAgainstOriginal === true);
  return rate('completed_cohort_on_time_rate',
    'Completed-cohort on-time rate (supplementary)', onTime.length, completedThisMonth.length);
}

export function doctorDeadlineCompliance(cohort: Cohort, month: string): RateMetric {
  const monthEnd = lastDayOfMonth(month);
  const monthToDate = cohort.cutoffDate < monthEnd;
  const inCohort = cohort.applications.filter((a) => {
    if (a.isCancelled || a.doctorOriginalDueMonth !== month) return false;
    if (monthToDate && a.doctorOriginalDueDate! > cohort.cutoffDate) return false;
    return true;
  });
  const onTime = inCohort.filter((a) => a.doctorOnTime === true);
  return rate('doctor_deadline_compliance', 'Doctor deadline compliance',
    onTime.length, inCohort.length,
    monthToDate ? `Month-to-date as at ${cohort.cutoffDate}.` : undefined);
}

export function overdueShareOfQueue(cohort: Cohort): RateMetric {
  const open = cohort.applications.filter((a) => a.isOpen);
  const overdue = open.filter((a) => a.isOverdueOpen);
  return rate('overdue_share_of_queue', 'Overdue share of the open queue',
    overdue.length, open.length);
}

// ----------------------------------------------------------- distributions

export function turnaroundDistribution(cohort: Cohort, month?: string): DistributionMetric {
  const values = cohort.applications
    .filter((a) => (month ? a.completionMonth === month : a.completionDate !== null))
    .map((a) => a.turnaroundWorkingDays)
    .filter((v): v is number => v !== null)
    .sort((x, y) => x - y);

  if (values.length === 0) {
    return {
      kind: 'distribution', key: 'turnaround', label: 'Turnaround', unit: 'working days',
      applicable: false, sampleSize: 0, message: NOT_APPLICABLE,
    };
  }
  return {
    kind: 'distribution', key: 'turnaround', label: 'Turnaround', unit: 'working days',
    applicable: true, median: percentile(values, 50), p90: percentile(values, 90),
    sampleSize: values.length,
  };
}

/** Nearest-rank percentile. Deterministic, and no interpolation to argue about. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty sample');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export interface Histogram {
  bins: { key: string; label: string; count: number }[];
  total: number;
}

export function turnaroundHistogram(cohort: Cohort, month?: string): Histogram {
  const values = cohort.applications
    .filter((a) => (month ? a.completionMonth === month : a.completionDate !== null))
    .map((a) => a.turnaroundWorkingDays)
    .filter((v): v is number => v !== null);
  return bin(values);
}

export function openAgeingHistogram(cohort: Cohort): Histogram {
  const values = cohort.applications
    .filter((a) => a.isOpen)
    .map((a) => a.ageingWorkingDays)
    .filter((v): v is number => v !== null);
  return bin(values);
}

function bin(values: readonly number[]): Histogram {
  const bins = TURNAROUND_BINS.map((b) => ({
    key: b.key, label: b.label,
    count: values.filter((v) => v >= b.min && v <= b.max).length,
  }));
  return { bins, total: values.length };
}

// ------------------------------------------------------- queue composition

export interface QueueComposition {
  slices: { key: string; label: string; count: number; percent: number }[];
  total: number;
}

const QUEUE_LABELS: Record<string, string> = {
  AWAITING_APPLICANT: 'Awaiting applicant',
  AWAITING_ASSIGNMENT: 'Awaiting assignment',
  WITH_DOCTOR: 'With the doctor',
  AWAITING_RECORDS_CHECK: 'Awaiting Records check',
};

/**
 * Mutually exclusive stage buckets for the donut.
 *
 * Every open status belongs to exactly one bucket, so the slices sum to the open
 * total. At most five slices are shown; anything beyond that is grouped, which
 * cannot happen with the four buckets defined but is handled so a future bucket
 * does not quietly break the rule.
 */
export function queueComposition(cohort: Cohort, maxSlices = 5): QueueComposition {
  const open = cohort.applications.filter((a) => a.isOpen);
  const counted = QUEUE_BUCKETS.map((b) => ({
    key: b.key,
    label: QUEUE_LABELS[b.key] ?? b.key,
    count: open.filter((a) => (b.statuses as readonly string[]).includes(a.internalStatus)).length,
  })).filter((s) => s.count > 0).sort((x, y) => y.count - x.count);

  const kept: { key: string; label: string; count: number }[] =
    counted.slice(0, Math.max(1, maxSlices - 1));
  const rest = counted.slice(Math.max(1, maxSlices - 1));
  const slices = [...kept];
  if (rest.length > 0) {
    slices.push({
      key: 'OTHER_STAGES',
      label: `Other stages (${rest.length})`,
      count: rest.reduce((sum, s) => sum + s.count, 0),
    });
  }
  const total = open.length;
  return {
    slices: slices.map((s) => ({ ...s, percent: total === 0 ? 0 : (s.count / total) * 100 })),
    total,
  };
}

// ---------------------------------------------------------------- money

export interface ClaimAggregates {
  approvedUnpaid: MoneyMetric;
  eligibleUnclaimed: CountMetric;
  submittedOutstanding: CountMetric;
  byStage: { status: string; count: number }[];
  approvedUnpaidByDepartment: { departmentId: string; departmentName: string; amountSen: number }[];
  submissionCoverage: RateMetric;
  financeTurnaround: DistributionMetric;
}

interface ClaimRow extends Record<string, unknown> {
  claim_item_id: string; application_id: string; department_id: string; department_name: string;
  doctor_id: string; eligibility_status: string; eligible_at: string | null;
  submitted_at: string | null; finance_received_at: string | null; approved_at: string | null;
  status: string; claimed_amount_sen: number; approved_amount_sen: number | null;
}

/**
 * Claim and payment aggregates.
 *
 * The unit of analysis is the **claim item** throughout, and the money figures are
 * derived from `payment_allocations`, never from the claim status alone.
 */
export function claimAggregates(
  handle: Handle, cutoff: string, month: string,
  scope?: { sql: string; params: (string | number)[] },
): ClaimAggregates {
  const where = ['ci.created_at <= ?'];
  const params: (string | number)[] = [cutoff];
  if (scope) { where.push(scope.sql); params.push(...scope.params); }

  const rows = handle.all<ClaimRow>(
    `SELECT ci.claim_item_id, ci.application_id, ci.department_id, d.name AS department_name,
            ci.doctor_id, ci.eligibility_status, ci.eligible_at, ci.submitted_at,
            ci.finance_received_at, ci.approved_at, ci.status, ci.claimed_amount_sen,
            ci.approved_amount_sen
     FROM claim_items ci JOIN departments d ON d.department_id = ci.department_id
     WHERE ${where.join(' AND ')}`, ...params);

  const eligible = rows.filter((r) => r.eligibility_status === 'ELIGIBLE');

  // Approved-unpaid: approved amount less net reconciled settlement, per item.
  const inconsistencies: MoneyMetric['inconsistencies'] = [];
  let approvedUnpaidSen = 0;
  const byDepartment = new Map<string, { name: string; amountSen: number }>();

  for (const r of eligible) {
    if (r.approved_at === null || r.approved_amount_sen === null) continue;
    if (r.status === 'REJECTED' || r.status === 'WITHDRAWN') continue;
    const net = netSettled(handle, r.claim_item_id);
    const outstanding = r.approved_amount_sen - net;
    if (outstanding < 0) {
      // Over-settlement is surfaced, not hidden: a negative balance means the
      // payment records and the approval disagree and somebody must look.
      inconsistencies.push({
        claimItemId: r.claim_item_id,
        note: `Settled ${net} sen against an approved ${r.approved_amount_sen} sen — `
          + 'settlement exceeds approval.',
      });
    }
    if (outstanding !== 0) {
      approvedUnpaidSen += outstanding;
      const entry = byDepartment.get(r.department_id)
        ?? { name: r.department_name, amountSen: 0 };
      entry.amountSen += outstanding;
      byDepartment.set(r.department_id, entry);
    }
  }

  const eligibleUnclaimed = eligible.filter((r) => r.submitted_at === null
    && r.status === 'NOT_SUBMITTED');
  const submittedOutstanding = eligible.filter((r) => r.submitted_at !== null
    && !['PAID', 'REJECTED', 'WITHDRAWN', 'REVERSED'].includes(r.status));

  const stageOrder = ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_VERIFICATION', 'RETURNED', 'VERIFIED',
    'APPROVED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAID', 'PAYMENT_FAILED', 'REVERSED',
    'REJECTED', 'WITHDRAWN'];
  const byStage = stageOrder
    .map((status) => ({ status, count: eligible.filter((r) => r.status === status).length }))
    .filter((s) => s.count > 0);

  // Submission coverage over the items that became eligible in the selected month.
  const cohortItems = eligible.filter(
    (r) => r.eligible_at !== null && monthKey(toBusinessDate(r.eligible_at)) === month);
  const submittedInCohort = cohortItems.filter((r) => r.submitted_at !== null);

  // Finance turnaround over settled items only.
  const settledDurations: number[] = [];
  for (const r of eligible) {
    if (!r.finance_received_at) continue;
    const settlement = handle.get<{ reconciled_at: string }>(
      `SELECT MIN(reconciled_at) AS reconciled_at FROM payment_allocations
       WHERE claim_item_id = ? AND payment_status = 'RECONCILED'`, r.claim_item_id);
    if (!settlement?.reconciled_at) continue;
    settledDurations.push(workingDaysBetweenDates(
      toBusinessDate(r.finance_received_at), toBusinessDate(settlement.reconciled_at)));
  }
  settledDurations.sort((a, b) => a - b);

  return {
    approvedUnpaid: {
      kind: 'money', key: 'approved_unpaid_amount', label: 'Approved unpaid amount',
      valueSen: approvedUnpaidSen, inconsistencies,
    },
    eligibleUnclaimed: {
      kind: 'count', key: 'eligible_unclaimed', label: 'Eligible items with no claim submitted',
      unit: 'claim_items', value: eligibleUnclaimed.length,
    },
    submittedOutstanding: {
      kind: 'count', key: 'submitted_outstanding', label: 'Submitted items not yet settled',
      unit: 'claim_items', value: submittedOutstanding.length,
    },
    byStage,
    approvedUnpaidByDepartment: [...byDepartment.entries()]
      .map(([departmentId, v]) => ({ departmentId, departmentName: v.name, amountSen: v.amountSen }))
      .sort((a, b) => b.amountSen - a.amountSen),
    submissionCoverage: rate('claim_submission_coverage', 'Claim submission coverage',
      submittedInCohort.length, cohortItems.length),
    financeTurnaround: settledDurations.length === 0
      ? {
        kind: 'distribution', key: 'finance_turnaround', label: 'Finance turnaround',
        unit: 'working days', applicable: false, sampleSize: 0, message: NOT_APPLICABLE,
      }
      : {
        kind: 'distribution', key: 'finance_turnaround', label: 'Finance turnaround',
        unit: 'working days', applicable: true, median: percentile(settledDurations, 50),
        p90: percentile(settledDurations, 90), sampleSize: settledDurations.length,
      },
  };
}

/**
 * A calendar-independent working-day count for finance ageing.
 *
 * Finance turnaround is reported without a deadline, so the exact holiday set does
 * not change a judgement; a Mon–Fri count keeps it comparable across calendar
 * versions. Report deadlines never use this — they use the versioned calendar.
 */
function workingDaysBetweenDates(from: BusinessDate, to: BusinessDate): number {
  let count = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

// ------------------------------------------------- follow-up burden

export function followUpBurden(
  handle: Handle, month: string, receivedCount: number,
): { rate: RateMetric; enquiryCount: CountMetric } {
  const row = handle.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contact_enquiries
     WHERE enquiry_kind = 'STATUS_CHECK' AND occurred_at >= ? AND occurred_at < ?`,
    `${month}-01T00:00:00.000Z`, nextMonthStart(month));
  const enquiries = row?.n ?? 0;
  return {
    enquiryCount: {
      kind: 'count', key: 'status_enquiries', label: 'Logged status enquiries',
      unit: 'enquiries', value: enquiries,
    },
    // Expressed per 100 applications, so the numerator and denominator on the card
    // are the raw counts and the reader can see the scaling.
    rate: receivedCount === 0
      ? { kind: 'rate', key: 'follow_up_burden', label: 'Follow-up burden',
        applicable: false, numerator: 0, denominator: 0, message: NOT_APPLICABLE }
      : { kind: 'rate', key: 'follow_up_burden', label: 'Follow-up burden',
        applicable: true, numerator: enquiries, denominator: receivedCount,
        percent: (enquiries / receivedCount) * 100 },
  };
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01T00:00:00.000Z` : `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`;
}

// -------------------------------------------- data quality and exclusions

/**
 * Data-quality exceptions.
 *
 * These are reported rather than absorbed. A completed report with no completeness
 * date has no measurable turnaround and no deadline, so hiding it would quietly
 * improve every timeliness figure on the dashboard.
 */
export function dataQualityExceptions(cohort: Cohort): DataQualityException[] {
  const out: DataQualityException[] = [];

  const missingCompleteness = cohort.applications.filter(
    (a) => a.completionDate !== null && a.completeAt === null);
  if (missingCompleteness.length > 0) {
    out.push({
      code: 'MISSING_COMPLETENESS_DATE',
      label: 'Completed reports with no recorded completeness date — turnaround and deadline '
        + 'cannot be measured',
      count: missingCompleteness.length,
      examples: missingCompleteness.slice(0, 5).map((a) => a.applicationId),
    });
  }

  const lateRecording = cohort.applications.filter((a) => a.lateCompletenessRecording);
  if (lateRecording.length > 0) {
    out.push({
      code: 'LATE_COMPLETENESS_RECORDING',
      label: 'Completeness recorded at least one working day after it was achieved — the clock '
        + 'ran from the true date, not the entry date',
      count: lateRecording.length,
      examples: lateRecording.slice(0, 5).map((a) => a.applicationId),
    });
  }

  const noDeadline = cohort.applications.filter(
    (a) => a.isOpen && a.completeAt !== null && a.originalDueDate === null);
  if (noDeadline.length > 0) {
    out.push({
      code: 'COMPLETE_WITHOUT_DEADLINE',
      label: 'Complete applications with no service deadline recorded',
      count: noDeadline.length,
      examples: noDeadline.slice(0, 5).map((a) => a.applicationId),
    });
  }

  const unassigned = cohort.applications.filter(
    (a) => a.isOpen && a.completeAt !== null && a.taskId === null);
  if (unassigned.length > 0) {
    out.push({
      code: 'COMPLETE_UNASSIGNED',
      label: 'Complete applications with no doctor assigned',
      count: unassigned.length,
      examples: unassigned.slice(0, 5).map((a) => a.applicationId),
    });
  }

  const unacknowledged = cohort.applications.filter(
    (a) => a.isOpen && a.taskAssignedAt !== null && a.taskAcknowledgedAt === null);
  if (unacknowledged.length > 0) {
    out.push({
      code: 'ASSIGNMENT_UNACKNOWLEDGED',
      label: 'Assignments the doctor has not acknowledged',
      count: unacknowledged.length,
      examples: unacknowledged.slice(0, 5).map((a) => a.applicationId),
    });
  }

  const readyNotNotified = cohort.applications.filter(
    (a) => a.readyAt !== null && a.notifiedAt === null && a.collectedAt === null);
  if (readyNotNotified.length > 0) {
    out.push({
      code: 'READY_NOT_NOTIFIED',
      label: 'Reports ready for release with no applicant notification recorded',
      count: readyNotNotified.length,
      examples: readyNotNotified.slice(0, 5).map((a) => a.applicationId),
    });
  }

  return out;
}

/** Cases excluded from the timeliness denominators, with the reason for each. */
export function excludedCases(cohort: Cohort, month: string): ExcludedCases[] {
  const out: ExcludedCases[] = [];
  const cancelledInMonth = cohort.applications.filter(
    (a) => a.isCancelled && a.originalDueMonth === month);
  if (cancelledInMonth.length > 0) {
    out.push({
      code: 'CANCELLED',
      reason: 'Authorised cancellation — excluded from deadline denominators, still counted in '
        + 'received and cancelled.',
      count: cancelledInMonth.length,
    });
  }
  const noDeadline = cohort.applications.filter(
    (a) => !a.isCancelled && a.originalDueDate === null && a.receivedMonth === month);
  if (noDeadline.length > 0) {
    out.push({
      code: 'NO_DEADLINE_YET',
      reason: 'No service deadline, because completeness has not been recorded. Shown separately '
        + 'so registration delay cannot hide inside an improved KPI.',
      count: noDeadline.length,
    });
  }
  return out;
}

/** Incomplete applications, reported separately as the brief requires. */
export function incompleteApplications(cohort: Cohort): CountMetric {
  return {
    kind: 'count', key: 'incomplete_applications',
    label: 'Received but not yet complete', unit: 'applications',
    value: cohort.applications.filter((a) => a.isOpen && a.completeAt === null).length,
  };
}

// ------------------------------------------------- department breakdowns

export interface DepartmentRow {
  departmentId: string;
  departmentName: string;
  overdueOpen: number;
  open: number;
  onTime: RateMetric;
}

export function byDepartment(
  handle: Handle, cohort: Cohort, month: string,
): DepartmentRow[] {
  const names = new Map(handle.all<{ department_id: string; name: string }>(
    'SELECT department_id, name FROM departments').map((d) => [d.department_id, d.name]));

  const ids = [...new Set(cohort.applications.map((a) => a.departmentId))].sort();
  return ids.map((departmentId) => {
    const mine = cohort.applications.filter((a) => a.departmentId === departmentId);
    const inCohort = mine.filter((a) => a.deadlineEligible && a.originalDueMonth === month
      && a.originalDueDate! <= cohort.cutoffDate);
    const onTime = inCohort.filter((a) => a.onTimeAgainstOriginal === true);
    return {
      departmentId,
      departmentName: names.get(departmentId) ?? departmentId,
      overdueOpen: mine.filter((a) => a.isOverdueOpen).length,
      open: mine.filter((a) => a.isOpen).length,
      onTime: rate('department_on_time', 'On-time rate', onTime.length, inCohort.length),
    };
  });
}

export interface HeatmapCell {
  departmentId: string;
  departmentName: string;
  month: string;
  /** null means unavailable / not applicable — rendered grey, never as zero. */
  percent: number | null;
  numerator: number;
  denominator: number;
}

/**
 * Department × month late-or-unfinished rate.
 *
 * A cell with no eligible reports due that month is `percent: null`, which the
 * heatmap renders grey with its own legend entry. That is the difference between
 * "nothing was due" and "everything was on time", and conflating them would be the
 * easiest way to make this chart lie.
 */
export function heatmap(handle: Handle, cohort: Cohort, months: readonly string[]): HeatmapCell[] {
  const names = new Map(handle.all<{ department_id: string; name: string }>(
    'SELECT department_id, name FROM departments').map((d) => [d.department_id, d.name]));
  const departmentIds = [...new Set(cohort.applications.map((a) => a.departmentId))].sort();

  const cells: HeatmapCell[] = [];
  for (const departmentId of departmentIds) {
    for (const month of months) {
      const inCohort = cohort.applications.filter(
        (a) => a.departmentId === departmentId && a.deadlineEligible
          && a.originalDueMonth === month && a.originalDueDate! <= cohort.cutoffDate);
      const lateOrUnfinished = inCohort.filter((a) => a.onTimeAgainstOriginal !== true);
      cells.push({
        departmentId,
        departmentName: names.get(departmentId) ?? departmentId,
        month,
        percent: inCohort.length === 0 ? null : (lateOrUnfinished.length / inCohort.length) * 100,
        numerator: lateOrUnfinished.length,
        denominator: inCohort.length,
      });
    }
  }
  return cells;
}

export interface ScatterPoint {
  departmentId: string;
  departmentName: string;
  month: string;
  /** x: applications ASSIGNED during the month. */
  assignedInMonth: number;
  /** y: median doctor-task turnaround for tasks COMPLETED that month, or null if suppressed. */
  medianDoctorTurnaround: number | null;
  /** Point size: completed task count. */
  completedTasks: number;
  suppressed: boolean;
}

/**
 * One point per department-month for the workload scatter.
 *
 * The two cohorts are different sets of records — x counts assignments made in the
 * month, y summarises tasks completed in the month — and the panel says so.
 * Medians below `minSampleSize` are suppressed rather than published.
 */
export function workloadScatter(
  handle: Handle, cohort: Cohort, months: readonly string[], minSampleSize: number,
): ScatterPoint[] {
  const names = new Map(handle.all<{ department_id: string; name: string }>(
    'SELECT department_id, name FROM departments').map((d) => [d.department_id, d.name]));
  const departmentIds = [...new Set(cohort.applications.map((a) => a.departmentId))].sort();

  const points: ScatterPoint[] = [];
  for (const departmentId of departmentIds) {
    for (const month of months) {
      const mine = cohort.applications.filter((a) => a.departmentId === departmentId);
      const assignedInMonth = mine.filter(
        (a) => a.taskAssignedAt !== null
          && monthKey(toBusinessDate(a.taskAssignedAt)) === month).length;
      const completedTasks = mine.filter(
        (a) => a.doctorCompletedAt !== null
          && monthKey(toBusinessDate(a.doctorCompletedAt)) === month);
      const durations = completedTasks
        .map((a) => a.doctorTurnaroundWorkingDays)
        .filter((v): v is number => v !== null)
        .sort((x, y) => x - y);

      if (assignedInMonth === 0 && completedTasks.length === 0) continue;
      const suppressed = durations.length < minSampleSize;
      points.push({
        departmentId,
        departmentName: names.get(departmentId) ?? departmentId,
        month,
        assignedInMonth,
        medianDoctorTurnaround: suppressed ? null : percentile(durations, 50),
        completedTasks: completedTasks.length,
        suppressed,
      });
    }
  }
  return points;
}
