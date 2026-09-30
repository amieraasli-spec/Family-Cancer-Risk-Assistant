/**
 * Loads the working set once per request and derives every working-day figure in
 * one place, so no two panels can disagree about what "turnaround" means.
 *
 * Scale note: this loads the filtered applications into memory. At the prototype's
 * 1,000 applications that costs a few milliseconds. Working-day arithmetic cannot
 * be expressed in portable SQL, so for a multi-year production dataset the right
 * move is a nightly materialised table of derived working-day columns keyed by
 * calendar version — not a bigger query. `docs/11-integration-notes.md` says so.
 */
import type { Handle } from '../db/database.ts';
import { loadCalendar, workingDaysBetween, workingDaysUntil, type CalendarVersion } from '../domain/calendar.ts';
import { slaRule, type SlaRule } from '../domain/rules.ts';
import { monthKey, toBusinessDate, type BusinessDate, type Instant } from '../domain/time.ts';
import { OPEN_STATUSES, type InternalStatus } from '../../shared/domain.ts';

export interface CohortFilter {
  /** Inclusive lower bound on the business date of interest. */
  from?: BusinessDate;
  to?: BusinessDate;
  departmentIds?: readonly string[];
  reportTypes?: readonly string[];
  /** Everything is evaluated as at this instant. */
  cutoff: Instant;
}

export interface CohortApplication {
  applicationId: string;
  departmentId: string;
  reportType: string;
  internalStatus: InternalStatus;
  receivedAt: Instant;
  receivedDate: BusinessDate;
  receivedMonth: string;
  completeAt: Instant | null;
  completeDate: BusinessDate | null;
  completenessRecordedAt: Instant | null;
  /** True when staff recorded completeness materially later than it happened. */
  lateCompletenessRecording: boolean;
  originalDueDate: BusinessDate | null;
  originalDueMonth: string | null;
  revisedDueDate: BusinessDate | null;
  /** The configured KPI endpoint for this application's rule version. */
  completionEndpointAt: Instant | null;
  completionDate: BusinessDate | null;
  completionMonth: string | null;
  signedSubmittedAt: Instant | null;
  acceptedCompletedAt: Instant | null;
  readyAt: Instant | null;
  notifiedAt: Instant | null;
  collectedAt: Instant | null;
  cancelledAt: Instant | null;
  isCancelled: boolean;
  isOpen: boolean;
  /** Counts toward deadline measurement: not cancelled, and a deadline exists. */
  deadlineEligible: boolean;
  turnaroundWorkingDays: number | null;
  /** Working days overdue at the cutoff, for an open application. */
  overdueWorkingDays: number;
  isOverdueOpen: boolean;
  /** Working days remaining at the cutoff, for an open application. */
  workingDaysRemaining: number | null;
  ageingWorkingDays: number | null;
  doctorId: string | null;
  taskId: string | null;
  taskAssignedAt: Instant | null;
  taskAcknowledgedAt: Instant | null;
  doctorOriginalDueDate: BusinessDate | null;
  doctorOriginalDueMonth: string | null;
  doctorCompletedAt: Instant | null;
  doctorTurnaroundWorkingDays: number | null;
  doctorOnTime: boolean | null;
  reassignmentEvents: number;
  returnCount: number;
  delayReasonCode: string | null;
  feeStatus: string | null;
  slaRuleVersion: string;
  calendarVersion: string;
  onTimeAgainstOriginal: boolean | null;
}

export interface Cohort {
  applications: CohortApplication[];
  calendar: CalendarVersion;
  sla: SlaRule;
  cutoff: Instant;
  cutoffDate: BusinessDate;
  filter: CohortFilter;
}

interface RawRow extends Record<string, unknown> {
  application_id: string; department_id: string; report_type: string;
  internal_status: InternalStatus; received_at: string;
  application_complete_at: string | null; completeness_recorded_at: string | null;
  original_service_due_at: string | null; revised_due_at: string | null;
  cancelled_at: string | null; sla_rule_version: string;
  signed_submitted_at: string | null; accepted_completed_at: string | null;
  report_completed_at: string | null; ready_at: string | null; notified_at: string | null;
  collection_or_delivery_at: string | null;
  doctor_id: string | null; task_id: string | null; task_assigned_at: string | null;
  task_acknowledged_at: string | null; doctor_due_at: string | null;
  reassignment_events: number | null; return_count: number | null;
  delay_reason_code: string | null; fee_status: string | null;
}

