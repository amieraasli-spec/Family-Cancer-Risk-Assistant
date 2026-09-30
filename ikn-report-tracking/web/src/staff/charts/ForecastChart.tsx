/**
 * Observed history with the forecast and its prediction intervals.
 *
 * Two shaded bands (95% outer, 80% inner), the observed line solid, the projection
 * dashed — dashing here means "projection", which is what dashing should mean. The
 * model actually used is named on the chart, and the validation error travels with
 * it in the caption.
 */
import type { ForecastPoint } from '../types.ts';
import { ChartFrame, ChartTable, Legend, niceTicks, SERIES, shortMonth, Tooltip,
  useTooltip } from './primitives.tsx';

export function ForecastChart({
  history, points, selectedModel, height, title, description, tableCaption,
}: {
  history: { month: string; received: number }[];
  points: ForecastPoint[];
  selectedModel: string;
  height: number; title: string; description: string; tableCaption: string;
}) {
  const tooltip = useTooltip();
  const width = 640;
  const margin = { top: 16, right: 20, bottom: 40, left: 46 };
  const innerWidth = width - margin.left - margin.right;
  const plotHeight = Math.max(90, height - margin.top - margin.bottom - 26);

  // Only the trailing window is drawn, so the forecast is legible at tablet width.
  const shown = history.slice(-18);
  const labels = [...shown.map((h) => h.month), ...points.map((p) => p.month)];
  const max = Math.max(1, ...shown.map((h) => h.received), ...points.map((p) => p.upper95));
  const ticks = niceTicks(max);
  const scaleMax = Math.max(max, ticks[ticks.length - 1] ?? max);

  const x = (i: number) => margin.left + (i / Math.max(1, labels.length - 1)) * innerWidth;
  const y = (v: number) => margin.top + plotHeight - (v / scaleMax) * plotHeight;

  const observedPath = shown
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(h.received)}`).join(' ');

  const bridgeIndex = shown.length - 1;
  const forecastPath = [
    `M${x(bridgeIndex)} ${y(shown[bridgeIndex]?.received ?? 0)}`,
    ...points.map((p, i) => `L${x(shown.length + i)} ${y(p.point)}`),
  ].join(' ');

  const band = (lower: (p: ForecastPoint) => number, upper: (p: ForecastPoint) => number) => {
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(shown.length + i)} ${y(upper(p))}`);
    const bottom = points.slice().reverse()
      .map((p, i) => `L${x(shown.length + points.length - 1 - i)} ${y(lower(p))}`);
    return [...top, ...bottom, 'Z'].join(' ');
  };

  const tickEvery = Math.max(1, Math.ceil(labels.length / 8));
  const anyFloored = points.some((p) => p.flooredAtZero);

  return (
    <div className="stack">
      <Legend items={[
        { label: 'Observed applications received', colour: SERIES[0]!, shape: 'line' },
        { label: `Forecast (${selectedModel === 'ETS_A_Ad_N' ? 'ETS(A,Ad,N)' : 'trailing 3-month mean'})`,
          colour: SERIES[1]!, shape: 'dashed' },
        { label: '80% and 95% prediction intervals', colour: SERIES[1]! },
      ]} />
      <ChartFrame title={title} description={description} height={height}
        viewBox={`0 0 ${width} ${margin.top + plotHeight + margin.bottom}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={margin.left} y1={y(t)} x2={width - margin.right} y2={y(t)} className="grid-line" />
            <text x={margin.left - 6} y={y(t) + 4} textAnchor="end" className="axis-label">{t}</text>
          </g>
        ))}

        <path d={band((p) => p.lower95, (p) => p.upper95)} fill={SERIES[1]} fillOpacity={0.14} />
        <path d={band((p) => p.lower80, (p) => p.upper80)} fill={SERIES[1]} fillOpacity={0.26} />

        <path d={observedPath} fill="none" stroke={SERIES[0]} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        <path d={forecastPath} fill="none" stroke={SERIES[1]} strokeWidth={2}
          strokeDasharray="7 5" strokeLinecap="round" />

        {shown.map((h, i) => (
          <circle key={h.month} cx={x(i)} cy={y(h.received)} r={11} fill="transparent"
            onMouseEnter={(e) => tooltip.show(e, h.month, [`observed: ${h.received} applications`])}
            onMouseMove={(e) => tooltip.show(e, h.month, [`observed: ${h.received} applications`])}
            onMouseLeave={tooltip.hide} />
        ))}
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(shown.length + i)} cy={y(p.point)} r={4.5} fill={SERIES[1]}
              stroke="var(--surface-1)" strokeWidth={2} />
            <circle cx={x(shown.length + i)} cy={y(p.point)} r={13} fill="transparent"
              onMouseEnter={(e) => tooltip.show(e, `${p.month} — forecast`, [
                `point: ${Math.round(p.point)} applications`,
                `80% interval: ${Math.round(p.lower80)}–${Math.round(p.upper80)}`,
                `95% interval: ${Math.round(p.lower95)}–${Math.round(p.upper95)}`,
                ...(p.flooredAtZero ? ['A bound below zero was raised to zero: counts cannot be negative.'] : []),
              ])}
              onMouseMove={(e) => tooltip.show(e, `${p.month} — forecast`, [
                `point: ${Math.round(p.point)} applications`,
                `80% interval: ${Math.round(p.lower80)}–${Math.round(p.upper80)}`,
                `95% interval: ${Math.round(p.lower95)}–${Math.round(p.upper95)}`,
              ])}
              onMouseLeave={tooltip.hide} />
          </g>
        ))}

        {labels.map((label, i) => (i % tickEvery === 0 ? (
          <text key={label} x={x(i)} y={margin.top + plotHeight + 16} textAnchor="middle"
            className="axis-label">{shortMonth(label)}</text>
        ) : null))}

        <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right}
          y2={margin.top + plotHeight} className="axis-line" />
        <text x={margin.left} y={margin.top - 5} className="axis-label">Applications received</text>
      </ChartFrame>

      {anyFloored && (
        <p className="muted">
          At least one interval bound fell below zero and was raised to zero: an application count
          cannot be negative.
        </p>
      )}

      <ChartTable caption={tableCaption}
        columns={['Month', 'Observed', 'Forecast', '80% lower', '80% upper', '95% lower', '95% upper']}
        rows={[
          ...shown.map((h) => [h.month, h.received, '', '', '', '', '']),
          ...points.map((p) => [p.month, '', Math.round(p.point), Math.round(p.lower80),
            Math.round(p.upper80), Math.round(p.lower95), Math.round(p.upper95)]),
        ]} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
