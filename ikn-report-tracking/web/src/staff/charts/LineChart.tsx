/**
 * Line chart on a single axis.
 *
 * One axis only. Where a count series and a percentage series both matter, they are
 * two charts on two subpages — never two y-scales on one plot, which invents a
 * relationship the data does not contain.
 */
import { ChartFrame, ChartTable, Legend, niceTicks, SERIES, shortMonth, Tooltip,
  useTooltip } from './primitives.tsx';

export interface LineSeries {
  key: string;
  label: string;
  colour: string;
  values: (number | null)[];
  /** Dashed only where it means something: a threshold or a projection. */
  dashed?: boolean;
  marker?: 'circle' | 'square' | 'diamond';
}

export function LineChart({
  labels, series, height, title, description, tableCaption, valueSuffix, referenceLine,
  yLabel, maxOverride,
}: {
  labels: string[];
  series: LineSeries[];
  height: number;
  title: string;
  description: string;
  tableCaption: string;
  valueSuffix?: string;
  referenceLine?: { value: number; label: string };
  yLabel: string;
  maxOverride?: number;
}) {
  const tooltip = useTooltip();
  const width = 640;
  const margin = { top: 16, right: 54, bottom: 38, left: 46 };
  const innerWidth = width - margin.left - margin.right;
  const plotHeight = Math.max(60, height - margin.top - margin.bottom - 26);

  const allValues = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const dataMax = Math.max(1, ...allValues, referenceLine?.value ?? 0, maxOverride ?? 0);
  const ticks = niceTicks(dataMax);
  const scaleMax = Math.max(dataMax, ticks[ticks.length - 1] ?? dataMax);

  const x = (i: number) => margin.left
    + (labels.length === 1 ? innerWidth / 2 : (i / (labels.length - 1)) * innerWidth);
  const y = (v: number) => margin.top + plotHeight - (v / scaleMax) * plotHeight;

  // Show at most eight tick labels so they never collide at tablet width.
  const tickEvery = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="stack">
      {series.length >= 2 && (
        <Legend items={series.map((s) => ({
          label: s.label, colour: s.colour, shape: s.dashed ? 'dashed' : 'line',
        }))} />
      )}
      <ChartFrame title={title} description={description} height={height}
        viewBox={`0 0 ${width} ${margin.top + plotHeight + margin.bottom}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={margin.left} y1={y(t)} x2={width - margin.right} y2={y(t)} className="grid-line" />
            <text x={margin.left - 6} y={y(t) + 4} textAnchor="end" className="axis-label">{t}</text>
          </g>
        ))}

        {referenceLine && (
          <g>
            {/* Dashed because it is a threshold, which is what dashing should mean. */}
            <line x1={margin.left} y1={y(referenceLine.value)} x2={width - margin.right}
              y2={y(referenceLine.value)} stroke="var(--text-muted)" strokeWidth={2}
              strokeDasharray="6 4" />
            <text x={width - margin.right + 4} y={y(referenceLine.value) + 4}
              className="axis-label">{referenceLine.label}</text>
          </g>
        )}

        {series.map((s) => {
          const points = s.values
            .map((v, i) => (v === null ? null : { x: x(i), y: y(v), i, v }))
            .filter((p): p is { x: number; y: number; i: number; v: number } => p !== null);
          const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
          const last = points[points.length - 1];
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.colour} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round"
                {...(s.dashed ? { strokeDasharray: '7 5' } : {})} />
              {points.map((p) => (
                <g key={p.i}>
                  {/* A 2px surface ring keeps overlapping markers legible. */}
                  <circle cx={p.x} cy={p.y} r={4.5} fill={s.colour}
                    stroke="var(--surface-1)" strokeWidth={2} />
                  <circle cx={p.x} cy={p.y} r={13} fill="transparent"
                    onMouseEnter={(e) => tooltip.show(e, labels[p.i] ?? '',
                      series.map((other) => {
                        const value = other.values[p.i];
                        return `${other.label}: ${value === null ? 'no eligible cases'
                          : `${value}${valueSuffix ?? ''}`}`;
                      }))}
                    onMouseMove={(e) => tooltip.show(e, labels[p.i] ?? '',
                      series.map((other) => {
                        const value = other.values[p.i];
                        return `${other.label}: ${value === null ? 'no eligible cases'
                          : `${value}${valueSuffix ?? ''}`}`;
                      }))}
                    onMouseLeave={tooltip.hide} />
                </g>
              ))}
              {/* Direct-label the endpoint only. */}
              {last && (
                <text x={last.x + 7} y={last.y + 4} className="value-label" fill={s.colour}>
                  {`${Math.round(last.v * 10) / 10}${valueSuffix ?? ''}`}
                </text>
              )}
            </g>
          );
        })}

        {labels.map((label, i) => (i % tickEvery === 0 ? (
          <text key={label} x={x(i)} y={margin.top + plotHeight + 16} textAnchor="middle"
            className="axis-label">{shortMonth(label)}</text>
        ) : null))}

        <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right}
          y2={margin.top + plotHeight} className="axis-line" />
        <text x={margin.left} y={margin.top - 5} className="axis-label">{yLabel}</text>
      </ChartFrame>
      <ChartTable caption={tableCaption}
        columns={['Month', ...series.map((s) => s.label)]}
        rows={labels.map((label, i) => [label, ...series.map((s) => {
          const v = s.values[i];
          return v === null || v === undefined ? 'Not applicable — no eligible cases'
            : `${Math.round(v * 10) / 10}${valueSuffix ?? ''}`;
        })])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
