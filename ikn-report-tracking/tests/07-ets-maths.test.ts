/**
 * The ETS(A,Ad,N) arithmetic, checked against results that are known independently.
 *
 * The prediction-interval formula is the part most likely to be quietly wrong, so it
 * is verified by reduction: with φ = 1 it must equal the textbook ETS(A,A,N) result,
 * and with β = 0 the ETS(A,N,N) result. A forecast whose intervals are wrong is worse
 * than no forecast, because it looks like evidence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitEts, forecastEts, trailingMeanForecast } from '../server/analytics/ets.ts';
import { backtest, findCompleteRun, BACKTEST_ORIGINS } from '../server/analytics/forecast.ts';

/** Reference implementation of the point forecast, written straight from the model. */
function referencePoint(level: number, trend: number, phi: number, h: number): number {
  let sum = 0;
  for (let k = 1; k <= h; k += 1) sum += phi ** k;
  return level + sum * trend;
}

/** Reference implementation of the forecast variance, likewise. */
function referenceVariance(
  sigmaSquared: number, alpha: number, beta: number, phi: number, h: number,
): number {
  let total = 0;
  for (let j = 1; j <= h - 1; j += 1) {
    let s = 0;
    for (let k = 1; k <= j; k += 1) s += phi ** k;
    total += (alpha + beta * s) ** 2;
  }
  return sigmaSquared * (1 + total);
}

const Z80 = 1.2815515655446004;

describe('ETS(A,Ad,N)', () => {
  const series = [26, 18, 20, 19, 25, 28, 29, 26, 23, 28, 30, 31,
    29, 30, 27, 29, 31, 31, 32, 28, 28, 28, 38, 35];

  it('fits within the admissible parameter region', () => {
    const fit = fitEts(series);
    assert.ok(fit.parameters.alpha > 0 && fit.parameters.alpha < 1);
    assert.ok(fit.parameters.beta >= 0 && fit.parameters.beta <= fit.parameters.alpha);
    assert.ok(fit.parameters.phi > 0 && fit.parameters.phi < 1,
      'a damped trend requires 0 < phi < 1, or it is not damped');
    assert.equal(fit.observations, series.length);
    assert.ok(fit.sse > 0);
  });

  it('is deterministic: the same series gives the same parameters every time', () => {
    const a = fitEts(series);
    const b = fitEts(series);
    assert.deepEqual(a.parameters, b.parameters,
      'a monthly figure must be reproducible months later');
  });

  it('matches the point forecast written straight from the model equations', () => {
    const fit = fitEts(series);
    const points = forecastEts(fit, 3);
    for (const point of points) {
      const expected = referencePoint(
        fit.level, fit.trend, fit.parameters.phi, point.horizon);
      assert.ok(Math.abs(point.rawPoint - expected) < 1e-9,
        `horizon ${point.horizon}: ${point.rawPoint} vs ${expected}`);
    }
  });

  it('matches the variance written straight from the model equations', () => {
    const fit = fitEts(series);
    const { alpha, beta, phi } = fit.parameters;
    const points = forecastEts(fit, 3);
    for (const point of points) {
      const variance = referenceVariance(fit.sigmaSquared, alpha, beta, phi, point.horizon);
      const expectedUpper = point.rawPoint + Z80 * Math.sqrt(variance);
      assert.ok(Math.abs(point.upper80 - expectedUpper) < 1e-6,
        `horizon ${point.horizon}: upper80 ${point.upper80} vs ${expectedUpper}`);
    }
  });

  it('reduces to ETS(A,N,N) when there is no trend', () => {
    // With beta = 0 the c_j terms collapse to alpha, so the variance multiplier is
    // 1 + (h - 1) * alpha^2 — the standard simple-exponential-smoothing result.
    const alpha = 0.4;
    const sigmaSquared = 9;
    for (let h = 1; h <= 4; h += 1) {
      const mine = referenceVariance(sigmaSquared, alpha, 0, 0.9, h);
      const textbook = sigmaSquared * (1 + (h - 1) * alpha ** 2);
      assert.ok(Math.abs(mine - textbook) < 1e-9, `h=${h}: ${mine} vs ${textbook}`);
    }
  });

  it('reduces to ETS(A,A,N) when the trend is undamped', () => {
    // With phi = 1 the c_j terms become alpha + j * beta, the textbook Holt result.
    const alpha = 0.5;
    const beta = 0.1;
    const sigmaSquared = 4;
    for (let h = 1; h <= 4; h += 1) {
      const mine = referenceVariance(sigmaSquared, alpha, beta, 1, h);
      let total = 0;
      for (let j = 1; j <= h - 1; j += 1) total += (alpha + j * beta) ** 2;
      const textbook = sigmaSquared * (1 + total);
      assert.ok(Math.abs(mine - textbook) < 1e-9, `h=${h}: ${mine} vs ${textbook}`);
    }
  });

  it('widens the interval as the horizon lengthens', () => {
    const fit = fitEts(series);
    const points = forecastEts(fit, 3);
    for (let i = 1; i < points.length; i += 1) {
      const narrower = points[i - 1]!.upper95 - points[i - 1]!.lower95;
      const wider = points[i]!.upper95 - points[i]!.lower95;
      assert.ok(wider >= narrower,
        'uncertainty cannot shrink as the forecast reaches further out');
    }
  });

  it('nests the 80% interval inside the 95% interval', () => {
    const points = forecastEts(fitEts(series), 3);
    for (const point of points) {
      assert.ok(point.lower95 <= point.lower80);
      assert.ok(point.upper80 <= point.upper95);
    }
  });

  it('damps a strong trend rather than extrapolating it forever', () => {
    // A steadily rising series: the damped forecast must rise by less each step.
    const rising = Array.from({ length: 24 }, (_, i) => 20 + i * 2);
    const fit = fitEts(rising);
    const points = forecastEts(fit, 3);
    const firstStep = points[1]!.rawPoint - points[0]!.rawPoint;
    const secondStep = points[2]!.rawPoint - points[1]!.rawPoint;
    assert.ok(secondStep <= firstStep + 1e-9,
      'a damped trend must flatten, which is the whole point of the Ad component');
  });

  it('floors a negative forecast at zero and says it did so', () => {
    // A series falling hard enough that the trend would carry it below zero.
    const falling = Array.from({ length: 24 }, (_, i) => Math.max(1, 60 - i * 2.5));
    const points = forecastEts(fitEts(falling), 3);
    for (const point of points) {
      assert.ok(point.point >= 0, 'a count forecast cannot be negative');
      assert.ok(point.lower95 >= 0);
      if (point.rawPoint < 0) {
        assert.equal(point.flooredAtZero, true, 'the floor must be reported, not silent');
      }
    }
  });
});

