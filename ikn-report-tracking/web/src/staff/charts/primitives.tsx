/**
 * Chart primitives shared by every visual.
 *
 * Deliberately hand-written SVG rather than a charting library: the two mandatory
 * captions, the "grey means no data" rule, the suppression of small-sample medians
 * and the tablet height budget are all requirements a generic library would fight.
 *
 * Mark conventions, applied consistently:
 *   - 2px strokes on lines; markers at least 8px across
 *   - 4px rounded data-ends on bars, anchored to the baseline
 *   - a 2px surface gap between adjacent fills, and a 2px surface ring on
 *     overlapping marks — never a border drawn to separate them
 *   - solid hairline grid and axes, one shade off the surface (dashes are reserved
 *     for a threshold or a projection, where they carry meaning)
 *   - selective direct labels; the axis and the tooltip carry the rest
 */
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import type { Captions } from '../types.ts';

/** The categorical slots this application uses, in fixed order. */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/** Sequential blue ramp for magnitude. Index 0 is nearest the surface. */
export const SEQUENTIAL = [
  'var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)',
  'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)',
];

export const NO_DATA = 'var(--no-data)';

/** Both mandatory captions, rendered in reserved space beneath every output. */
export function CaptionBlock({ captions }: { captions: Captions }) {
  return (
    <div className="captions">
      <span><span className="captions__label">How to read this:</span> {captions.howToRead}</span>
      <span><span className="captions__label">What this shows:</span> {captions.whatThisShows}</span>
      {captions.dataClassNotice && (
        <span className="captions__notice">{captions.dataClassNotice}</span>
      )}
    </div>
  );
}

export interface TooltipState { x: number; y: number; title: string; lines: string[] }

/** A single floating tooltip, positioned in viewport coordinates. */
export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  const left = Math.min(state.x + 12, window.innerWidth - 270);
  const top = Math.max(8, state.y - 12);
  return (
    <div className="tooltip" style={{ left, top }} role="tooltip">
      <div className="tooltip__title">{state.title}</div>
      {state.lines.map((line) => <div key={line}>{line}</div>)}
    </div>
  );
}

export function useTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, title: string, lines: string[]) => {
    setState({ x: e.clientX, y: e.clientY, title, lines });
  }, []);
  const hide = useCallback(() => setState(null), []);
  return { state, show, hide };
}

/** Legend for two or more series. Colour is never the only channel. */
export function Legend({ items }: {
  items: { label: string; colour: string; shape?: 'line' | 'block' | 'dashed' }[];
}) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="legend__item" key={i.label}>
          <span
            className={`legend__swatch${i.shape === 'line' || i.shape === 'dashed' ? ' legend__swatch--line' : ''}`}
            style={{
              background: i.shape === 'dashed'
                ? `repeating-linear-gradient(90deg, ${i.colour} 0 5px, transparent 5px 9px)`
                : i.colour,
            }}
            aria-hidden="true"
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The table equivalent of a chart, reachable from every panel.
 *
 * It is the documented relief for the light-mode palette slots that sit below 3:1
 * against the surface, and it is how a screen-reader user gets the same figures.
 */
export function ChartTable({ columns, rows, caption }: {
  columns: string[]; rows: (string | number)[][]; caption: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button className="btn" type="button" aria-expanded={open} aria-controls={id}
        style={{ minHeight: 34, fontSize: 'var(--font-micro)' }}
        onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide the figures' : 'Show the figures as a table'}
      </button>
      {open && (
        <div className="table-wrap" id={id} style={{ marginTop: 8 }}>
          <table className="data">
            <caption>{caption}</caption>
            <thead>
              <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${String(r[0])}-${i}`}>
                  {r.map((cell, j) => (
                    <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Nice axis ticks: at most `count`, on a 1/2/5 × 10^n step. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export function useChartGeometry(width: number, height: number, margin: {
  top: number; right: number; bottom: number; left: number;
}) {
  return useMemo(() => ({
    width, height, margin,
    innerWidth: Math.max(1, width - margin.left - margin.right),
    innerHeight: Math.max(1, height - margin.top - margin.bottom),
  }), [width, height, margin]);
}

/** Wraps a chart with its accessible name and a screen-reader description. */
export function ChartFrame({ title, description, viewBox, height, children }: {
  title: string; description: string; viewBox: string; height: number; children: ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  return (
    <svg className="chart" viewBox={viewBox} role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ height, maxHeight: height }} preserveAspectRatio="xMidYMid meet">
      <title id={titleId}>{title}</title>
      <desc id={descId}>{description}</desc>
      {children}
    </svg>
  );
}

/** Shortens a `YYYY-MM` key for an axis tick. */
export function shortMonth(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][m - 1]}${month.slice(2, 4)}`;
}
