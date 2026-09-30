/**
 * Panel assembly: the layer the dashboard actually calls.
 *
 * Every panel returns its data, its two captions and an echo of the filter that
 * produced it, so a screenshot or an export is self-describing. Captions are
 * regenerated here on every request, which is what keeps them true when a filter
 * changes.
 */
import type { Handle } from '../db/database.ts';
import { loadCohort, type Cohort, type CohortFilter } from './cohort.ts';
import * as M from './metrics.ts';
import * as C from './captions.ts';
import { FORMULA_VERSION, METRIC_DICTIONARY } from './dictionary.ts';
import { buildForecast, backlogScenario } from './forecast.ts';
import { buildRecommendations, type RecommendationPanel } from './recommendations.ts';
import { configValue } from '../domain/rules.ts';
import { firstDayOfMonth, lastDayOfMonth, monthKey, monthRange, toBusinessDate,
  type Instant } from '../domain/time.ts';
import { ringgitString } from '../domain/money.ts';
import { settings } from '../config/settings.ts';
import type { Captions, DataClass } from '../../shared/domain.ts';
import type { FilterEcho, Panel } from '../../shared/metrics.ts';

export interface PanelRequest {
  /** The month in focus, `YYYY-MM`. Defaults to the cutoff's month. */
  month: string;
  /** Trailing window for trend, heatmap and scatter panels, in months. */
  trailingMonths: number;
  departmentIds?: readonly string[];
  reportTypes?: readonly string[];
  cutoff: Instant;
  /**
   * Scope predicate for the application cohort, from the authorisation layer.
   * Its column references must be valid in the cohort query (`a.`, `t.`).
   */
  scope?: { sql: string; params: (string | number)[] };
  /**
   * Scope predicate for claim-item queries, whose columns are `ci.`.
   *
   * Kept apart from `scope` because the two queries expose different tables, and
   * passing an application predicate to a claim query — or the reverse — is a
   * mistake SQL reports only at run time.
   */
  claimScope?: { sql: string; params: (string | number)[] };
  departmentLabel: string;
  policyClearance: string;
}

export interface PanelBundle {
  filter: FilterEcho;
  cohort: Cohort;
}

export function buildFilterEcho(
  handle: Handle, request: PanelRequest, cohort: Cohort, periodLabel: string,
): FilterEcho {
  return {
    periodLabel,
    departmentLabel: request.departmentLabel,
    reportTypeLabel: request.reportTypes && request.reportTypes.length > 0
      ? request.reportTypes.join(', ') : 'All report types',
    dataAsOf: request.cutoff,
    calendarVersion: cohort.calendar.calendarVersion,
    slaRuleVersion: cohort.sla.slaRuleVersion,
    formulaVersion: FORMULA_VERSION,
    dataClass: settings().dataClass,
  };
}

export function loadPanelCohort(handle: Handle, request: PanelRequest): Cohort {
  const from = firstDayOfMonth(monthRange(
    addMonthsSafe(request.month, -(request.trailingMonths - 1)), request.month)[0]!);
  const filter: CohortFilter = {
    from,
    to: lastDayOfMonth(request.month),
    cutoff: request.cutoff,
  };
  if (request.departmentIds && request.departmentIds.length > 0) {
    (filter as { departmentIds?: readonly string[] }).departmentIds = request.departmentIds;
  }
  if (request.reportTypes && request.reportTypes.length > 0) {
    (filter as { reportTypes?: readonly string[] }).reportTypes = request.reportTypes;
  }
  return loadCohort(handle, filter, request.scope);
}

