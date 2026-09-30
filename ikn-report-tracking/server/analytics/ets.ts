/**
 * Holt's damped-trend exponential smoothing, ETS(A,Ad,N): additive errors, an
 * additive damped trend, no seasonality.
 *
 * Innovations state space form, which is what makes the analytic prediction
 * intervals below correct rather than guessed:
 *
 *     y_t = l_{t-1} + φ·b_{t-1} + ε_t
 *     l_t = l_{t-1} + φ·b_{t-1} + α·ε_t
 *     b_t =          φ·b_{t-1} + β·ε_t                ε_t ~ N(0, σ²)
 *
 * h-step point forecast:   ŷ_{t+h} = l_t + (Σ_{k=1..h} φ^k)·b_t
 *
 * h-step forecast variance: σ_h² = σ²·(1 + Σ_{j=1..h-1} c_j²),  c_j = α + β·Σ_{k=1..j} φ^k
 *
 * That variance formula reduces to the textbook ETS(A,A,N) result when φ = 1
 * (c_j = α + jβ) and to ETS(A,N,N) when β = 0 (c_j = α), which is how it was
 * checked. Seasonality is deliberately absent: the brief forbids adding annual
 * seasonality without sufficient history and validation.
 */

export interface EtsParameters {
  alpha: number;
  beta: number;
  phi: number;
}

export interface EtsFit {
  parameters: EtsParameters;
  initialLevel: number;
  initialTrend: number;
  level: number;
  trend: number;
  /** One-step-ahead in-sample residuals. */
  residuals: number[];
  sse: number;
  /** Residual variance, SSE / (n − 3) for the three smoothing parameters. */
  sigmaSquared: number;
  observations: number;
}

/** Bounds keep the model admissible: a damped trend needs 0 < φ < 1. */
const ALPHA_RANGE = { lo: 0.02, hi: 0.98 };
const BETA_RANGE = { lo: 0.0, hi: 0.4 };
const PHI_RANGE = { lo: 0.60, hi: 0.98 };

/**
 * Fits the model by minimising the sum of squared one-step errors over a grid,
 * coarse then refined.
 *
 * A grid search rather than a gradient method on purpose: it is deterministic,
 * cannot fail to converge, and reproduces the same parameters on every run, which
 * matters when a monthly snapshot has to be defensible months later.
 */
export function fitEts(series: readonly number[]): EtsFit {
  if (series.length < 4) throw new Error('ETS needs at least 4 observations to fit');

  // Initial states from the first two observations, the standard simple heuristic.
  const initialLevel = series[0]!;
  const initialTrend = series[1]! - series[0]!;

  let best: EtsFit | null = null;
  const evaluate = (alpha: number, beta: number, phi: number) => {
    const run = runEts(series, { alpha, beta, phi }, initialLevel, initialTrend);
    if (!best || run.sse < best.sse) best = run;
  };

  const coarse = 0.08;
  for (let a = ALPHA_RANGE.lo; a <= ALPHA_RANGE.hi + 1e-9; a += coarse) {
    for (let b = BETA_RANGE.lo; b <= Math.min(BETA_RANGE.hi, a) + 1e-9; b += coarse) {
      for (let p = PHI_RANGE.lo; p <= PHI_RANGE.hi + 1e-9; p += coarse) {
        evaluate(round(a), round(b), round(p));
      }
    }
  }
  if (!best) throw new Error('ETS grid search produced no fit');

  // Refine around the coarse optimum.
  const coarseBest = (best as EtsFit).parameters;
  const fine = 0.01;
  for (let a = coarseBest.alpha - coarse; a <= coarseBest.alpha + coarse + 1e-9; a += fine) {
    if (a < ALPHA_RANGE.lo || a > ALPHA_RANGE.hi) continue;
    for (let b = coarseBest.beta - coarse; b <= coarseBest.beta + coarse + 1e-9; b += fine) {
      if (b < BETA_RANGE.lo || b > Math.min(BETA_RANGE.hi, a)) continue;
      for (let p = coarseBest.phi - coarse; p <= coarseBest.phi + coarse + 1e-9; p += fine) {
        if (p < PHI_RANGE.lo || p > PHI_RANGE.hi) continue;
        evaluate(round(a), round(b), round(p));
      }
    }
  }
  return best;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function runEts(
  series: readonly number[], p: EtsParameters, initialLevel: number, initialTrend: number,
): EtsFit {
  let level = initialLevel;
  let trend = initialTrend;
  const residuals: number[] = [];
  let sse = 0;

  for (const y of series) {
    const oneStep = level + p.phi * trend;
    const error = y - oneStep;
    residuals.push(error);
    sse += error * error;
    const nextLevel = oneStep + p.alpha * error;
    const nextTrend = p.phi * trend + p.beta * error;
    level = nextLevel;
    trend = nextTrend;
  }

  const denominator = Math.max(1, series.length - 3);
  return {
    parameters: p, initialLevel, initialTrend, level, trend, residuals, sse,
    sigmaSquared: sse / denominator, observations: series.length,
  };
}

export interface EtsForecastPoint {
  horizon: number;
  /** Raw model output before the nonnegativity floor. */
  rawPoint: number;
  point: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
  /** True when a bound was raised to zero because counts cannot be negative. */
  flooredAtZero: boolean;
}

const Z80 = 1.2815515655446004;
const Z95 = 1.959963984540054;

export function forecastEts(fit: EtsFit, horizons: number): EtsForecastPoint[] {
  const { alpha, beta, phi } = fit.parameters;
  const out: EtsForecastPoint[] = [];

  // s_h = Σ_{k=1..h} φ^k, accumulated as the horizon grows.
  let sumPhi = 0;
  let sumC2 = 0;   // Σ_{j=1..h-1} c_j²

  for (let h = 1; h <= horizons; h += 1) {
    if (h > 1) {
      // c_{h-1} uses s_{h-1}, the value of sumPhi before this step's increment.
      const c = alpha + beta * sumPhi;
      sumC2 += c * c;
    }
    sumPhi += phi ** h;

    const point = fit.level + sumPhi * fit.trend;
    const sd = Math.sqrt(fit.sigmaSquared * (1 + sumC2));
    const raw = {
      point, lower80: point - Z80 * sd, upper80: point + Z80 * sd,
      lower95: point - Z95 * sd, upper95: point + Z95 * sd,
    };
    // Counts cannot be negative. The floor is applied and reported, rather than
    // silently presenting an impossible lower bound.
    const floored = raw.lower95 < 0 || raw.lower80 < 0 || raw.point < 0;
    out.push({
      horizon: h,
      rawPoint: point,
      point: Math.max(0, point),
      lower80: Math.max(0, raw.lower80),
      upper80: Math.max(0, raw.upper80),
      lower95: Math.max(0, raw.lower95),
      upper95: Math.max(0, raw.upper95),
      flooredAtZero: floored,
    });
  }
  return out;
}

/** Trailing mean of the last `window` observations: the baseline to beat. */
export function trailingMeanForecast(series: readonly number[], window = 3): number {
  const tail = series.slice(-window);
  if (tail.length === 0) throw new Error('trailing mean of an empty series');
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
