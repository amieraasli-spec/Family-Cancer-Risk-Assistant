/**
 * Donut for part-to-whole at a glance, at most five mutually exclusive slices.
 *
 * Every slice carries a direct label with its count and percentage. That is both
 * the accessibility channel — identity is never colour alone — and the documented
 * relief for the light-mode slots that fall below 3:1 against the surface.
 */
import { ChartFrame, ChartTable, Legend, SERIES, Tooltip, useTooltip } from './primitives.tsx';

export function Donut({ slices, total, height, title, description, tableCaption, unitLabel }: {
  slices: { key: string; label: string; count: number; percent: number }[];
  total: number; height: number; title: string; description: string;
  tableCaption: string; unitLabel: string;
}) {
  const tooltip = useTooltip();
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 98;
  const inner = 58;

  if (total === 0) {
    return (
      <div className="stack">
        <p className="muted">No eligible records for the selected filters.</p>
      </div>
    );
  }

  // A 2px surface gap between fills, expressed as a small angular pad.
  const padAngle = slices.length > 1 ? 0.018 : 0;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const sweep = (s.count / total) * (Math.PI * 2 - padAngle * slices.length);
    const start = angle + padAngle / 2;
    const end = start + sweep;
    angle = end + padAngle / 2;
    const mid = (start + end) / 2;
    return { ...s, start, end, mid, colour: SERIES[i % SERIES.length]! };
  });

  const arcPath = (a: typeof arcs[number]) => {
    const large = a.end - a.start > Math.PI ? 1 : 0;
    const x1 = cx + outer * Math.cos(a.start);
    const y1 = cy + outer * Math.sin(a.start);
    const x2 = cx + outer * Math.cos(a.end);
    const y2 = cy + outer * Math.sin(a.end);
    const x3 = cx + inner * Math.cos(a.end);
    const y3 = cy + inner * Math.sin(a.end);
    const x4 = cx + inner * Math.cos(a.start);
    const y4 = cy + inner * Math.sin(a.start);
    return `M${x1} ${y1} A${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} `
      + `A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
  };

  return (
    <div className="stack">
      <Legend items={arcs.map((a) => ({ label: `${a.label} — ${a.count}`, colour: a.colour }))} />
      <ChartFrame title={title} description={description} height={height}
        viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a) => (
          <path key={a.key} d={arcPath(a)} fill={a.colour}
            onMouseEnter={(e) => tooltip.show(e, a.label,
              [`${a.count} of ${total} ${unitLabel}`, `${a.percent.toFixed(1)}% of the open queue`])}
            onMouseMove={(e) => tooltip.show(e, a.label,
              [`${a.count} of ${total} ${unitLabel}`, `${a.percent.toFixed(1)}% of the open queue`])}
            onMouseLeave={tooltip.hide} />
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" className="value-label" fontSize={26}>
          {total}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="axis-label">open</text>
      </ChartFrame>
      <ChartTable caption={tableCaption} columns={['Stage', unitLabel, 'Share']}
        rows={arcs.map((a) => [a.label, a.count, `${a.percent.toFixed(1)}%`])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
