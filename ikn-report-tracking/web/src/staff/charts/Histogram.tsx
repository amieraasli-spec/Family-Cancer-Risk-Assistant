/** Vertical histogram over ordered working-day bands. One series, one colour. */
import { ChartFrame, ChartTable, niceTicks, SERIES, Tooltip, useTooltip } from './primitives.tsx';

export function Histogram({ bins, total, height, title, description, tableCaption, unitLabel }: {
  bins: { key: string; label: string; count: number }[];
  total: number; height: number; title: string; description: string;
  tableCaption: string; unitLabel: string;
}) {
  const tooltip = useTooltip();
  const width = 640;
  const margin = { top: 14, right: 12, bottom: 40, left: 44 };
  const innerWidth = width - margin.left - margin.right;
  const plotHeight = Math.max(60, height - margin.top - margin.bottom - 4);
  const max = Math.max(1, ...bins.map((b) => b.count));
  const ticks = niceTicks(max);
  const scaleMax = Math.max(max, ticks[ticks.length - 1] ?? max);
  // A 2px surface gap between adjacent fills, rather than a border.
  const slot = innerWidth / Math.max(1, bins.length);
  const barWidth = Math.max(6, slot - 12);

  return (
    <div className="stack">
      <ChartFrame title={title} description={description} height={height}
        viewBox={`0 0 ${width} ${margin.top + plotHeight + margin.bottom}`}>
        {ticks.map((t) => {
          const y = margin.top + plotHeight - (t / scaleMax) * plotHeight;
          return (
            <g key={t}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} className="grid-line" />
              <text x={margin.left - 6} y={y + 4} textAnchor="end" className="axis-label">{t}</text>
            </g>
          );
        })}
        {bins.map((b, i) => {
          const x = margin.left + i * slot + (slot - barWidth) / 2;
          const barHeight = b.count === 0 ? 0 : Math.max(3, (b.count / scaleMax) * plotHeight);
          const y = margin.top + plotHeight - barHeight;
          const share = total === 0 ? 0 : (b.count / total) * 100;
          return (
            <g key={b.key}
              onMouseEnter={(e) => tooltip.show(e, `${b.label} ${unitLabel}`,
                [`${b.count} of ${total} (${share.toFixed(1)}%)`])}
              onMouseMove={(e) => tooltip.show(e, `${b.label} ${unitLabel}`,
                [`${b.count} of ${total} (${share.toFixed(1)}%)`])}
              onMouseLeave={tooltip.hide}>
              <rect x={margin.left + i * slot} y={margin.top} width={slot} height={plotHeight}
                fill="transparent" />
              {barHeight > 0 && (
                <>
                  <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} ry={4}
                    fill={SERIES[0]} />
                  {/* Square the foot so the mark is anchored to the baseline. */}
                  <rect x={x} y={margin.top + plotHeight - Math.min(4, barHeight)}
                    width={barWidth} height={Math.min(4, barHeight)} fill={SERIES[0]} />
                </>
              )}
              {/* Direct-label only the tallest band; the axis carries the rest. */}
              {b.count === max && b.count > 0 && (
                <text x={x + barWidth / 2} y={y - 5} textAnchor="middle" className="value-label">
                  {b.count}
                </text>
              )}
              <text x={margin.left + i * slot + slot / 2} y={margin.top + plotHeight + 16}
                textAnchor="middle" className="axis-label">{b.label}</text>
            </g>
          );
        })}
        <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right}
          y2={margin.top + plotHeight} className="axis-line" />
        <text x={margin.left + innerWidth / 2} y={margin.top + plotHeight + 34}
          textAnchor="middle" className="axis-label">Working days</text>
      </ChartFrame>
      <ChartTable caption={tableCaption} columns={['Working-day band', unitLabel, 'Share']}
        rows={bins.map((b) => [b.label, b.count,
          total === 0 ? '—' : `${((b.count / total) * 100).toFixed(1)}%`])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
