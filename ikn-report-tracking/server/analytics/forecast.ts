/**
 * Monthly application-volume forecasting, and the backlog scenario that is
 * deliberately not a forecast.
 *
 * Guardrails, in the order they fire:
 *  1. fewer than 24 consecutive complete months of reliable history → withhold;
 *  2. a gap in the history → withhold, because a missing month is unknown, not zero;
 *  3. fit ETS(A,Ad,N) and the trailing three-month-mean baseline, backtest both over
 *     the most recent six complete months using only earlier data at each origin,
 *     and publish whichever performed better, naming the model actually used.
 */
import type { Handle } from '../db/database.ts';
import { addMonths, monthKey, monthRange, toBusinessDate, type Instant } from '../domain/time.ts';
import { fitEts, forecastEts, trailingMeanForecast, type EtsForecastPoint, type EtsParameters } from './ets.ts';

export const MINIMUM_MONTHS = 24;
export const BACKTEST_ORIGINS = 6;
export const BASELINE_WINDOW = 3;

export interface HistoryPoint {
  month: string;
  received: number;
}

export interface ValidationResult {
  model: 'ETS_A_Ad_N' | 'TRAILING_3_MONTH_MEAN';
  /** Mean absolute error, in applications. */
  mae: number;
  /** Weighted absolute percentage error, or null when total actual volume is zero. */
  wape: number | null;
  origins: { month: string; actual: number; predicted: number }[];
}

export type ForecastOutput =
  | {
    available: false;
    reason: 'INSUFFICIENT_HISTORY' | 'HISTORY_HAS_GAPS';
    message: string;
    completeMonths: number;
    requiredMonths: number;
    history: HistoryPoint[];
  }
  | {
    available: true;
    history: HistoryPoint[];
    trainingFrom: string;
    trainingTo: string;
    forecastGeneratedAt: Instant;
    horizonMonths: number;
    selectedModel: 'ETS_A_Ad_N' | 'TRAILING_3_MONTH_MEAN';
    modelSelectionReason: string;
    etsParameters: EtsParameters | null;
    validation: { ets: ValidationResult; baseline: ValidationResult };
    points: (EtsForecastPoint & { month: string })[];
    boundaryHandling: string;
    seasonalityNotice: string;
  };

/**
 * Monthly received counts, excluding any partial month.
 *
 * The final month is excluded whenever the cutoff falls before its last day: the
 * supplied dataset's September 2026 is partial, and fitting a model to a
 * three-quarters-finished month would bend the trend downwards for no reason.
 */