/**
 * Loads the cohort.
 *
 * `extraPredicate` lets a caller add a scope filter from the authorisation layer;
 * it is a parameterised fragment, never interpolated text.
 */
export function loadCohort(
  handle: Handle, filter: CohortFilter,
  extraPredicate?: { sql: string; params: (string | number)[] },
): Cohort {
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];

  if (filter.departmentIds && filter.departmentIds.length > 0) {
    where.push(`a.department_id IN (${filter.departmentIds.map(() => '?').join(',')})`);
    params.push(...filter.departmentIds);
  }
  if (filter.reportTypes && filter.reportTypes.length > 0) {
    where.push(`a.report_type IN (${filter.reportTypes.map(() => '?').join(',')})`);
    params.push(...filter.reportTypes);
  }
  // Events after the cutoff are outside the snapshot entirely.
  where.push('a.received_at <= ?');
  params.push(filter.cutoff);
  if (extraPredicate) {
    where.push(extraPredicate.sql);
    params.push(...extraPredicate.params);
  }

  const rows = handle.all<RawRow>(
    `SELECT a.application_id, a.department_id, a.report_type, a.internal_status, a.received_at,
            a.application_complete_at, a.completeness_recorded_at, a.original_service_due_at,
            a.revised_due_at, a.cancelled_at, a.sla_rule_version,
            t.task_id AS task_id, t.doctor_id AS doctor_id, t.assigned_at AS task_assigned_at,
            t.acknowledged_at AS task_acknowledged_at, t.signed_submitted_at,
            t.accepted_completed_at, t.original_doctor_due_at AS doctor_due_at,
            t.reassignment_events, t.return_count, t.delay_reason_code,
            r.report_completed_at, r.ready_at, r.notified_at, r.collection_or_delivery_at,
            f.fee_status
     FROM applications a
     LEFT JOIN doctor_tasks t ON t.application_id = a.application_id AND t.active = 1
     LEFT JOIN releases r ON r.application_id = a.application_id
     LEFT JOIN patient_fees f ON f.application_id = a.application_id
     WHERE ${where.join(' AND ')}`, ...params);

  // Every application in the prototype shares one rule version; a production
  // dataset will not, so the calendar is resolved per row through this cache.
  const slaCache = new Map<string, SlaRule>();
  const calCache = new Map<string, CalendarVersion>();
  const resolve = (version: string) => {
    let rule = slaCache.get(version);
    if (!rule) { rule = slaRule(handle, version); slaCache.set(version, rule); }
    let cal = calCache.get(rule.calendarVersion);
    if (!cal) { cal = loadCalendar(handle, rule.calendarVersion); calCache.set(rule.calendarVersion, cal); }
    return { rule, cal };
  };

  const cutoffDate = toBusinessDate(filter.cutoff);
  const applications = rows.map((r) => buildApplication(r, resolve, filter, cutoffDate));

  const primary = resolve(rows[0]?.sla_rule_version ?? defaultRuleVersion(handle));
  return {
    applications, calendar: primary.cal, sla: primary.rule,
    cutoff: filter.cutoff, cutoffDate, filter,
  };
}

function defaultRuleVersion(handle: Handle): string {
  const r = handle.get<{ sla_rule_version: string }>(
    'SELECT sla_rule_version FROM sla_rules ORDER BY effective_from DESC LIMIT 1');
  if (!r) throw new Error('no SLA rule configured');
  return r.sla_rule_version;
}

