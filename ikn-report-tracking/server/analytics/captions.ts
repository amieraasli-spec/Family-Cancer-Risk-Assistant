/**
 * Caption generation.
 *
 * Every analytical output carries two captions, and both are computed from the
 * same validated aggregate that drew the marks:
 *
 *   How to read this  — a fixed sentence about axes, unit, colour or interpretation.
 *   What this shows   — the finding, computed from the filtered data, with the
 *                       timeframe and the relevant denominator.
 *
 * Nothing here is written by a language model and no positive finding is
 * hard-coded. The "what this shows" sentence is a template filled from numbers, so
 * when the filtered data says performance worsened, the caption says so. Ties are
 * resolved explicitly rather than by whichever row `sort` happened to put first.
 */
import { formatRinggit } from '../domain/money.ts';
import { NOT_APPLICABLE, type Captions } from '../../shared/domain.ts';
import { SYNTHETIC_NOTICE } from '../config/settings.ts';
import type { CountMetric, DistributionMetric, MoneyMetric, RateMetric } from '../../shared/metrics.ts';
import type { DepartmentRow, HeatmapCell, Histogram, QueueComposition, ScatterPoint } from './metrics.ts';

export const EMPTY_FINDING = 'No eligible records for the selected filters.';

export interface CaptionContext {
  /** Human-readable period, e.g. "September 2026" or "January 2024 – August 2026". */
  periodLabel: string;
  departmentLabel: string;
  dataClass: 'SYNTHETIC' | 'LIVE';
}

/**
 * Strips a leading label from a caption sentence.
 *
 * Callers write the sentence with or without "How to read this:" in front of it;
 * the label belongs to the renderer — the screen, the CSV header and the printed
 * PDF each add their own — so storing it here would double it up in the export.
 */
function stripLabel(text: string): string {
  return text.replace(/^\s*(How to read this|How this is calculated|What this shows)\s*:\s*/i, '');
}

function withNotice(ctx: CaptionContext, howToRead: string, whatThisShows: string): Captions {
  const captions: Captions = {
    howToRead: stripLabel(howToRead),
    whatThisShows: stripLabel(whatThisShows),
  };
  whatThisShows = captions.whatThisShows;
  if (ctx.dataClass === 'SYNTHETIC') {
    // The notice goes on the page and inside the finding caption, so a cropped
    // screenshot of one chart still carries it.
    captions.dataClassNotice = SYNTHETIC_NOTICE;
    captions.whatThisShows = `${whatThisShows} ${SYNTHETIC_NOTICE}`;
  }
  return captions;
}

export function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

// -------------------------------------------------------------- simple values

export function countCaptions(ctx: CaptionContext, metric: CountMetric, howToRead: string): Captions {
  return withNotice(ctx, howToRead,
    `${metric.label} for ${ctx.periodLabel}, ${ctx.departmentLabel}: `
    + `${metric.value.toLocaleString('en-MY')} ${metric.unit.replace(/_/g, ' ')}.`);
}

export function rateCaptions(ctx: CaptionContext, metric: RateMetric, howToRead: string): Captions {
  if (!metric.applicable) {
    return withNotice(ctx, howToRead,
      `${metric.label} for ${ctx.periodLabel}, ${ctx.departmentLabel}: ${NOT_APPLICABLE}.`);
  }
  const partial = metric.partialPeriodNotice ? ` ${metric.partialPeriodNotice}` : '';
  return withNotice(ctx, howToRead,
    `${metric.label} for ${ctx.periodLabel}, ${ctx.departmentLabel}: ${pct(metric.percent)} `
    + `(${metric.numerator} of ${metric.denominator}).${partial}`);
}

export function distributionCaptions(
  ctx: CaptionContext, metric: DistributionMetric, howToRead: string,
): Captions {
  if (!metric.applicable) {
    return withNotice(ctx, howToRead,
      `${metric.label} for ${ctx.periodLabel}, ${ctx.departmentLabel}: ${NOT_APPLICABLE}.`);
  }
  return withNotice(ctx, howToRead,
    `${metric.label} for ${ctx.periodLabel}, ${ctx.departmentLabel}: median ${metric.median} `
    + `${metric.unit}, P90 ${metric.p90} ${metric.unit}, from ${metric.sampleSize} `
    + `record${metric.sampleSize === 1 ? '' : 's'}.`);
}

export function moneyCaptions(ctx: CaptionContext, metric: MoneyMetric, howToRead: string): Captions {
  const inconsistent = metric.inconsistencies.length > 0
    ? ` ${metric.inconsistencies.length} item${metric.inconsistencies.length === 1 ? '' : 's'} `
      + 'show settlement exceeding approval and need investigation.'
    : '';
  return withNotice(ctx, howToRead,
    `${metric.label} as at ${ctx.periodLabel}, ${ctx.departmentLabel}: `
    + `${formatRinggit(metric.valueSen)}.${inconsistent}`);
}