export function monthlyReceivedHistory(
  handle: Handle, cutoff: Instant,
  scope?: { sql: string; params: (string | number)[] },
): { history: HistoryPoint[]; partialMonth: string | null } {
  const where = ['received_at <= ?'];
  const params: (string | number)[] = [cutoff];
  if (scope) { where.push(scope.sql); params.push(...scope.params); }

  const rows = handle.all<{ received_at: string }>(
    `SELECT received_at FROM applications WHERE ${where.join(' AND ')}`, ...params);
  if (rows.length === 0) return { history: [], partialMonth: null };

  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = monthKey(toBusinessDate(r.received_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cutoffDate = toBusinessDate(cutoff);
  const cutoffMonth = monthKey(cutoffDate);
  const lastDayOfCutoffMonth = new Date(Date.UTC(
    Number(cutoffMonth.slice(0, 4)), Number(cutoffMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const partialMonth = cutoffDate < lastDayOfCutoffMonth ? cutoffMonth : null;

  const keys = [...counts.keys()].sort();
  const first = keys[0]!;
  const last = partialMonth ? addMonths(partialMonth, -1) : keys[keys.length - 1]!;
  if (last < first) return { history: [], partialMonth };

  // Every month between the first and the last is listed, so a genuine gap in the
  // history shows as a zero-count entry that `findCompleteRun` can refuse to fit.
  const history = monthRange(first, last).map((month) => ({
    month, received: counts.get(month) ?? 0,
  }));
  return { history, partialMonth };
}

/**
 * The trailing run of months with data.
 *
 * A month with no applications at all is treated as a **gap**, not a zero: in a
 * records unit a month with zero applications means the data was not loaded. Any
 * such month truncates the usable history.
 */
export function findCompleteRun(history: readonly HistoryPoint[]): HistoryPoint[] {
  const run: HistoryPoint[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const point = history[i]!;
    if (point.received <= 0) break;
    run.unshift(point);
  }
  return run;
}

export function buildForecast(
  handle: Handle, cutoff: Instant, horizonMonths: number,
  scope?: { sql: string; params: (string | number)[] },
): ForecastOutput {
  const horizon = Math.min(3, Math.max(1, Math.trunc(horizonMonths)));
  const { history } = monthlyReceivedHistory(handle, cutoff, scope);
  const run = findCompleteRun(history);

  if (run.length < MINIMUM_MONTHS) {
    const gapped = history.length >= MINIMUM_MONTHS && run.length < history.length;
    return {
      available: false,
      reason: gapped ? 'HISTORY_HAS_GAPS' : 'INSUFFICIENT_HISTORY',
      message: gapped
        ? 'Insufficient history for a validated forecast: the monthly series has gaps, and a '
          + 'missing month is unknown rather than zero.'
        : 'Insufficient history for a validated forecast.',
      completeMonths: run.length,
      requiredMonths: MINIMUM_MONTHS,
      history,
    };
  }

  const series = run.map((p) => p.received);
  const etsValidation = backtest(series, 'ETS_A_Ad_N', run);
  const baselineValidation = backtest(series, 'TRAILING_3_MONTH_MEAN', run);

  // The baseline wins ties: a simpler model that matches a fitted one is the one
  // to publish.
  const etsWins = etsValidation.mae < baselineValidation.mae;
  const selectedModel = etsWins ? 'ETS_A_Ad_N' : 'TRAILING_3_MONTH_MEAN';

  const fit = fitEts(series);
  const points = etsWins
    ? forecastEts(fit, horizon)
    : baselinePoints(series, horizon);

  const lastMonth = run[run.length - 1]!.month;
  return {
    available: true,
    history: run,
    trainingFrom: run[0]!.month,
    trainingTo: lastMonth,
    forecastGeneratedAt: cutoff,
    horizonMonths: horizon,
    selectedModel,
    modelSelectionReason: etsWins
      ? `ETS(A,Ad,N) had the lower backtest MAE (${etsValidation.mae.toFixed(2)} against `
        + `${baselineValidation.mae.toFixed(2)} applications) over the last ${BACKTEST_ORIGINS} `
        + 'complete months, so it is the model shown.'
      : `The trailing ${BASELINE_WINDOW}-month mean matched or beat ETS(A,Ad,N) on backtest MAE `
        + `(${baselineValidation.mae.toFixed(2)} against ${etsValidation.mae.toFixed(2)} `
        + 'applications), so the baseline is the model shown.',
    etsParameters: etsWins ? fit.parameters : null,
    validation: { ets: etsValidation, baseline: baselineValidation },
    points: points.map((p, i) => ({ ...p, month: addMonths(lastMonth, i + 1) })),
    boundaryHandling: 'Application counts cannot be negative, so point forecasts and interval '
      + 'bounds below zero are raised to zero. Any point where that happened is flagged.',
    seasonalityNotice: 'No seasonal component is fitted. Annual seasonality is not added without '
      + 'sufficient history and validation, and neither is available here.',
  };
}

/** Prediction intervals for the baseline, from the spread of the trailing window. */
function baselinePoints(series: readonly number[], horizon: number): EtsForecastPoint[] {
  const tail = series.slice(-BASELINE_WINDOW);
  const mean = trailingMeanForecast(series, BASELINE_WINDOW);
  const variance = tail.length > 1
    ? tail.reduce((s, v) => s + (v - mean) ** 2, 0) / (tail.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const out: EtsForecastPoint[] = [];
  for (let h = 1; h <= horizon; h += 1) {
    const lower95 = mean - 1.959963984540054 * sd;
    out.push({
      horizon: h, rawPoint: mean, point: Math.max(0, mean),
      lower80: Math.max(0, mean - 1.2815515655446004 * sd),
      upper80: mean + 1.2815515655446004 * sd,
      lower95: Math.max(0, lower95),
      upper95: mean + 1.959963984540054 * sd,
      flooredAtZero: lower95 < 0,
    });
  }
  return out;
}

/**
 * Rolling-origin backtest over the most recent `BACKTEST_ORIGINS` complete months.
 *
 * At each origin the model sees only the months strictly before it, so nothing in
 * the error figures is contaminated by data the model would not have had.
 */
export function backtest(
  series: readonly number[], model: ValidationResult['model'], run: readonly HistoryPoint[],
): ValidationResult {
  const origins: ValidationResult['origins'] = [];
  const firstOrigin = Math.max(4, series.length - BACKTEST_ORIGINS);

  for (let i = firstOrigin; i < series.length; i += 1) {
    const train = series.slice(0, i);
    const actual = series[i]!;
    const predicted = model === 'ETS_A_Ad_N'
      ? forecastEts(fitEts(train), 1)[0]!.point
      : Math.max(0, trailingMeanForecast(train, BASELINE_WINDOW));
    origins.push({ month: run[i]!.month, actual, predicted });
  }

  const absoluteErrors = origins.map((o) => Math.abs(o.actual - o.predicted));
  const mae = absoluteErrors.length === 0
    ? Number.POSITIVE_INFINITY
    : absoluteErrors.reduce((a, b) => a + b, 0) / absoluteErrors.length;
  const totalActual = origins.reduce((s, o) => s + o.actual, 0);
  return {
    model, mae,
    // WAPE is undefined when the denominator is zero, so it is withheld rather
    // than reported as 0% or as infinity.
    wape: totalActual === 0
      ? null
      : (absoluteErrors.reduce((a, b) => a + b, 0) / totalActual) * 100,
    origins,
  };
}

// --------------------------------------------------------- backlog scenario

export interface BacklogScenario {
  /** Always labelled a scenario, never a forecast. */
  kind: 'SCENARIO';
  startingBacklog: number;
  months: {
    month: string;
    arrivals: number;
    assumedCompletions: number;
    assumedCancellations: number;
    projectedBacklog: number;
  }[];
  assumptions: string[];
  disclaimer: string;
}

/**
 * Projects the open backlog forward.
 *
 *     next backlog = max(0, current backlog + arrivals − completions − authorised cancellations)
 *
 * The capacity and cancellation assumptions are stated, because they are inputs a
 * manager chooses, not facts the data supplies. This is not a forecast and it is
 * not a completion promise to any individual applicant.
 */
export function backlogScenario(
  startingBacklog: number,
  arrivalsByMonth: readonly { month: string; arrivals: number }[],
  monthlyCompletionCapacity: number,
  monthlyCancellations: number,
): BacklogScenario {
  let backlog = startingBacklog;
  const months = arrivalsByMonth.map((a) => {
    backlog = Math.max(0, backlog + a.arrivals - monthlyCompletionCapacity - monthlyCancellations);
    return {
      month: a.month,
      arrivals: a.arrivals,
      assumedCompletions: monthlyCompletionCapacity,
      assumedCancellations: monthlyCancellations,
      projectedBacklog: backlog,
    };
  });
  return {
    kind: 'SCENARIO',
    startingBacklog,
    months,
    assumptions: [
      `Completion capacity is assumed constant at ${monthlyCompletionCapacity} reports a month, `
      + 'taken from the trailing observed completion rate unless an operator overrides it.',
      `Authorised cancellations are assumed constant at ${monthlyCancellations} a month.`,
      'Arrivals are taken from the volume forecast above, with its own uncertainty, which this '
      + 'scenario does not propagate.',
      'No change in staffing, report mix or policy is modelled.',
    ],
    disclaimer: 'A backlog scenario is not a guaranteed forecast and is not any individual '
      + 'patient’s completion promise.',
  };
}