describe('backtesting and the baseline', () => {
  const series = [26, 18, 20, 19, 25, 28, 29, 26, 23, 28, 30, 31,
    29, 30, 27, 29, 31, 31, 32, 28, 28, 28, 38, 35, 31, 37, 36, 33, 40, 34, 40, 40];
  const history = series.map((received, i) => ({
    month: `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, received,
  }));

  it('uses only earlier data at each origin', () => {
    const result = backtest(series, 'TRAILING_3_MONTH_MEAN', history);
    assert.equal(result.origins.length, BACKTEST_ORIGINS);
    for (const [i, origin] of result.origins.entries()) {
      const index = series.length - BACKTEST_ORIGINS + i;
      assert.equal(origin.actual, series[index]);
      // The trailing mean of the three months before the origin, and nothing after it.
      const expected = trailingMeanForecast(series.slice(0, index), 3);
      assert.ok(Math.abs(origin.predicted - expected) < 1e-9,
        'a backtest origin must not see the value it is predicting');
    }
  });

  it('computes MAE and WAPE from the same errors', () => {
    const result = backtest(series, 'TRAILING_3_MONTH_MEAN', history);
    const errors = result.origins.map((o) => Math.abs(o.actual - o.predicted));
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    const totalActual = result.origins.reduce((s, o) => s + o.actual, 0);
    assert.ok(Math.abs(result.mae - mae) < 1e-9);
    assert.ok(result.wape !== null);
    assert.ok(Math.abs(result.wape! - (errors.reduce((a, b) => a + b, 0) / totalActual) * 100) < 1e-9);
  });

  it('withholds WAPE when total actual volume is zero', () => {
    const zeros = new Array(24).fill(0);
    const zeroHistory = zeros.map((received, i) => ({ month: `2024-${i}`, received }));
    const result = backtest(zeros, 'TRAILING_3_MONTH_MEAN', zeroHistory);
    assert.equal(result.wape, null,
      'a percentage error against a zero denominator is undefined, not zero');
  });

  it('treats a month with no applications as a gap, not as a zero', () => {
    const gapped = [
      ...Array.from({ length: 10 }, (_, i) => ({ month: `2024-${i}`, received: 20 })),
      { month: '2024-11', received: 0 },
      ...Array.from({ length: 10 }, (_, i) => ({ month: `2025-${i}`, received: 25 })),
    ];
    const run = findCompleteRun(gapped);
    assert.equal(run.length, 10,
      'a zero month truncates the usable history: in a records unit it means the data '
      + 'was not loaded, not that nobody applied');
  });
});
