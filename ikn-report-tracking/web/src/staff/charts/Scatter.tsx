/**
 * Workload scatter: one point per department-month.
 *
 * A single hue throughout. Colouring by department would need six categorical
 * slots on an all-pairs adjacency, which the palette cannot carry safely past
 * three — and colour is not needed here, because the panel is for investigating
 * capacity, not for identifying a culprit. Identity comes from hover and from the
 * table.
 *
 * The two axes describe **different cohorts** — x counts assignments made in the
 * month, y summarises tasks completed in it — which the caption states. Medians
 * below the configured minimum sample size are suppressed and shown on the
 * baseline as "n too small".
 */
import type { ScatterPoint } from '../types.ts';
import { ChartFrame, ChartTable, niceTicks, SERIES, Tooltip, useTooltip } from './primitives.tsx';

export function Scatter({ points, minSampleSize, height, title, description, tableCaption }: {
  points: ScatterPoint[]; minSampleSize: number; height: number; title: string;
  description: string; tableCaption: string;
}) {
  const tooltip = useTooltip();
  const width = 640;
  const margin = { top: 16, right: 18, bottom: 46, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const plotHeight = Math.max(80, height - margin.top - margin.bottom - 26);

  const plotted = points.filter((p) => p.medianDoctorTurnaround !== null);
  const suppressed = points.filter((p) => p.suppressed);

  const xMax = Math.max(1, ...points.map((p) => p.assignedInMonth));
  const yMax = Math.max(1, ...plotted.map((p) => p.medianDoctorTurnaround ?? 0));
  const xTicks = niceTicks(xMax);
  const yTicks = niceTicks(yMax);
  const xScaleMax = Math.max(xMax, xTicks[xTicks.length - 1] ?? xMax);
  const yScaleMax = Math.max(yMax, yTicks[yTicks.length - 1] ?? yMax);
  const sizeMax = Math.max(1, ...points.map((p) => p.completedTasks));

  const x = (v: number) => margin.left + (v / xScaleMax) * innerWidth;
  const y = (v: number) => margin.top + plotHeight - (v / yScaleMax) * plotHeight;
  // Area-proportional radius, floored at 4px so every point stays ≥8px across.
  const r = (n: number) => 4 + Math.sqrt(n / sizeMax) * 7;

  return (
    <div className="stack">
      <ChartFrame title={title} description={description} height={height}
        viewBox={`0 0 ${width} ${margin.top + plotHeight + margin.bottom}`}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={margin.left} y1={y(t)} x2={width - margin.right} y2={y(t)} className="grid-line" />
            <text x={margin.left - 6} y={y(t) + 4} textAnchor="end" className="axis-label">{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={margin.top + plotHeight + 16} textAnchor="middle"
            className="axis-label">{t}</text>
        ))}

        {plotted.map((p) => (
          <circle key={`${p.departmentId}|${p.month}`}
            cx={x(p.assignedInMonth)} cy={y(p.medianDoctorTurnaround!)} r={r(p.completedTasks)}
            fill={SERIES[0]} fillOpacity={0.62}
            /* A 2px surface ring keeps overlapping points readable. */
            stroke="var(--surface-1)" strokeWidth={2}
            onMouseEnter={(e) => tooltip.show(e, `${p.departmentName} — ${p.month}`, [
              `${p.assignedInMonth} applications assigned during the month`,
              `median doctor-task turnaround ${p.medianDoctorTurnaround} working days`,
              `${p.completedTasks} tasks completed in the month`,
            ])}
            onMouseMove={(e) => tooltip.show(e, `${p.departmentName} — ${p.month}`, [
              `${p.assignedInMonth} applications assigned during the month`,
              `median doctor-task turnaround ${p.medianDoctorTurnaround} working days`,
              `${p.completedTasks} tasks completed in the month`,
            ])}
            onMouseLeave={tooltip.hide} />
        ))}

        {/* Suppressed department-months are shown on the baseline as open marks, so a
            small sample is visible rather than absent. */}
        {suppressed.map((p) => (
          <g key={`s-${p.departmentId}|${p.month}`}>
            <circle cx={x(p.assignedInMonth)} cy={margin.top + plotHeight} r={4}
              fill="none" stroke="var(--text-muted)" strokeWidth={2}
              onMouseEnter={(e) => tooltip.show(e, `${p.departmentName} — ${p.month}`, [
                `${p.completedTasks} completed tasks — fewer than the minimum of ${minSampleSize}`,
                'No median is published for this department-month.',
              ])}
              onMouseMove={(e) => tooltip.show(e, `${p.departmentName} — ${p.month}`, [
                `${p.completedTasks} completed tasks — fewer than the minimum of ${minSampleSize}`,
                'No median is published for this department-month.',
              ])}
              onMouseLeave={tooltip.hide} />
          </g>
        ))}

        <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right}
          y2={margin.top + plotHeight} className="axis-line" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight}
          className="axis-line" />
        <text x={margin.left + innerWidth / 2} y={margin.top + plotHeight + 34}
          textAnchor="middle" className="axis-label">
          Applications assigned during the month
        </text>
        <text x={margin.left} y={margin.top - 5} className="axis-label">
          Median doctor-task turnaround (working days, tasks completed that month)
        </text>
      </ChartFrame>

      {/* The cohort warning, the causation warning and the suppression rule are all in
          the mandatory "how to read this" caption below the panel. Repeating them here
          cost the plot a third of its height without telling the reader anything new. */}
      <p className="muted">
        Point size is the number of tasks completed that month; open marks on the baseline are
        department-months with fewer than {minSampleSize} completed tasks.
      </p>

      <ChartTable caption={tableCaption}
        columns={['Department', 'Month', 'Assigned', 'Median turnaround', 'Completed tasks']}
        rows={points.map((p) => [p.departmentName, p.month, p.assignedInMonth,
          p.medianDoctorTurnaround === null
            ? `Suppressed — fewer than ${minSampleSize} completed tasks`
            : p.medianDoctorTurnaround,
          p.completedTasks])} />
      <Tooltip state={tooltip.state} />
    </div>
  );
}