// -------------------------------------------------------------------- charts

export function ratioCaptions(
  ctx: CaptionContext, overdue: number, open: number,
): Captions {
  const howToRead = 'How this is calculated: overdue open applications divided by all open '
    + 'applications, both counted at the same cutoff.';
  if (open === 0) {
    return withNotice(ctx, howToRead,
      `No applications were open at the ${ctx.periodLabel} cutoff for ${ctx.departmentLabel}, `
      + `so the overdue share is ${NOT_APPLICABLE.toLowerCase()}.`);
  }
  return withNotice(ctx, howToRead,
    `${overdue} of ${open} open applications were overdue at the ${ctx.periodLabel} cutoff for `
    + `${ctx.departmentLabel} — ${pct((overdue / open) * 100)} of the queue.`);
}

export function queueCaptions(ctx: CaptionContext, q: QueueComposition): Captions {
  const howToRead = 'How to read this: each slice is the number of open applications waiting at '
    + 'one stage; the stages are mutually exclusive, so the slices sum to the open total.';
  if (q.total === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const largest = pickLargest(q.slices, (s) => s.count, (s) => s.label);
  return withNotice(ctx, howToRead,
    `${largest.description} ${largest.value} of ${q.total} open applications at the `
    + `${ctx.periodLabel} cutoff for ${ctx.departmentLabel} `
    + `(${pct((largest.value / q.total) * 100)}).`);
}

export function trendCaptions(
  ctx: CaptionContext, series: readonly { month: string; received: number; completed: number }[],
): Captions {
  const howToRead = 'How to read this: both lines are counts of applications on the same axis — '
    + 'received in the month, and completed in the month. Timeliness is a separate chart, '
    + 'because a percentage does not belong on a count axis.';
  if (series.length === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const totalReceived = series.reduce((s, m) => s + m.received, 0);
  const totalCompleted = series.reduce((s, m) => s + m.completed, 0);
  const gap = totalReceived - totalCompleted;
  const direction = gap > 0
    ? `${gap} more applications were received than completed`
    : gap < 0
      ? `${-gap} more applications were completed than received`
      : 'received and completed counts were equal';
  return withNotice(ctx, howToRead,
    `Across ${ctx.periodLabel} for ${ctx.departmentLabel}, ${totalReceived} applications were `
    + `received and ${totalCompleted} were completed, so ${direction} over the period.`);
}

export function timelinessCaptions(
  ctx: CaptionContext,
  series: readonly { month: string; rate: RateMetric }[],
  targetPercent: number,
): Captions {
  const howToRead = `How to read this: the line is the due-cohort on-time percentage each `
    + `month and the dashed line is the configured ${targetPercent}% reference target. `
    + 'Months with no eligible cases are not plotted.';
  const plotted = series.filter((s) => s.rate.applicable);
  if (plotted.length === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const atOrAbove = plotted.filter(
    (s) => s.rate.applicable && s.rate.percent >= targetPercent).length;
  const last = plotted[plotted.length - 1]!;
  const lastPercent = last.rate.applicable ? last.rate.percent : 0;
  const lastParts = last.rate.applicable ? `${last.rate.numerator}/${last.rate.denominator}` : '';
  return withNotice(ctx, howToRead,
    `${atOrAbove} of ${plotted.length} months with eligible cases reached the ${targetPercent}% `
    + `reference for ${ctx.departmentLabel}; the most recent plotted month, ${last.month}, was `
    + `${pct(lastPercent)} (${lastParts}).`);
}

export function departmentOverdueCaptions(ctx: CaptionContext, rows: readonly DepartmentRow[]): Captions {
  const howToRead = 'How to read this: bar length is the number of open applications whose '
    + 'original deadline had already passed at the cutoff, by department.';
  const withAny = rows.filter((r) => r.overdueOpen > 0);
  if (withAny.length === 0) {
    return withNotice(ctx, howToRead,
      `No department had an overdue open application at the ${ctx.periodLabel} cutoff.`);
  }
  const top = pickLargest(rows, (r) => r.overdueOpen, (r) => r.departmentName);
  const total = rows.reduce((s, r) => s + r.overdueOpen, 0);
  return withNotice(ctx, howToRead,
    `${top.description} ${top.value} of ${total} overdue open applications at the `
    + `${ctx.periodLabel} cutoff.`);
}

export function departmentOnTimeCaptions(ctx: CaptionContext, rows: readonly DepartmentRow[]): Captions {
  const howToRead = 'How to read this: bar length is the on-time percentage for each '
    + 'department’s due cohort; the numerator and denominator are printed on each bar. '
    + 'Departments with no eligible cases are shown as not applicable.';
  const applicable = rows.filter((r) => r.onTime.applicable);
  if (applicable.length === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const lowest = pickSmallest(applicable,
    (r) => (r.onTime.applicable ? r.onTime.percent : 100), (r) => r.departmentName);
  const row = applicable.find((r) => r.departmentName === lowest.names[0]);
  const parts = row?.onTime.applicable ? `${row.onTime.numerator}/${row.onTime.denominator}` : '';
  return withNotice(ctx, howToRead,
    `${lowest.description} the lowest on-time rate in ${ctx.periodLabel} at `
    + `${pct(lowest.value)} (${parts}).`);
}

export function histogramCaptions(
  ctx: CaptionContext, histogram: Histogram, subject: string, howToRead: string,
): Captions {
  if (histogram.total === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const top = pickLargest(histogram.bins, (b) => b.count, (b) => b.label);
  const over = histogram.bins.find((b) => b.key === 'over_28')?.count ?? 0;
  return withNotice(ctx, howToRead,
    `Of ${histogram.total} ${subject} in ${ctx.periodLabel} for ${ctx.departmentLabel}, the `
    + `largest group fell in the ${top.names.join(' and ')} working-day band `
    + `(${top.value}); ${over} exceeded 28 working days `
    + `(${pct((over / histogram.total) * 100)}).`);
}

export function scatterCaptions(
  ctx: CaptionContext, points: readonly ScatterPoint[], minSampleSize: number,
): Captions {
  const howToRead = 'How to read this: each point is one department-month. The horizontal axis '
    + 'counts applications assigned during that month; the vertical axis is the median '
    + 'doctor-task turnaround for tasks completed in that month — a different set of '
    + 'records — and point size is the number of tasks completed. Association does not '
    + 'establish causation, and this panel is for capacity investigation, not for ranking '
    + 'doctors.';
  const plotted = points.filter((p) => p.medianDoctorTurnaround !== null);
  const suppressed = points.filter((p) => p.suppressed).length;
  if (plotted.length === 0) {
    return withNotice(ctx, howToRead,
      `${EMPTY_FINDING} ${suppressed} department-month${suppressed === 1 ? '' : 's'} had fewer `
      + `than ${minSampleSize} completed tasks, so no median is published.`);
  }
  const busiest = pickLargest(plotted, (p) => p.assignedInMonth,
    (p) => `${p.departmentName} in ${p.month}`);
  const slowest = pickLargest(plotted, (p) => p.medianDoctorTurnaround ?? 0,
    (p) => `${p.departmentName} in ${p.month}`);
  return withNotice(ctx, howToRead,
    `${plotted.length} department-months are plotted for ${ctx.periodLabel}. `
    + `${busiest.description} the most assignments (${busiest.value}); `
    + `${slowest.description} the highest median doctor-task turnaround `
    + `(${slowest.value} working days). ${suppressed} department-month`
    + `${suppressed === 1 ? '' : 's'} had fewer than ${minSampleSize} completed tasks and `
    + 'are shown without a median.');
}

export function heatmapCaptions(ctx: CaptionContext, cells: readonly HeatmapCell[]): Captions {
  const howToRead = 'How to read this: darker cells indicate a higher percentage of reports '
    + 'that missed their deadline, or are still unfinished, in each department and month. '
    + 'Grey means no eligible reports were due — not zero. Select a cell for its numerator '
    + 'and denominator.';
  const withData = cells.filter((c) => c.percent !== null);
  if (withData.length === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const worst = pickLargest(withData, (c) => c.percent ?? 0,
    (c) => `${c.departmentName} in ${c.month}`);
  const cell = withData.find((c) => `${c.departmentName} in ${c.month}` === worst.names[0])!;
  const greyCount = cells.length - withData.length;
  return withNotice(ctx, howToRead,
    `${worst.description} the highest late-or-unfinished rate over ${ctx.periodLabel}, at `
    + `${pct(worst.value)} (${cell.numerator}/${cell.denominator}). ${greyCount} of `
    + `${cells.length} cells had no eligible reports due and are shown grey.`);
}

export function claimStageCaptions(
  ctx: CaptionContext, stages: readonly { status: string; count: number }[],
): Captions {
  const howToRead = 'How to read this: bar length is the number of eligible claim items at each '
    + 'stage of the claim workflow at the cutoff. The unit is claim items, not applications, '
    + 'because one application can carry several eligible items.';
  const total = stages.reduce((s, x) => s + x.count, 0);
  if (total === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  const top = pickLargest(stages, (s) => s.count, (s) => humaniseStatus(s.status));
  const unsubmitted = stages.find((s) => s.status === 'NOT_SUBMITTED')?.count ?? 0;
  return withNotice(ctx, howToRead,
    `${top.description} the largest group at the ${ctx.periodLabel} cutoff, with ${top.value} `
    + `of ${total} eligible claim items; ${unsubmitted} eligible item`
    + `${unsubmitted === 1 ? ' has' : 's have'} no claim form submitted.`);
}

export function approvedUnpaidByDepartmentCaptions(
  ctx: CaptionContext, rows: readonly { departmentName: string; amountSen: number }[],
): Captions {
  const howToRead = 'How to read this: bar length is the approved claim amount that has no '
    + 'reconciled payment evidence, by department, in RM. Approval and a payment instruction '
    + 'are not settlement.';
  const total = rows.reduce((s, r) => s + r.amountSen, 0);
  if (rows.length === 0 || total === 0) {
    return withNotice(ctx, howToRead,
      `No approved claim amount was outstanding at the ${ctx.periodLabel} cutoff.`);
  }
  const top = pickLargest(rows, (r) => r.amountSen, (r) => r.departmentName);
  return withNotice(ctx, howToRead,
    `${top.description} the largest approved unpaid balance at the ${ctx.periodLabel} cutoff, `
    + `${formatRinggit(top.value)} of ${formatRinggit(total)} outstanding in total.`);
}

export function ageingTableCaptions(
  ctx: CaptionContext,
  rows: readonly { bucket: string; count: number; amountSen: number }[],
  subject: string, sinceField: string,
  pagination?: { pageRows: number; totalRows: number },
): Captions {
  const howToRead = `How to read this: each row groups ${subject} by how many working days have `
    + `passed since ${sinceField}. The oldest band is the one to act on first.`;
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return withNotice(ctx, howToRead, `No ${subject} were outstanding at the ${ctx.periodLabel} cutoff.`);
  }
  const oldest = [...rows].reverse().find((r) => r.count > 0)!;
  // A paginated table distinguishes the filtered cohort from the rows on screen.
  const page = pagination
    ? ` Showing ${pagination.pageRows} of ${pagination.totalRows} rows in the filtered cohort.`
    : '';
  return withNotice(ctx, howToRead,
    `${total} ${subject} were outstanding at the ${ctx.periodLabel} cutoff; the oldest band, `
    + `${oldest.bucket}, holds ${oldest.count} item${oldest.count === 1 ? '' : 's'} worth `
    + `${formatRinggit(oldest.amountSen)}.${page}`);
}

export function worklistCaptions(
  ctx: CaptionContext, totalRows: number, pageRows: number, overdueInCohort: number,
): Captions {
  const howToRead = 'How to read this: one row per open application, showing the current owner, '
    + 'the stage, and working days remaining or overdue against the original deadline.';
  if (totalRows === 0) return withNotice(ctx, howToRead, EMPTY_FINDING);
  return withNotice(ctx, howToRead,
    `${totalRows} open application${totalRows === 1 ? '' : 's'} match the selected filters for `
    + `${ctx.periodLabel}, of which ${overdueInCohort} `
    + `${overdueInCohort === 1 ? 'is' : 'are'} overdue. `
    + `Showing ${pageRows} row${pageRows === 1 ? '' : 's'} on this page.`);
}

// ------------------------------------------------------------ tie handling

interface Extreme<T> {
  value: number;
  names: string[];
  /** A sentence opener that names every tied member, so a tie is never hidden. */
  description: string;
}

/**
 * Finds the largest value and names **every** row that holds it.
 *
 * A caption that says "X had the highest rate" when X and Y are equal is wrong, and
 * it is wrong in the direction that gets somebody blamed. Ties are listed.
 */
export function pickLargest<T>(
  rows: readonly T[], value: (row: T) => number, name: (row: T) => string,
): Extreme<T> {
  return extreme(rows, value, name, 'highest', (a, b) => a > b);
}

export function pickSmallest<T>(
  rows: readonly T[], value: (row: T) => number, name: (row: T) => string,
): Extreme<T> {
  return extreme(rows, value, name, 'lowest', (a, b) => a < b);
}

function extreme<T>(
  rows: readonly T[], value: (row: T) => number, name: (row: T) => string,
  _direction: string, better: (a: number, b: number) => boolean,
): Extreme<T> {
  if (rows.length === 0) throw new Error('extreme of an empty set');
  let best = value(rows[0]!);
  for (const row of rows) if (better(value(row), best)) best = value(row);
  const names = rows.filter((r) => value(r) === best).map(name).sort();
  const joined = names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return {
    value: best,
    names,
    description: names.length === 1 ? `${joined} had` : `${joined} tied, each with`,
  };
}

function humaniseStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}
