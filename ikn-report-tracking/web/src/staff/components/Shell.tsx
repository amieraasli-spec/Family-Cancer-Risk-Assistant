/**
 * The staff shell: data-class banner, header, five tabs, a subpage strip with
 * Previous/Next, and the shared filter bar.
 *
 * The height budget is enforced structurally rather than by hope: the shell is a
 * CSS grid at `100dvh`, the content row is the only one that flexes, and it has
 * `overflow: hidden`. A page that would not fit cannot scroll the shell — it has to
 * reduce its own density, which is what each page does.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Captions, FilterEcho } from '../types.ts';
import { CaptionBlock } from '../charts/primitives.tsx';

export interface Subpage {
  key: string;
  label: string;
  render: () => ReactNode;
}

export function SubpageNav({ pages, current, onSelect }: {
  pages: Subpage[]; current: string; onSelect: (key: string) => void;
}) {
  const index = Math.max(0, pages.findIndex((p) => p.key === current));
  /*
   * The chips and Previous/Next share one row. They were two rows, which cost ~90px
   * of the tablet's height budget for navigation the reader can already see — and
   * that height belongs to the chart.
   */
  return (
    <nav className="subnav" aria-label="Subpages">
      <button className="subnav__step" type="button" disabled={index === 0}
        aria-label="Previous subpage"
        onClick={() => onSelect(pages[index - 1]!.key)}>←</button>
      <div className="subnav__chips">
        {pages.map((p) => (
          <button key={p.key} type="button" className="subnav__btn"
            aria-current={p.key === current} onClick={() => onSelect(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <span className="subnav__count">{index + 1}/{pages.length}</span>
      <button className="subnav__step" type="button" disabled={index >= pages.length - 1}
        aria-label="Next subpage"
        onClick={() => onSelect(pages[index + 1]!.key)}>→</button>
    </nav>
  );
}

/** Uses a subpage list with Previous/Next, remembering the page per tab. */
export function useSubpages(pages: Subpage[], storageKey: string) {
  const [current, setCurrent] = useState(() => pages[0]?.key ?? '');
  useEffect(() => {
    if (!pages.some((p) => p.key === current)) setCurrent(pages[0]?.key ?? '');
  }, [pages, current]);
  const active = useMemo(
    () => pages.find((p) => p.key === current) ?? pages[0], [pages, current]);
  return { current, setCurrent, active, storageKey };
}

/** A panel with its title, unit of analysis, body and both mandatory captions. */
export function Panel({ title, unit, captions, children, headerExtra }: {
  title: string; unit: string; captions?: Captions; children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">{title}</h2>
        <span className="panel__unit">Unit of analysis: {unit}</span>
      </div>
      {headerExtra}
      <div className="panel__body">{children}</div>
      {captions && <CaptionBlock captions={captions} />}
    </section>
  );
}

/** The data-as-of strip, printed on every tab so a screenshot is self-describing. */
export function FilterEchoStrip({ echo }: { echo: FilterEcho }) {
  return (
    <p className="muted">
      {echo.periodLabel} · {echo.departmentLabel} · {echo.reportTypeLabel} · data as of{' '}
      {new Date(echo.dataAsOf).toISOString().replace('T', ' ').slice(0, 16)} ·{' '}
      SLA {echo.slaRuleVersion} · calendar {echo.calendarVersion} · formula {echo.formulaVersion}
    </p>
  );
}
