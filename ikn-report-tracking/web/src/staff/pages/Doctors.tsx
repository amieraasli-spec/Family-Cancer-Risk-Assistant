/**
 * Doctors and departments.
 *
 * What a doctor sees here is their own work and their own claims. What a head of
 * department, Records officer or director sees is departmental workload — never a
 * per-doctor performance ranking, which the scatter panel's own wording also rules
 * out.
 */
import { BarChart } from '../charts/BarChart.tsx';
import { ChartArea } from '../charts/ChartArea.tsx';
import { RateCard } from '../components/Cards.tsx';
import { DataTable, DeadlinePill, humanStatus, type Column } from '../components/DataTable.tsx';
import { FilterEchoStrip, Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';
import type { DepartmentsResponse, DoctorClaimItem, DoctorTask } from '../types.ts';

export function Doctors({ data, myTasks, myClaims, isDoctor, onTaskEvent }: {
  data: DepartmentsResponse | null;
  myTasks: { tasks: DoctorTask[]; notice: string } | null;
  myClaims: { items: DoctorClaimItem[]; notice: string } | null;
  isDoctor: boolean;
  onTaskEvent: (applicationId: string, event: string) => void;
}) {
  const pages: Subpage[] = [];

  if (isDoctor && myTasks) {
    const columns: Column<DoctorTask>[] = [
      { key: 'app', label: 'Application', render: (t) => t.application_id },
      { key: 'type', label: 'Report type', render: (t) => t.report_type },
      { key: 'stage', label: 'Stage', render: (t) => humanStatus(t.internal_status) },
      {
        key: 'due', label: 'My deadline', render: (t) => (
          <span className="muted">{t.original_doctor_due_at.slice(0, 10)}</span>
        ),
      },
      {
        key: 'act', label: 'Action', render: (t) => (
          <DoctorActions task={t} onEvent={onTaskEvent} />
        ),
      },
    ];
    pages.push({
      key: 'my-work',
      label: 'My work',
      render: () => (
        <Panel title="My assigned reports" unit="doctor tasks"
          captions={myWorkCaptions(myTasks.tasks)}>
          <p className="muted">{myTasks.notice}</p>
          <DataTable columns={columns} rows={myTasks.tasks.slice(0, 5)} page={1} pageSize={5}
            totalRows={myTasks.tasks.length} onPage={() => undefined}
            rowKey={(t) => t.task_id}
            caption="Earliest doctor deadline first. Acknowledging an assignment does not change
              the overall service deadline."
            emptyMessage="You have no open assignments." />
        </Panel>
      ),
    });
  }

  if (isDoctor && myClaims) {
    const columns: Column<DoctorClaimItem>[] = [
      { key: 'app', label: 'Report', render: (c) => c.application_id },
      { key: 'elig', label: 'Eligible since', render: (c) => c.eligible_at?.slice(0, 10) ?? '—' },
      { key: 'status', label: 'Payment status', render: (c) => c.paymentDisplay },
      { key: 'claimed', label: 'Claimed', numeric: true, render: (c) => `RM ${c.claimedAmountRm}` },
      { key: 'paid', label: 'Settled', numeric: true, render: (c) => `RM ${c.netPaidRm}` },
    ];
    pages.push({
      key: 'my-claims',
      label: 'My claims',
      render: () => (
        <Panel title="My claims and payment status" unit="claim items"
          captions={myClaimsCaptions(myClaims.items)}>
          <p className="muted">{myClaims.notice}</p>
          <DataTable columns={columns} rows={myClaims.items.slice(0, 5)} page={1} pageSize={5}
            totalRows={myClaims.items.length} onPage={() => undefined}
            rowKey={(c) => c.claim_item_id}
            caption='"Awaiting payment confirmation" means the claim is approved or instructed but
              no reconciled payment evidence has been recorded yet.'
            emptyMessage="You have no claim items." />
        </Panel>
      ),
    });
  }

  if (data) {
    pages.push(
      {
        key: 'workload',
        label: 'Department workload',
        render: () => (
          <Panel title="Overdue open applications by department" unit="applications"
            captions={data.overdue.captions}>
            <FilterEchoStrip echo={data.overdue.filter} />
            <ChartArea>{(h) => <BarChart height={h} valueColumnLabel="Overdue open applications"
              title="Overdue open applications by department"
              description={data.overdue.captions.whatThisShows}
              tableCaption="Open applications past their original deadline, by department."
              data={data.overdue.data.map((d) => ({
                key: d.departmentId, label: d.departmentName, value: d.overdueOpen,
                annotation: `${d.overdueOpen} of ${d.open} open`,
                tooltip: [`${d.overdueOpen} overdue of ${d.open} open at the cutoff`],
              }))} />}</ChartArea>
          </Panel>
        ),
      },
      {
        key: 'on-time',
        label: 'Department on-time',
        render: () => (
          <Panel title="On-time rate by department" unit="applications"
            captions={data.onTime.captions}>
            <FilterEchoStrip echo={data.onTime.filter} />
            <ChartArea>{(h) => <BarChart height={h} valueSuffix="%" valueColumnLabel="On-time rate"
              title="Due-cohort on-time rate by department"
              description={data.onTime.captions.whatThisShows}
              tableCaption="On-time rate with its numerator and denominator, by department."
              data={data.onTime.data.map((d) => ({
                key: d.departmentId,
                label: d.departmentName,
                value: d.onTime.applicable ? d.onTime.percent : 0,
                notApplicable: !d.onTime.applicable,
                annotation: d.onTime.applicable
                  ? `${d.onTime.percent.toFixed(1)}% (${d.onTime.numerator}/${d.onTime.denominator})`
                  : undefined,
                tooltip: d.onTime.applicable
                  ? [`${d.onTime.numerator} on time of ${d.onTime.denominator} due`]
                  : ['No eligible cases due in this period.'],
              }))} />}</ChartArea>
          </Panel>
        ),
      },
      {
        key: 'compliance',
        label: 'Doctor deadlines',
        render: () => (
          <Panel title="Doctor deadline compliance" unit="doctor tasks"
            captions={data.doctorCompliance.captions}>
            <FilterEchoStrip echo={data.doctorCompliance.filter} />
            <div className="cards">
              <RateCard metric={data.doctorCompliance.data} />
            </div>
            <div className="notice">
              The doctor allowance this is measured against is a prototype value, not an IKN rule
              (assumption 4 in the register). Delay is recorded against the stage that caused it,
              so a delay elsewhere in the workflow is not attributed to the doctor, and this figure
              is not a per-doctor score.
            </div>
          </Panel>
        ),
      },
    );
  }

  const nav = useSubpages(pages, 'doctors');
  if (pages.length === 0) {
    return <Panel title="Doctors" unit="—"><p className="muted">
      Nothing on this tab is available to your role.</p></Panel>;
  }
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {nav.active?.render()}
    </>
  );
}

