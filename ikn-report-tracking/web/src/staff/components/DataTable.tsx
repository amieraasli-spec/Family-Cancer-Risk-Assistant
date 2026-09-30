/**
 * Compact paginated table.
 *
 * Five rows by default, because that is what fits on a 10-inch tablet in portrait
 * alongside a title and two captions. The footer distinguishes the rows on this
 * page from the total filtered cohort, which a caption alone would not do.
 */
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns, rows, page, pageSize, totalRows, onPage, caption, emptyMessage, rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  onPage: (page: number) => void;
  caption: string;
  emptyMessage: string;
  rowKey: (row: T) => string;
}) {
  const lastPage = Math.max(1, Math.ceil(totalRows / pageSize));
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalRows, page * pageSize);

  if (totalRows === 0) return <p className="muted">{emptyMessage}</p>;

  return (
    <div className="stack grow">
      <div className="table-wrap">
        <table className="data">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn" type="button" disabled={page <= 1}
          onClick={() => onPage(page - 1)} style={{ minHeight: 38 }}>← Previous rows</button>
        <span className="muted">
          Rows {from}–{to} of {totalRows} in the filtered cohort
        </span>
        <button className="btn" type="button" disabled={page >= lastPage}
          onClick={() => onPage(page + 1)} style={{ minHeight: 38 }}>Next rows →</button>
      </div>
    </div>
  );
}

/** Days-remaining / days-overdue indicator, with an icon so colour is not alone. */
export function DeadlinePill({ remaining, overdue }: {
  remaining: number | null; overdue: number;
}) {
  if (overdue > 0) {
    return (
      <span className="pill pill--overdue">
        <span aria-hidden="true">▲</span> {overdue} wd overdue
      </span>
    );
  }
  if (remaining === null) return <span className="pill">No deadline yet</span>;
  if (remaining === 0) return <span className="pill pill--due"><span aria-hidden="true">●</span> Due today</span>;
  if (remaining <= 3) {
    return <span className="pill pill--due"><span aria-hidden="true">●</span> {remaining} wd left</span>;
  }
  return <span className="pill pill--ok"><span aria-hidden="true">✓</span> {remaining} wd left</span>;
}

export function humanStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}
