/** Reports: worklist · queue composition · exceptions. */
import { ChartArea } from '../charts/ChartArea.tsx';
import { Donut } from '../charts/Donut.tsx';
import { DataTable, DeadlinePill, humanStatus, type Column } from '../components/DataTable.tsx';
import { FilterEchoStrip, Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';
import type { ReportsResponse, WorklistRow } from '../types.ts';

export function Reports({ data, page, onPage }: {
  data: ReportsResponse; page: number; onPage: (p: number) => void;
}) {
  const columns: Column<WorklistRow>[] = [
    { key: 'ref', label: 'Application', render: (r) => r.applicationId },
    { key: 'stage', label: 'Stage', render: (r) => humanStatus(r.stage) },
    { key: 'owner', label: 'Current owner', render: (r) => r.currentOwner },
    {
      key: 'deadline', label: 'Deadline', render: (r) => (
        <DeadlinePill remaining={r.workingDaysRemaining} overdue={r.workingDaysOverdue} />
      ),
    },
    { key: 'next', label: 'Next action', render: (r) => r.nextAction },
  ];

  const pages: Subpage[] = [
    {
      key: 'queue',
      label: 'Queue',
      render: () => (
        <Panel title="Open report queue" unit="applications" captions={data.worklist.captions}>
          <FilterEchoStrip echo={data.worklist.filter} />
          <DataTable
            columns={columns} rows={data.worklist.data.rows} page={page}
            pageSize={data.worklist.data.pageSize} totalRows={data.worklist.data.totalRows}
            onPage={onPage} rowKey={(r) => r.applicationId}
            caption="Sorted with the most overdue first, then by original deadline."
            emptyMessage="No eligible records for the selected filters." />
        </Panel>
      ),
    },
    {
      key: 'composition',
      label: 'Queue composition',
      render: () => (
        <Panel title="Where open work is waiting" unit="applications"
          captions={data.queueComposition.captions}>
          <FilterEchoStrip echo={data.queueComposition.filter} />
          <ChartArea>{(h) => <Donut
            slices={data.queueComposition.data.slices} total={data.queueComposition.data.total}
            height={h} unitLabel="applications"
            title="Open applications by current stage"
            description={`A donut of open applications split across mutually exclusive stages. `
              + data.queueComposition.captions.whatThisShows}
            tableCaption="Open applications by mutually exclusive current stage." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'exceptions',
      label: 'Exceptions',
      render: () => (
        <Panel title="Data-quality exceptions" unit="applications"
          captions={data.exceptions.captions}>
          <FilterEchoStrip echo={data.exceptions.filter} />
          {data.exceptions.data.length === 0 ? (
            <p className="muted">No data-quality exceptions for the selected filters.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <caption>
                  Each of these leaves a figure unmeasurable until it is corrected, so the
                  reported result is flattered while they stand.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Exception</th>
                    <th scope="col" className="num">Cases</th>
                    <th scope="col">Examples</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exceptions.data.map((e) => (
                    <tr key={e.code}>
                      <td>{e.label}</td>
                      <td className="num">{e.count}</td>
                      <td>{e.examples.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ),
    },
  ];

  const nav = useSubpages(pages, 'reports');
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {nav.active?.render()}
    </>
  );
}