/** The one action available on a task, given where it stands. */
function DoctorActions({ task, onEvent }: {
  task: DoctorTask; onEvent: (applicationId: string, event: string) => void;
}) {
  const next = (() => {
    if (task.internal_status === 'ASSIGNED') return { event: 'ACKNOWLEDGE', label: 'Acknowledge' };
    if (task.internal_status === 'ACKNOWLEDGED') {
      return { event: 'START_PREPARATION', label: 'Start preparation' };
    }
    if (task.internal_status === 'IN_PREPARATION') {
      return { event: 'SUBMIT_SIGNED', label: 'Submit signed report' };
    }
    return null;
  })();
  if (!next) return <span className="muted">Awaiting Records</span>;
  return (
    <button className="btn btn--primary" type="button" style={{ minHeight: 36 }}
      onClick={() => onEvent(task.application_id, next.event)}>
      {next.label}
    </button>
  );
}

/**
 * Captions for the doctor's own worklist, computed from the rows on screen.
 *
 * Both captions are mandatory on a table as much as on a chart, and the finding
 * is calculated — never a fixed sentence that happens to sound reassuring.
 */
function myWorkCaptions(tasks: DoctorTask[]) {
  const open = tasks.filter((t) => !t.accepted_completed_at);
  const unacknowledged = open.filter((t) => !t.acknowledged_at).length;
  const earliest = open
    .map((t) => t.original_doctor_due_at.slice(0, 10))
    .sort()[0];
  return {
    howToRead: 'one row per report assigned to you, with the stage it has reached and your own '
      + 'deadline for it. Your deadline is set so that Records still has time to check and '
      + 'release the report inside the overall service commitment.',
    whatThisShows: open.length === 0
      ? 'You have no open assignments.'
      : `You have ${open.length} open assignment${open.length === 1 ? '' : 's'}`
        + `${earliest ? `, the earliest due ${earliest}` : ''}`
        + `${unacknowledged > 0
          ? `; ${unacknowledged} ${unacknowledged === 1 ? 'is' : 'are'} not yet acknowledged` : ''}`
        + `. Showing ${Math.min(5, tasks.length)} of ${tasks.length} rows.`,
    dataClassNotice: 'Demonstration data — not actual IKN performance.',
  };
}

function myClaimsCaptions(items: DoctorClaimItem[]) {
  const unsubmitted = items.filter((c) => c.status === 'NOT_SUBMITTED').length;
  const awaiting = items.filter(
    (c) => c.paymentDisplay === 'Awaiting payment confirmation').length;
  const settledSen = items.reduce((sum, c) => sum + Math.round(Number(c.netPaidRm) * 100), 0);
  return {
    howToRead: 'one row per claim item of your own, with what you claimed, what was approved and '
      + 'what has actually been settled. Nothing on this page affects when the patient receives '
      + 'their report.',
    whatThisShows: items.length === 0
      ? 'You have no claim items.'
      : `You have ${items.length} claim item${items.length === 1 ? '' : 's'}: `
        + `${unsubmitted} with no claim form submitted and ${awaiting} awaiting payment `
        + `confirmation. RM ${(settledSen / 100).toFixed(2)} has been settled with reconciled `
        + `evidence. Showing ${Math.min(5, items.length)} of ${items.length} rows.`,
    dataClassNotice: 'Demonstration data — not actual IKN performance.',
  };
}
