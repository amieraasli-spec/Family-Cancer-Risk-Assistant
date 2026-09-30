/**
 * Horizontal bar chart: one series, one colour.
 *
 * Horizontal because the categories are department names, which do not fit as
 * vertical tick labels at tablet width without rotating them. A value ramp is
 * deliberately not used: colouring bars darker-where-bigger would encode length
 * twice and burn the only free channel.
 */
import { ChartFrame, ChartTable, SERIES, Tooltip, useTooltip } from './primitives.tsx';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Printed beside the bar, e.g. "12/18" for a rate. */
  annotation?: string;
  /** Rendered as "not applicable" rather than as a zero-length bar. */
  notApplicable?: boolean;
  tooltip?: string[];
}

export function BarChart({ data, height, valueSuffix, title, description, tableCaption, valueColumnLabel }: {
  data: BarDatum[];
  height: number;
  valueSuffix?: string;
  title: string;
  description: string;
  tableCaption: string;
  valueColumnLabel: string;
}) {
  const tooltip = useTooltip();
  const plotted = data.filter((d) => !d.notApplicable);
  const notApplicable = data.filter((d) => d.notApplicable);
  const max = Math.max(1, ...plotted.map((d) => d.value));

  const rowHeight = 30;
  const barHeight = 16;
  const labelWidth = 168;
  const valueWidth = 86;
  const width = 640;
  const innerWidth = width - labelWidth - valueWidth;
  const chartHeight = Math.max(rowHeight, data.length * rowHeight);

  return (
    <div className="stack">
      <ChartFrame title={title} description={description} height={Math.min(height, chartHeight + 8)}
        viewBox={`0 0 ${width} ${chartHeight + 8}`}>
        {data.map((d, i) => {
          const y = i * rowHeight + 4;
          const barWidth = d.notApplicable ? 0 : Math.max(2, (d.value / max) * innerWidth);
          return (
            <g key={d.key}
              onMouseEnter={(e) => tooltip.show(e, d.label,
                d.tooltip ?? [`${d.value}${valueSuffix ?? ''}`])}
              onMouseMove={(e) => tooltip.show(e, d.label,
                d.tooltip ?? [`${d.value}${valueSuffix ?? ''}`])}
              onMouseLeave={tooltip.hide}>
              {/* A hit target larger than the mark itself. */}
              <rect x={0} y={y} width={width} height={rowHeight - 2} fill="transparent" />
              <text x={labelWidth - 8} y={y + barHeight - 2} textAnchor="end"
                className="axis-label" fontSize={12}>
                {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
              </text>
              {d.notApplicable ? (
                <text x={labelWidth + 4} y={y + barHeight - 2} className="axis-label" fontSize={11}>
                  Not applicable — no eligible cases
                </text>
              ) : (
                <>
                  {/* 4px rounded data-end, anchored to the baseline at x = labelWidth. */}
                  <rect x={labelWidth} y={y} width={barWidth} height={barHeight}
                    rx={4} ry={4} fill={SERIES[0]} />
                  <rect x={labelWidth} y={y} width={Math.min(4, barWidth)} height={barHeight}
                    fill={SERIES[0]} />
                  <text x={labelWidth + barWidth + 6} y={y + barHeight - 3}
                    className="value-label">
                    {d.annotation ?? `${d.value}${valueSuffix ?? ''}`}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {/* Solid hairline baseline. */}
        <line x1={labelWidth} y1={0} x2={labelWidth} y2={chartHeight} className="axis-line" />
      </ChartFrame>

      {notApplicable.length > 0 && (
        <p className="muted">
          {notApplicable.length} {notApplicable.length === 1 ? 'department has' : 'departments have'}{' '}
          no eligible cases for this period, so no percentage is shown for{' '}
          {notApplicable.map((d) => d.label).join(', ')}.
        </p>
      )}

      <ChartTable caption={tableCaption} columns={['Category', valueColumnLabel]}
        rows={data.map((d) => [d.label,
          d.notApplicable ? 'Not applicable — no eligible cases'
            : (d.annotation ?? `${d.value}${valueSuffix ?? ''}`)])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
