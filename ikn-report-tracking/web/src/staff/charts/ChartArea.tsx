/**
 * Gives a chart the height it actually has, instead of a height it hopes for.
 *
 * The tablet budget is enforced by the shell: the content row is the only one that
 * flexes, and it does not scroll. A chart with a fixed pixel height therefore either
 * leaves the panel short or gets clipped by the flex layout — which is what happened
 * to the heatmap, whose wrapper shrank to a quarter of the SVG's height and hid five
 * of its six rows.
 *
 * Sizing the plot is a two-pass measurement, because a chart is not only its plot: a
 * legend, a note about suppressed values and the table-view toggle all sit in the
 * same box, and how tall they are depends on how the text wraps at this width.
 *
 *   1. render at the floor height and measure what is actually on screen;
 *   2. chrome = total content height − plot height;
 *   3. give the plot everything the box has left after the chrome.
 *
 * It settles in one extra frame and re-runs whenever the box or the content changes,
 * so a language switch or a text-size change re-measures rather than overflows.
 *
 * `overflow: hidden` on the container is deliberate: if the arithmetic is ever
 * wrong, the browser-verification pass in `var/verify-ui.mjs` reports the clipped
 * pixels instead of the failure passing unnoticed.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The height below which a plot stops being readable at all. Above it the plot simply
 * takes what the box has left; below it the area stops drawing and points at the
 * table view, which carries every figure.
 */
const UNREADABLE_BELOW = 64;

export function ChartArea({ children, minHeight = 120 }: {
  children: (height: number) => ReactNode;
  /** Preferred plot height. A hint for the first paint, never a clamp — a plot that
   *  insisted on its preferred height would overflow the captions instead of
   *  yielding to them. */
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = useState(minHeight);
  const [cramped, setCramped] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const box = element.getBoundingClientRect().height;
    if (box <= 0) return;

    const plot = element.querySelector('svg.chart');
    const plotBox = plot ? plot.getBoundingClientRect().height : 0;
    // Everything in the box that is not the plot: legend, notes, table toggle.
    const chrome = Math.max(0, element.scrollHeight - plotBox);
    const next = Math.floor(box - chrome);

    setCramped(next < UNREADABLE_BELOW);
    const target = Math.max(UNREADABLE_BELOW, next);
    // A dead band stops a one-pixel disagreement between passes from looping.
    setPlotHeight((previous) => (Math.abs(previous - target) > 2 ? target : previous));
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div ref={ref} className="chart-area">
      {cramped ? (
        <p className="muted">
          There is not enough height to draw this chart at the current text size. Every figure is
          listed in the table view — reduce the text size to see the chart itself.
        </p>
      ) : children(plotHeight)}
    </div>
  );
}
