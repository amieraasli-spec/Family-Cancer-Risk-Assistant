/**
 * Finance: claim pipeline · approved unpaid by department · three ageing tables.
 *
 * The unit of analysis is the claim item throughout, and money is never aggregated
 * at application level — one application can carry several eligible items.
 */
import { BarChart } from '../charts/BarChart.tsx';
import { ChartArea } from '../charts/ChartArea.tsx';
import { DistributionCard, RateCard } from '../components/Cards.tsx';
import { DataTable, humanStatus, type Column } from '../components/DataTable.tsx';
import { FilterEchoStrip, Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';
import type { AgeingRow, FinanceResponse, Panel as PanelType } from '../types.ts';

const ageingColumns: Column<AgeingRow>[] = [
  { key: 'bucket', label: 'Ageing band', render: (r) => r.bucket },
  { key: 'count', label: 'Items', numeric: true, render: (r) => r.count },
  { key: 'amount', label: 'RM', numeric: true, render: (r) => r.amountRm },
  { key: 'owner', label: 'Who acts next', render: (r) => r.actionOwner },
];

export function Finance({ data, page, onPage }: {
  data: FinanceResponse; page: number; onPage: (p: number) => void;
}) {
  const ageingPanel = (
    panel: PanelType<{ rows: AgeingRow[]; page: number; pageSize: number; totalRows: number }>,
    title: string, caption: string,
  ) => (
    <Panel title={title} unit="claim items" captions={panel.captions}>
      <FilterEchoStrip echo={panel.filter} />
      <DataTable columns={ageingColumns} rows={panel.data.rows} page={panel.data.page}
        pageSize={panel.data.pageSize} totalRows={panel.data.totalRows} onPage={onPage}
        rowKey={(r) => r.bucket} caption={caption}
        emptyMessage="No eligible records for the selected filters." />
    </Panel>
  );

  const pages: Subpage[] = [
    {
      key: 'pipeline',
      label: 'Claim pipeline',
      render: () => (
        <Panel title="Claim items by stage" unit="claim items" captions={data.pipeline.captions}>
          <FilterEchoStrip echo={data.pipeline.filter} />
          <ChartArea>{(h) => <BarChart height={h} valueColumnLabel="Claim items"
            title="Eligible claim items by claim stage"
            description={data.pipeline.captions.whatThisShows}
            tableCaption="Eligible claim items at each stage of the claim workflow."
            data={data.pipeline.data.map((s) => ({
              key: s.status, label: humanStatus(s.status), value: s.count,
              tooltip: [`${s.count} eligible claim items at ${humanStatus(s.status)}`],
            }))} />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'unpaid',
      label: 'Approved unpaid',
      render: () => (
        <Panel title="Approved but unpaid, by department" unit="RM"
          captions={data.approvedUnpaidByDepartment.captions}>
          <FilterEchoStrip echo={data.approvedUnpaidByDepartment.filter} />
          <ChartArea>{(h) => <BarChart height={h} valueColumnLabel="RM outstanding"
            title="Approved claim value with no reconciled payment evidence, by department"
            description={data.approvedUnpaidByDepartment.captions.whatThisShows}
            tableCaption="Approved amount less reconciled net payments, by department."
            data={data.approvedUnpaidByDepartment.data.map((d) => ({
              key: d.departmentId, label: d.departmentName, value: d.amountSen / 100,
              annotation: `RM ${d.amountRm}`,
              tooltip: [`RM ${d.amountRm} approved with no settlement evidence`],
            }))} />}</ChartArea>
          <p className="muted">
            An approval, a voucher or a payment instruction is not evidence that money moved. These
            balances clear only when a payment reference, amount and payment date are reconciled.
          </p>
        </Panel>
      ),
    },
    {
      key: 'coverage',
      label: 'Coverage & turnaround',
      render: () => (
        <Panel title="Claim submission coverage and finance turnaround" unit="claim items"
          captions={data.submissionCoverage.captions}>
          <FilterEchoStrip echo={data.submissionCoverage.filter} />
          <div className="cards">
            <RateCard metric={data.submissionCoverage.data} />
            <DistributionCard metric={data.financeTurnaround.data} />
          </div>
          <p className="muted">{data.financeTurnaround.captions.whatThisShows}</p>
          <div className="notice notice--info">
            Finance turnaround is reported without a target: no finance processing allowance was
            supplied, and inventing one would create a judgement nobody approved.
          </div>
        </Panel>
      ),
    },
    {
      key: 'ageing-unclaimed',
      label: 'Ageing: unclaimed',
      render: () => ageingPanel(data.ageingUnclaimed, 'Eligible items with no claim submitted',
        'Days since the item became eligible. A report is released to the applicant regardless of '
        + 'anything on this page.'),
    },
    {
      key: 'ageing-finance',
      label: 'Ageing: with Finance',
      render: () => ageingPanel(data.ageingWithFinance, 'Submitted items awaiting settlement',
        'Days since Finance received the claim.'),
    },
    {
      key: 'ageing-unpaid',
      label: 'Ageing: approved unpaid',
      render: () => ageingPanel(data.ageingApprovedUnpaid, 'Approved items with no payment evidence',
        'Days since the item was approved.'),
    },
  ];

  const nav = useSubpages(pages, 'finance');
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {nav.active?.render()}
    </>
  );
}