function addMonthsSafe(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function context(request: PanelRequest, periodLabel: string): C.CaptionContext {
  return {
    periodLabel,
    departmentLabel: request.departmentLabel,
    dataClass: settings().dataClass as DataClass,
  };
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

function panel<T>(
  key: string, title: string, unitOfAnalysis: string, data: T, captions: Captions,
  filter: FilterEcho,
): Panel<T> {
  return { key, title, unitOfAnalysis, data, captions, filter };
}

// ------------------------------------------------------------------ Overview

export interface OverviewCards {
  page1: {
    received: ReturnType<typeof M.received>;
    completed: ReturnType<typeof M.completed>;
    openBacklog: ReturnType<typeof M.openBacklog>;
    overdueOpen: ReturnType<typeof M.overdueOpen>;
  };
  page2: {
    dueCohortOnTime: ReturnType<typeof M.dueCohortOnTimeRate>;
    turnaround: ReturnType<typeof M.turnaroundDistribution>;
    eligibleUnclaimed: ReturnType<typeof M.claimAggregates>['eligibleUnclaimed'];
    approvedUnpaid: ReturnType<typeof M.claimAggregates>['approvedUnpaid'];
  };
  /** Each card carries its own captions, because each is its own analytical output. */
  captions: Record<string, Captions>;
}

export function overviewPanels(handle: Handle, request: PanelRequest) {
  const cohort = loadPanelCohort(handle, request);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const ctx = context(request, label);

  const receivedM = M.received(cohort, request.month);
  const completedM = M.completed(cohort, request.month);
  const openM = M.openBacklog(cohort);
  const overdueM = M.overdueOpen(cohort);
  const onTimeM = M.dueCohortOnTimeRate(cohort, request.month);
  const turnaroundM = M.turnaroundDistribution(cohort, request.month);
  const claims = M.claimAggregates(handle, request.cutoff, request.month, request.claimScope);

  const cards: OverviewCards = {
    page1: { received: receivedM, completed: completedM, openBacklog: openM, overdueOpen: overdueM },
    page2: {
      dueCohortOnTime: onTimeM, turnaround: turnaroundM,
      eligibleUnclaimed: claims.eligibleUnclaimed, approvedUnpaid: claims.approvedUnpaid,
    },
    captions: {
      received: C.countCaptions(ctx, receivedM,
        'How to read this: the number of applications registered in the selected month.'),
      completed: C.countCaptions(ctx, completedM,
        'How to read this: reports whose completion Records verified in the selected month. '
        + 'Collection is counted separately.'),
      openBacklog: C.countCaptions(ctx, openM,
        'How to read this: applications received by the cutoff that are neither completed nor '
        + 'cancelled.'),
      overdueOpen: C.countCaptions(ctx, overdueM,
        'How to read this: open applications whose original service deadline had already passed '
        + 'at the cutoff.'),
      dueCohortOnTime: C.rateCaptions(ctx, onTimeM,
        'How to read this: of the applications whose original deadline fell in the month, the '
        + 'share verified complete on or before it. Unfinished late applications are counted in '
        + 'the denominator.'),
      turnaround: C.distributionCaptions(ctx, turnaroundM,
        'How to read this: working days from a complete application to verified completion, for '
        + 'reports completed in the month. The median and the 90th percentile are shown because '
        + 'the distribution has a long tail.'),
      eligibleUnclaimed: C.countCaptions(ctx, claims.eligibleUnclaimed,
        'How to read this: claim items assessed eligible for which no doctor has submitted a '
        + 'claim form. Report release is not affected by this figure.'),
      approvedUnpaid: C.moneyCaptions(ctx, claims.approvedUnpaid,
        'How to read this: approved claim value with no reconciled payment evidence. An approval '
        + 'or a payment instruction is not settlement.'),
    },
  };

  const queueRatio = M.overdueShareOfQueue(cohort);
  return {
    cards: panel('overview.cards', 'Overview', 'applications and RM (labelled per card)',
      cards, cards.captions.received!, echo),
    queueHealth: panel('overview.queue_health', 'Queue health', 'applications',
      {
        ratio: queueRatio,
        overdueAgainstRevised: M.overdueAgainstRevised(cohort),
        incomplete: M.incompleteApplications(cohort),
        unassignedComplete: M.unassignedComplete(cohort),
        unacknowledged: M.unacknowledgedAssignments(cohort),
        integrationFreshness: integrationFreshness(handle),
      },
      C.ratioCaptions(ctx,
        queueRatio.applicable ? queueRatio.numerator : 0,
        queueRatio.applicable ? queueRatio.denominator : 0),
      echo),
    cohort,
    echo,
    ctx,
  };
}

/**
 * Integration freshness, stated plainly on the dashboard.
 *
 * A manual import is never described as a live integration, and the absence of a
 * connection is shown rather than left to be assumed.
 */
export function integrationFreshness(handle: Handle) {
  const batches = handle.all<{
    target_entity: string; imported_at: string; integration_mode: string;
    accepted_count: number; rejected_count: number; conflict_count: number;
  }>(`SELECT target_entity, imported_at, integration_mode, accepted_count, rejected_count,
             conflict_count FROM import_batches ORDER BY imported_at DESC LIMIT 5`);
  const failedNotifications = handle.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM notifications WHERE status = 'FAILED'");
  return {
    registration: {
      mode: 'MANUAL_ENTRY_AND_VALIDATED_IMPORT',
      connected: false,
      notice: 'Not connected to an existing registration system. Applications are entered by '
        + 'Records staff or loaded by validated spreadsheet import.',
    },
    finance: {
      mode: 'VALIDATED_IMPORT_AND_MANUAL_RECONCILIATION',
      connected: false,
      notice: 'Not connected to a finance system. Payments are recorded here after manual '
        + 'reconciliation; this system never initiates a bank transfer.',
    },
    messaging: {
      mode: settings().notifyProvider,
      connected: settings().notifyProvider !== 'SIMULATION',
      notice: settings().notifyProvider === 'SIMULATION'
        ? 'Messaging adapter is in simulation mode: notifications are logged and nothing is sent.'
        : 'Approved messaging gateway configured.',
      failedCount: failedNotifications?.n ?? 0,
    },
    recentImports: batches,
  };
}

// ------------------------------------------------------------------- Reports

export function reportsPanels(handle: Handle, request: PanelRequest, page: number, pageSize: number) {
  const cohort = loadPanelCohort(handle, request);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const ctx = context(request, label);

  const open = cohort.applications
    .filter((a) => a.isOpen)
    .sort((a, b) => b.overdueWorkingDays - a.overdueWorkingDays
      || (a.originalDueDate ?? '9999-12-31').localeCompare(b.originalDueDate ?? '9999-12-31'));
  const start = Math.max(0, (page - 1) * pageSize);
  const rows = open.slice(start, start + pageSize).map((a) => ({
    applicationId: a.applicationId,
    departmentId: a.departmentId,
    reportType: a.reportType,
    stage: a.internalStatus,
    currentOwner: currentOwner(a),
    workingDaysRemaining: a.workingDaysRemaining,
    workingDaysOverdue: a.overdueWorkingDays,
    originalDueDate: a.originalDueDate,
    revisedDueDate: a.revisedDueDate,
    delayReasonCode: a.delayReasonCode,
    nextAction: nextAction(a),
  }));

  const queue = M.queueComposition(cohort);
  return {
    worklist: panel('reports.worklist', 'Open report queue', 'applications',
      { rows, page, pageSize, totalRows: open.length,
        overdueInCohort: open.filter((a) => a.isOverdueOpen).length },
      C.worklistCaptions(ctx, open.length, rows.length,
        open.filter((a) => a.isOverdueOpen).length), echo),
    queueComposition: panel('reports.queue_composition', 'Queue composition by stage',
      'applications', queue, C.queueCaptions(ctx, queue), echo),
    exceptions: panel('reports.exceptions', 'Data-quality exceptions', 'applications',
      M.dataQualityExceptions(cohort),
      {
        howToRead: 'each row is a class of record the dashboard cannot measure correctly until '
          + 'somebody fixes it.',
        whatThisShows: describeExceptions(M.dataQualityExceptions(cohort), label),
        ...(settings().dataClass === 'SYNTHETIC'
          ? { dataClassNotice: 'Demonstration data — not actual IKN performance.' } : {}),
      }, echo),
  };
}

function currentOwner(a: { internalStatus: string; doctorId: string | null }): string {
  switch (a.internalStatus) {
    case 'AWAITING_DOCUMENTS': return 'Applicant';
    case 'RECEIVED': case 'COMPLETE_UNASSIGNED': return 'Records Unit';
    case 'ASSIGNED': case 'ACKNOWLEDGED': case 'IN_PREPARATION': return 'Assigned doctor';
    case 'SIGNED_SUBMITTED': case 'RECORDS_VERIFICATION': return 'Records Unit';
    case 'READY_FOR_RELEASE': return 'Applicant (collection)';
    default: return 'Records Unit';
  }
}

function nextAction(a: { internalStatus: string; taskAcknowledgedAt: string | null }): string {
  switch (a.internalStatus) {
    case 'RECEIVED': return 'Verify completeness';
    case 'AWAITING_DOCUMENTS': return 'Await applicant documents';
    case 'COMPLETE_UNASSIGNED': return 'Assign to a doctor';
    case 'ASSIGNED': return a.taskAcknowledgedAt ? 'Await preparation' : 'Chase acknowledgement';
    case 'ACKNOWLEDGED': case 'IN_PREPARATION': return 'Await signed report';
    case 'SIGNED_SUBMITTED': return 'Begin Records check';
    case 'RECORDS_VERIFICATION': return 'Accept or return the report';
    case 'READY_FOR_RELEASE': return 'Notify and release';
    default: return '—';
  }
}

function describeExceptions(
  exceptions: readonly { code: string; count: number; label: string }[], periodLabel: string,
): string {
  if (exceptions.length === 0) {
    return `No data-quality exceptions were found for the filters selected at ${periodLabel}.`;
  }
  const total = exceptions.reduce((s, e) => s + e.count, 0);
  const worst = exceptions.reduce((a, b) => (b.count > a.count ? b : a));
  return `${total} record${total === 1 ? '' : 's'} across ${exceptions.length} exception `
    + `class${exceptions.length === 1 ? '' : 'es'} need attention at ${periodLabel}; the largest `
    + `is "${worst.label}" with ${worst.count}.`;
}

// ------------------------------------------------------- Doctors/departments

export function departmentPanels(handle: Handle, request: PanelRequest) {
  const cohort = loadPanelCohort(handle, request);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const ctx = context(request, label);
  const rows = M.byDepartment(handle, cohort, request.month);
  return {
    overdue: panel('doctors.department_overdue', 'Overdue by department', 'applications',
      rows, C.departmentOverdueCaptions(ctx, rows), echo),
    onTime: panel('doctors.department_on_time', 'On-time rate by department', 'applications',
      rows, C.departmentOnTimeCaptions(ctx, rows), echo),
    doctorCompliance: panel('doctors.compliance', 'Doctor deadline compliance', 'doctor_tasks',
      M.doctorDeadlineCompliance(cohort, request.month),
      C.rateCaptions(ctx, M.doctorDeadlineCompliance(cohort, request.month),
        'How to read this: of the doctor tasks whose original doctor deadline fell in the month, '
        + 'the share accepted complete on or before it. The allowance measured against is a '
        + 'prototype value, not an IKN rule, and unfinished overdue tasks are counted as late.'),
      echo),
  };
}

// ------------------------------------------------------------------- Finance

export function financePanels(
  handle: Handle, request: PanelRequest, page: number, pageSize: number,
) {
  const cohort = loadPanelCohort(handle, request);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const ctx = context(request, label);
  const claims = M.claimAggregates(handle, request.cutoff, request.month, request.claimScope);
  const ageing = ageingTables(handle, request);

  return {
    pipeline: panel('finance.pipeline', 'Claim items by stage', 'claim_items',
      claims.byStage, C.claimStageCaptions(ctx, claims.byStage), echo),
    approvedUnpaidByDepartment: panel('finance.approved_unpaid_by_department',
      'Approved but unpaid by department', 'RM',
      claims.approvedUnpaidByDepartment.map((r) => ({ ...r, amountRm: ringgitString(r.amountSen) })),
      C.approvedUnpaidByDepartmentCaptions(ctx, claims.approvedUnpaidByDepartment), echo),
    submissionCoverage: panel('finance.submission_coverage', 'Claim submission coverage',
      'claim_items', claims.submissionCoverage,
      C.rateCaptions(ctx, claims.submissionCoverage,
        'How to read this: of the claim items that became eligible in the month, the share with a '
        + 'submitted claim form by the cutoff.'), echo),
    financeTurnaround: panel('finance.turnaround', 'Finance turnaround', 'claim_items',
      claims.financeTurnaround,
      C.distributionCaptions(ctx, claims.financeTurnaround,
        'How to read this: working days from a complete claim reaching Finance to reconciled '
        + 'settlement, for settled items only. No target is shown, because no finance processing '
        + 'allowance was supplied.'), echo),
    ageingUnclaimed: panel('finance.ageing_unclaimed', 'Eligible items with no claim submitted',
      'claim_items', paginate(ageing.unclaimed, page, pageSize),
      C.ageingTableCaptions(ctx, ageing.unclaimed, 'eligible items with no claim submitted',
        'the item became eligible',
        { pageRows: paginate(ageing.unclaimed, page, pageSize).rows.length,
          totalRows: ageing.unclaimed.length }), echo),
    ageingWithFinance: panel('finance.ageing_with_finance', 'Submitted items awaiting settlement',
      'claim_items', paginate(ageing.withFinance, page, pageSize),
      C.ageingTableCaptions(ctx, ageing.withFinance, 'submitted items awaiting settlement',
        'Finance received the claim',
        { pageRows: paginate(ageing.withFinance, page, pageSize).rows.length,
          totalRows: ageing.withFinance.length }), echo),
    ageingApprovedUnpaid: panel('finance.ageing_approved_unpaid', 'Approved items not yet paid',
      'claim_items', paginate(ageing.approvedUnpaid, page, pageSize),
      C.ageingTableCaptions(ctx, ageing.approvedUnpaid, 'approved items with no payment evidence',
        'the item was approved',
        { pageRows: paginate(ageing.approvedUnpaid, page, pageSize).rows.length,
          totalRows: ageing.approvedUnpaid.length }), echo),
    cohort,
  };
}

const AGEING_BUCKETS = [
  { key: '0_5', label: '0–5 working days', min: 0, max: 5 },
  { key: '6_10', label: '6–10 working days', min: 6, max: 10 },
  { key: '11_20', label: '11–20 working days', min: 11, max: 20 },
  { key: '21_40', label: '21–40 working days', min: 21, max: 40 },
  { key: 'over_40', label: 'Over 40 working days', min: 41, max: Number.POSITIVE_INFINITY },
] as const;

export interface AgeingRow {
  bucket: string;
  count: number;
  amountSen: number;
  amountRm: string;
  examples: string[];
  /** Who should act next on the cases in this band. */
  actionOwner: string;
}

export function ageingTables(handle: Handle, request: PanelRequest) {
  const scope = request.claimScope;
  const where = ['ci.created_at <= ?'];
  const params: (string | number)[] = [request.cutoff];
  if (scope) { where.push(scope.sql); params.push(...scope.params); }

  const rows = handle.all<{
    claim_item_id: string; status: string; eligible_at: string | null;
    finance_received_at: string | null; approved_at: string | null;
    claimed_amount_sen: number; approved_amount_sen: number | null; doctor_id: string;
  }>(`SELECT ci.claim_item_id, ci.status, ci.eligible_at, ci.finance_received_at, ci.approved_at,
             ci.claimed_amount_sen, ci.approved_amount_sen, ci.doctor_id
      FROM claim_items ci
      WHERE ${where.join(' AND ')} AND ci.eligibility_status = 'ELIGIBLE'`, ...params);

  const cutoffDate = toBusinessDate(request.cutoff);
  const age = (from: string) => weekdaysBetween(toBusinessDate(from), cutoffDate);

  const unclaimed = bucketise(
    rows.filter((r) => r.status === 'NOT_SUBMITTED' && r.eligible_at !== null)
      .map((r) => ({ id: r.claim_item_id, age: age(r.eligible_at!), sen: r.claimed_amount_sen })),
    'Assigned doctor — submit the claim form');

  const withFinance = bucketise(
    rows.filter((r) => r.finance_received_at !== null
      && ['UNDER_VERIFICATION', 'VERIFIED', 'RETURNED'].includes(r.status))
      .map((r) => ({ id: r.claim_item_id, age: age(r.finance_received_at!), sen: r.claimed_amount_sen })),
    'Finance officer — verify or return the claim');

  const approvedUnpaid = bucketise(
    rows.filter((r) => r.approved_at !== null
      && ['APPROVED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAYMENT_FAILED'].includes(r.status))
      .map((r) => ({
        id: r.claim_item_id, age: age(r.approved_at!),
        sen: r.approved_amount_sen ?? r.claimed_amount_sen,
      })),
    'Finance officer — obtain payment evidence and reconcile');

  return { unclaimed, withFinance, approvedUnpaid };
}

function bucketise(
  items: readonly { id: string; age: number; sen: number }[], actionOwner: string,
): AgeingRow[] {
  return AGEING_BUCKETS.map((b) => {
    const mine = items.filter((i) => i.age >= b.min && i.age <= b.max);
    const amountSen = mine.reduce((s, i) => s + i.sen, 0);
    return {
      bucket: b.label, count: mine.length, amountSen, amountRm: ringgitString(amountSen),
      examples: mine.slice(0, 3).map((i) => i.id), actionOwner,
    };
  });
}

function weekdaysBetween(from: string, to: string): number {
  let count = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

function paginate<T>(rows: readonly T[], page: number, pageSize: number) {
  const start = Math.max(0, (page - 1) * pageSize);
  return { rows: rows.slice(start, start + pageSize), page, pageSize, totalRows: rows.length };
}

// ------------------------------------------------------------------ Insights

export function insightsPanels(handle: Handle, request: PanelRequest) {
  const cohort = loadPanelCohort(handle, request);
  const months = monthRange(
    addMonthsSafe(request.month, -(request.trailingMonths - 1)), request.month);
  const periodLabel = months.length === 1
    ? monthLabel(request.month)
    : `${monthLabel(months[0]!)} – ${monthLabel(months[months.length - 1]!)}`;
  const echo = buildFilterEcho(handle, request, cohort, periodLabel);
  const ctx = context(request, periodLabel);
  const monthCtx = context(request, monthLabel(request.month));

  const trend = months.map((month) => ({
    month,
    received: M.received(cohort, month).value,
    completed: M.completed(cohort, month).value,
  }));
  const timeliness = months.map((month) => ({
    month, rate: M.dueCohortOnTimeRate(cohort, month),
  }));
  const completedHistogram = M.turnaroundHistogram(cohort, request.month);
  const ageingHistogram = M.openAgeingHistogram(cohort);
  const minSample = configValue<number>(handle, 'analytics.min_sample_size', 5);
  const scatter = M.workloadScatter(handle, cohort, months, minSample.value);
  const cells = M.heatmap(handle, cohort, months);

  return {
    kpis: panel('insights.kpis', 'KPI definitions and values', 'mixed (labelled per metric)',
      {
        dictionary: METRIC_DICTIONARY,
        formulaVersion: FORMULA_VERSION,
        values: {
          received: M.received(cohort, request.month),
          completed: M.completed(cohort, request.month),
          cancelled: M.cancelled(cohort, request.month),
          openBacklog: M.openBacklog(cohort),
          overdueOpen: M.overdueOpen(cohort),
          overdueAgainstRevised: M.overdueAgainstRevised(cohort),
          dueCohortOnTime: M.dueCohortOnTimeRate(cohort, request.month),
          completedCohortOnTime: M.completedCohortOnTimeRate(cohort, request.month),
          turnaround: M.turnaroundDistribution(cohort, request.month),
          doctorCompliance: M.doctorDeadlineCompliance(cohort, request.month),
          incomplete: M.incompleteApplications(cohort),
          followUp: M.followUpBurden(handle, request.month,
            M.received(cohort, request.month).value),
        },
        excludedCases: M.excludedCases(cohort, request.month),
        onTimeTargetPercent: cohort.sla.onTimeTargetPercent,
        targetProvenance: 'The 85% figure is the KKM Piagam Pelanggan reference for '
          + 'state and specialist hospitals. IKN’s own approved target, cohort and exclusions '
          + 'are unconfirmed, so no metric here is labelled an official KKM KPI.',
      },
      {
        howToRead: 'each metric shows its exact definition, its numerator and denominator, and '
          + 'the cases it excludes.',
        whatThisShows: `Values are for ${monthLabel(request.month)} under formula version `
          + `${FORMULA_VERSION}, SLA rule ${cohort.sla.slaRuleVersion} and calendar `
          + `${cohort.calendar.calendarVersion}.`,
        ...(settings().dataClass === 'SYNTHETIC'
          ? { dataClassNotice: 'Demonstration data — not actual IKN performance.' } : {}),
      }, echo),

    trend: panel('insights.trend', 'Monthly received and completed', 'applications',
      trend, C.trendCaptions(ctx, trend), echo),

    timeliness: panel('insights.timeliness', 'Due-cohort on-time rate by month', 'applications',
      { series: timeliness, targetPercent: cohort.sla.onTimeTargetPercent },
      C.timelinessCaptions(ctx, timeliness, cohort.sla.onTimeTargetPercent), echo),

    turnaround: panel('insights.turnaround', 'Completed-report turnaround', 'applications',
      completedHistogram,
      C.histogramCaptions(monthCtx, completedHistogram, 'completed reports',
        'How to read this: each bar counts completed reports whose turnaround fell in that band '
        + 'of working days, measured from a complete application to verified completion.'), echo),

    openAgeing: panel('insights.open_ageing', 'Open-report ageing', 'applications',
      ageingHistogram,
      // Ageing is a position at the cutoff, not a figure for a period, so this panel
      // uses a cutoff label rather than the trailing-window label.
      C.histogramCaptions(
        context(request, `the ${toBusinessDate(request.cutoff)} cutoff`),
        ageingHistogram, 'open reports with a recorded completeness date',
        'How to read this: each bar counts open reports by how many working days have passed '
        + 'since the application became complete, as at the cutoff. This is unfinished work, '
        + 'not turnaround. Open applications with no recorded completeness date have no '
        + 'measurable age and appear in the data-quality exceptions instead.'), echo),

    workload: panel('insights.workload', 'Workload and doctor-task turnaround',
      'department-months', { points: scatter, minSampleSize: minSample.value },
      C.scatterCaptions(ctx, scatter, minSample.value), echo),

    heatmap: panel('insights.heatmap', 'Late-or-unfinished rate by department and month',
      'applications', { cells, months }, C.heatmapCaptions(ctx, cells), echo),
  };
}

export function forecastPanel(handle: Handle, request: PanelRequest) {
  const cohort = loadPanelCohort(handle, request);
  const forecast = buildForecast(handle, request.cutoff, 3, request.scope);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const ctx = context(request, label);

  const howToRead = 'the solid line is observed monthly applications received; the projected '
    + 'line is the forecast, with the shaded bands showing the 80% and 95% prediction '
    + 'intervals. A partial month is excluded from fitting.';

  if (!forecast.available) {
    return panel('insights.forecast', 'Monthly application forecast', 'applications', forecast,
      {
        howToRead,
        whatThisShows: `${forecast.message} ${forecast.completeMonths} complete month`
          + `${forecast.completeMonths === 1 ? '' : 's'} of history are available and `
          + `${forecast.requiredMonths} are required, so no forecast is shown.`,
        ...(settings().dataClass === 'SYNTHETIC'
          ? { dataClassNotice: 'Demonstration data — not actual IKN performance.' } : {}),
      }, echo);
  }

  // The backlog scenario's capacity assumption comes from observed completions over
  // the trailing three complete months, not from a figure somebody wished for.
  const recentCompletions = forecast.history.slice(-3).map((h) => h.month)
    .map((month) => M.completed(cohort, month).value);
  const capacity = recentCompletions.length > 0
    ? Math.round(recentCompletions.reduce((a, b) => a + b, 0) / recentCompletions.length)
    : 0;
  const recentCancellations = forecast.history.slice(-3).map((h) => h.month)
    .map((month) => M.cancelled(cohort, month).value);
  const cancellations = recentCancellations.length > 0
    ? Math.round(recentCancellations.reduce((a, b) => a + b, 0) / recentCancellations.length)
    : 0;

  const scenario = backlogScenario(
    M.openBacklog(cohort).value,
    forecast.points.map((p) => ({ month: p.month, arrivals: Math.round(p.point) })),
    capacity, cancellations);

  const first = forecast.points[0]!;
  const validation = forecast.selectedModel === 'ETS_A_Ad_N'
    ? forecast.validation.ets : forecast.validation.baseline;

  return panel('insights.forecast', 'Monthly application forecast', 'applications',
    { forecast, scenario },
    {
      howToRead,
      whatThisShows: `Fitted on ${forecast.history.length} complete months `
        + `(${forecast.trainingFrom} to ${forecast.trainingTo}) and generated at `
        + `${forecast.forecastGeneratedAt}. The model shown is `
        + `${forecast.selectedModel === 'ETS_A_Ad_N' ? 'ETS(A,Ad,N)' : `the trailing ${3}-month mean`}`
        + `, with a backtest MAE of ${validation.mae.toFixed(2)} applications`
        + `${validation.wape === null ? ' (WAPE not reported: total actual volume was zero)'
          : ` and WAPE of ${validation.wape.toFixed(1)}%`} over the last `
        + `${validation.origins.length} complete months. ${first.month} is projected at `
        + `${Math.round(first.point)} applications, 80% interval `
        + `${Math.round(first.lower80)}–${Math.round(first.upper80)}.`,
      ...(settings().dataClass === 'SYNTHETIC'
        ? { dataClassNotice: 'Demonstration data — not actual IKN performance.' } : {}),
    }, echo);
}

export function actionsPanel(
  handle: Handle, request: PanelRequest,
): Panel<RecommendationPanel> {
  const cohort = loadPanelCohort(handle, request);
  const label = monthLabel(request.month);
  const echo = buildFilterEcho(handle, request, cohort, label);
  const claims = M.claimAggregates(handle, request.cutoff, request.month, request.claimScope);
  const exceptions = M.dataQualityExceptions(cohort);
  const recommendations = buildRecommendations({
    handle, cohort, claims, exceptions, clearance: request.policyClearance, asOf: request.cutoff,
  });

  const requirements = recommendations.recommendations
    .filter((r) => r.evidenceKind === 'POLICY_REQUIREMENT').length;
  return panel('insights.actions', 'Recommended actions', 'mixed', recommendations,
    {
      howToRead: 'each card states the indicator observed, the action recommended, who owns it '
        + 'and when to review it. A card is a policy requirement only when an approved policy '
        + 'passage is quoted on it; otherwise it is a management suggestion inferred from the '
        + 'data. Nothing here takes effect until a person accepts it.',
      whatThisShows: `${recommendations.recommendations.length} recommendation`
        + `${recommendations.recommendations.length === 1 ? '' : 's'} were generated for `
        + `${label} from ${cohort.applications.length} applications in scope; ${requirements} `
        + `${requirements === 1 ? 'is' : 'are'} supported by a quoted policy passage and `
        + `${recommendations.recommendations.length - requirements} `
        + `${recommendations.recommendations.length - requirements === 1 ? 'is' : 'are'} `
        + 'management suggestions with no verified policy source.',
      ...(settings().dataClass === 'SYNTHETIC'
        ? { dataClassNotice: 'Demonstration data — not actual IKN performance.' } : {}),
    }, echo);
}
