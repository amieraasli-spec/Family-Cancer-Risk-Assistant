/**
 * Department × month heatmap of the late-or-unfinished rate.
 *
 * One hue, light to dark, with a printed 0–100% legend. Grey is a reserved,
 * separately-labelled swatch meaning **no eligible reports were due** — it is not
 * the bottom of the scale, and conflating "nothing was due" with "everything was on
 * time" would be the easiest way to make this chart lie.
 *
 * Selecting a cell prints its numerator and denominator.
 */
import { useState } from 'react';
import type { HeatmapCell } from '../types.ts';
import { ChartFrame, ChartTable, NO_DATA, SEQUENTIAL, shortMonth, Tooltip,
  useTooltip } from './primitives.tsx';

/** Seven equal bands over 0–100%. */
function bandFor(percent: number): number {
  return Math.min(SEQUENTIAL.length - 1, Math.floor((percent / 100) * SEQUENTIAL.length));
}

export function Heatmap({ cells, months, height, title, description, tableCaption }: {
  cells: HeatmapCell[]; months: string[]; height: number; title: string;
  description: string; tableCaption: string;
}) {
  const tooltip = useTooltip();
  const [selected, setSelected] = useState<HeatmapCell | null>(null);

  const departments = [...new Map(cells.map((c) => [c.departmentId, c.departmentName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  const labelWidth = 150;
  const cellWidth = 34;
  const gap = 2;
  const headerHeight = 20;
  // Cells are sized from the height the panel actually has, with a floor that keeps
  // them a usable touch target. Every row is drawn; none is cropped away.
  const cellHeight = Math.max(18, Math.min(30,
    Math.floor((height - headerHeight - 4) / Math.max(1, departments.length)) - gap));
  const width = labelWidth + months.length * (cellWidth + gap) + 8;
  const chartHeight = headerHeight + departments.length * (cellHeight + gap);

  const byKey = new Map(cells.map((c) => [`${c.departmentId}|${c.month}`, c]));

  return (
    <div className="stack">
      {/* The legend is printed, and it names the grey swatch explicitly. */}
      <div className="legend legend--tight" aria-label="Colour scale">
        <span className="legend__item" style={{ gap: 2 }}>
          0%
          {SEQUENTIAL.map((colour, i) => (
            <span className="legend__swatch" key={colour} style={{ background: colour }}
              aria-hidden="true" title={`band ${i + 1} of ${SEQUENTIAL.length}`} />
          ))}
          100% late or unfinished
        </span>
        <span className="legend__item">
          <span className="legend__swatch" style={{ background: NO_DATA }} aria-hidden="true" />
          Grey: no eligible reports due (not zero)
        </span>
      </div>

      <div style={{ overflowX: 'auto', flex: '0 0 auto' }}>
        <ChartFrame title={title} description={description}
          height={Math.min(height, chartHeight + 4)}
          viewBox={`0 0 ${width} ${chartHeight + 4}`}>
          {months.map((m, j) => (
            <text key={m} x={labelWidth + j * (cellWidth + gap) + cellWidth / 2} y={12}
              textAnchor="middle" className="axis-label" fontSize={10}>{shortMonth(m)}</text>
          ))}
          {departments.map(([id, name], i) => {
            const y = 20 + i * (cellHeight + gap);
            return (
              <g key={id}>
                <text x={labelWidth - 8} y={y + cellHeight / 2 + 4} textAnchor="end"
                  className="axis-label" fontSize={Math.min(11, cellHeight - 8)}>
                  {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                </text>
                {months.map((m, j) => {
                  const cell = byKey.get(`${id}|${m}`);
                  const x = labelWidth + j * (cellWidth + gap);
                  const hasData = cell && cell.percent !== null;
                  const fill = hasData ? SEQUENTIAL[bandFor(cell!.percent!)]! : NO_DATA;
                  const lines = hasData
                    ? [`${cell!.percent!.toFixed(1)}% late or unfinished`,
                      `${cell!.numerator} of ${cell!.denominator} eligible reports due`]
                    : ['No eligible reports were due in this month.',
                      'Grey means unavailable or not applicable, not zero.'];
                  const isSelected = selected?.departmentId === id && selected?.month === m;
                  return (
                    <rect key={m} x={x} y={y} width={cellWidth} height={cellHeight} rx={3}
                      fill={fill}
                      stroke={isSelected ? 'var(--text-primary)' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                      tabIndex={0} role="button"
                      aria-label={`${name}, ${m}: ${lines.join(' ')}`}
                      onFocus={() => cell && setSelected(cell)}
                      onClick={() => cell && setSelected(cell)}
                      onMouseEnter={(e) => tooltip.show(e, `${name} — ${m}`, lines)}
                      onMouseMove={(e) => tooltip.show(e, `${name} — ${m}`, lines)}
                      onMouseLeave={tooltip.hide} />
                  );
                })}
              </g>
            );
          })}
        </ChartFrame>
      </div>

      <p className="muted" aria-live="polite">
        {selected
          ? (selected.percent === null
            ? `${selected.departmentName}, ${selected.month}: no eligible reports were due, so no `
              + 'rate is shown. Grey means unavailable, not zero.'
            : `${selected.departmentName}, ${selected.month}: ${selected.percent.toFixed(1)}% late `
              + `or unfinished (${selected.numerator}/${selected.denominator}).`)
          : 'Select a cell for its numerator and denominator.'}
      </p>

      <ChartTable caption={tableCaption}
        columns={['Department', 'Month', 'Late or unfinished', 'Numerator', 'Denominator']}
        rows={cells.map((c) => [c.departmentName, c.month,
          c.percent === null ? 'No eligible reports due' : `${c.percent.toFixed(1)}%`,
          c.numerator, c.denominator])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