function buildApplication(
  r: RawRow,
  resolve: (v: string) => { rule: SlaRule; cal: CalendarVersion },
  filter: CohortFilter,
  cutoffDate: BusinessDate,
): CohortApplication {
  const { rule, cal } = resolve(r.sla_rule_version);

  const endpointColumn: Record<SlaRule['completionEndpoint'], string | null> = {
    signed_submitted_at: r.signed_submitted_at,
    accepted_completed_at: r.accepted_completed_at,
    ready_at: r.ready_at,
    notified_at: r.notified_at,
    collection_or_delivery_at: r.collection_or_delivery_at,
  };
  // Only events at or before the cutoff exist in this snapshot.
  const atOrBefore = (v: string | null) => (v && v <= filter.cutoff ? v : null);

  const completionEndpointAt = atOrBefore(endpointColumn[rule.completionEndpoint]);
  const completeAt = atOrBefore(r.application_complete_at);
  const completeDate = completeAt ? toBusinessDate(completeAt) : null;
  const completionDate = completionEndpointAt ? toBusinessDate(completionEndpointAt) : null;
  const originalDueDate = r.original_service_due_at
    ? toBusinessDate(r.original_service_due_at) : null;
  const cancelledAt = atOrBefore(r.cancelled_at);

  const isCancelled = cancelledAt !== null;
  const isOpen = !isCancelled && completionEndpointAt === null
    && OPEN_STATUSES.includes(r.internal_status);

  // Deadline measurement excludes cancellations, and needs a deadline to exist.
  const deadlineEligible = !isCancelled && originalDueDate !== null;

  const turnaround = completeDate && completionDate
    ? workingDaysBetween(cal, completeDate, completionDate) : null;

  const overdueWorkingDays = isOpen && originalDueDate
    ? Math.max(0, -workingDaysUntil(cal, cutoffDate, originalDueDate)) : 0;
  const workingDaysRemaining = isOpen && originalDueDate
    ? Math.max(0, workingDaysUntil(cal, cutoffDate, originalDueDate)) : null;
  const ageing = isOpen && completeDate
    ? workingDaysBetween(cal, completeDate, cutoffDate) : null;

  const doctorDueDate = r.doctor_due_at ? toBusinessDate(r.doctor_due_at) : null;
  const doctorCompletedAt = atOrBefore(r.accepted_completed_at);
  const doctorTurnaround = r.task_assigned_at && doctorCompletedAt
    ? workingDaysBetween(cal, toBusinessDate(r.task_assigned_at), toBusinessDate(doctorCompletedAt))
    : null;
  const doctorOnTime = doctorDueDate === null
    ? null
    : (doctorCompletedAt ? toBusinessDate(doctorCompletedAt) <= doctorDueDate : false);

  // A missing completion date never counts as on time.
  const onTimeAgainstOriginal = !deadlineEligible
    ? null
    : (completionDate !== null && originalDueDate !== null && completionDate <= originalDueDate);

  const lateRecording = !!(completeAt && r.completeness_recorded_at
    && workingDaysBetween(cal, toBusinessDate(completeAt),
      toBusinessDate(r.completeness_recorded_at)) >= 1);

  return {
    applicationId: r.application_id,
    departmentId: r.department_id,
    reportType: r.report_type,
    internalStatus: r.internal_status,
    receivedAt: r.received_at,
    receivedDate: toBusinessDate(r.received_at),
    receivedMonth: monthKey(toBusinessDate(r.received_at)),
    completeAt,
    completeDate,
    completenessRecordedAt: r.completeness_recorded_at,
    lateCompletenessRecording: lateRecording,
    originalDueDate,
    originalDueMonth: originalDueDate ? monthKey(originalDueDate) : null,
    revisedDueDate: r.revised_due_at ? toBusinessDate(r.revised_due_at) : null,
    completionEndpointAt,
    completionDate,
    completionMonth: completionDate ? monthKey(completionDate) : null,
    signedSubmittedAt: atOrBefore(r.signed_submitted_at),
    acceptedCompletedAt: doctorCompletedAt,
    readyAt: atOrBefore(r.ready_at),
    notifiedAt: atOrBefore(r.notified_at),
    collectedAt: atOrBefore(r.collection_or_delivery_at),
    cancelledAt,
    isCancelled,
    isOpen,
    deadlineEligible,
    turnaroundWorkingDays: turnaround,
    overdueWorkingDays,
    isOverdueOpen: isOpen && overdueWorkingDays > 0,
    workingDaysRemaining,
    ageingWorkingDays: ageing,
    doctorId: r.doctor_id,
    taskId: r.task_id,
    taskAssignedAt: atOrBefore(r.task_assigned_at),
    taskAcknowledgedAt: atOrBefore(r.task_acknowledged_at),
    doctorOriginalDueDate: doctorDueDate,
    doctorOriginalDueMonth: doctorDueDate ? monthKey(doctorDueDate) : null,
    doctorCompletedAt,
    doctorTurnaroundWorkingDays: doctorTurnaround,
    doctorOnTime,
    reassignmentEvents: r.reassignment_events ?? 0,
    returnCount: r.return_count ?? 0,
    delayReasonCode: r.delay_reason_code,
    feeStatus: r.fee_status,
    slaRuleVersion: r.sla_rule_version,
    calendarVersion: rule.calendarVersion,
    onTimeAgainstOriginal,
  };
}
