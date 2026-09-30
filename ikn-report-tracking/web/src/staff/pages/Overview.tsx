/**
 * Overview: three short subpages rather than one crowded screen.
 *
 * Today (4 count cards) · Money & claims (4 mixed cards) · Queue health (the ratio
 * card plus the exception counts and the integration-freshness strip).
 */
import { CountCard, DistributionCard, MoneyCard, RateCard, RatioCard } from '../components/Cards.tsx';
import { CaptionBlock } from '../charts/primitives.tsx';
import { FilterEchoStrip, Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';
import type { OverviewResponse } from '../types.ts';

export function Overview({ data }: { data: OverviewResponse }) {
  const cards = data.cards.data;
  const health = data.queueHealth.data;

  const pages: Subpage[] = [
    {
      key: 'today',
      label: 'Today',
      render: () => (
        <Panel title="Activity and the open queue" unit="applications">
          <FilterEchoStrip echo={data.cards.filter} />
          <div className="cards">
            <CountCard metric={cards.page1.received} />
            <CountCard metric={cards.page1.completed} />
            <CountCard metric={cards.page1.openBacklog} />
            <CountCard metric={cards.page1.overdueOpen} />
          </div>
          <CaptionBlock captions={activityCaptions(data)} />
        </Panel>
      ),
    },
    {
      key: 'timeliness',
      label: 'Timeliness',
      render: () => (
        <Panel title="Timeliness" unit="applications and working days">
          <FilterEchoStrip echo={data.cards.filter} />
          <div className="cards">
            <RateCard metric={cards.page2.dueCohortOnTime} />
            <DistributionCard metric={cards.page2.turnaround} />
          </div>
          <CaptionBlock captions={timelinessCaptions(data)} />
        </Panel>
      ),
    },
    {
      key: 'money',
      label: 'Money & claims',
      render: () => (
        <Panel title="Claims and outstanding money" unit="claim items and RM">
          <FilterEchoStrip echo={data.cards.filter} />
          <div className="cards">
            <CountCard metric={cards.page2.eligibleUnclaimed} />
            <MoneyCard metric={cards.page2.approvedUnpaid} />
          </div>
          <CaptionBlock captions={moneyCaptions(data)} />
        </Panel>
      ),
    },
    {
      key: 'health',
      label: 'Queue health',
      render: () => (
        <Panel title="How much of the queue is late" unit="applications"
          captions={data.queueHealth.captions}>
          <FilterEchoStrip echo={data.queueHealth.filter} />
          <div className="cards">
            <RatioCard metric={health.ratio} label="Overdue open / all open, same cutoff" />
            <CountCard metric={health.incomplete} />
            <CountCard metric={health.unassignedComplete} />
            <CountCard metric={health.unacknowledged} />
          </div>
          {health.overdueAgainstRevised.value > 0 && (
            <p className="muted">
              Separately, {health.overdueAgainstRevised.value} open application
              {health.overdueAgainstRevised.value === 1 ? ' is' : 's are'} past an approved revised
              deadline. That figure is reported apart from the headline overdue count and is never
              blended into it.
            </p>
          )}
          <IntegrationStrip freshness={health.integrationFreshness} />
        </Panel>
      ),
    },
  ];

  const nav = useSubpages(pages, 'overview');
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {nav.active?.render()}
    </>
  );
}

/**
 * Integration freshness, shown rather than assumed.
 *
 * A manual import path is labelled as one. Failed notifications are surfaced here,
 * where the responsible officer will see them.
 */
function IntegrationStrip({ freshness }: { freshness: OverviewResponse['queueHealth']['data']['integrationFreshness'] }) {
  return (
    <div className="stack">
      <div className="notice">
        <strong>Integration status.</strong> {freshness.registration.notice}{' '}
        {freshness.finance.notice} {freshness.messaging.notice}
        {freshness.messaging.failedCount > 0 && (
          <> <strong>{freshness.messaging.failedCount} notification
            {freshness.messaging.failedCount === 1 ? '' : 's'} failed to deliver</strong> and need
            attention.</>
        )}
      </div>
      {freshness.recentImports.length > 0 && (
        <p className="muted">
          Most recent import: {freshness.recentImports[0]!.target_entity} at{' '}
          {freshness.recentImports[0]!.imported_at.slice(0, 16).replace('T', ' ')} —{' '}
          {freshness.recentImports[0]!.accepted_count} accepted,{' '}
          {freshness.recentImports[0]!.rejected_count} rejected,{' '}
          {freshness.recentImports[0]!.conflict_count} needing reconciliation
          ({freshness.recentImports[0]!.integration_mode.replace(/_/g, ' ').toLowerCase()}).
        </p>
      )}
    </div>
  );
}

/**
 * One caption for a group of four cards, composed from the card values.
 *
 * Each card's own caption comes from the server and is correct, but four of them
 * concatenated ran past the reserved caption space on a tablet and the tail was
 * cropped. These compose the same validated aggregates into a single sentence that
 * fits — the numbers are the server's, not the browser's.
 */
function activityCaptions(data: OverviewResponse) {
  const c = data.cards.data.page1;
  const period = data.cards.filter.periodLabel;
  const where = data.cards.filter.departmentLabel;
  const notice = data.cards.data.captions.received?.dataClassNotice;
  return {
    howToRead: 'four counts of applications for the selected month and cutoff: how many arrived, '
      + 'how many were verified complete, how many remain open, and how many of those are past '
      + 'their original deadline.',
    whatThisShows: `In ${period}, ${where}: ${c.received.value} applications received and `
      + `${c.completed.value} completed. At the cutoff ${c.openBacklog.value} remain open, of `
      + `which ${c.overdueOpen.value} ${c.overdueOpen.value === 1 ? 'is' : 'are'} past the `
      + 'original service deadline.',
    ...(notice ? { dataClassNotice: notice } : {}),
  };
}

function timelinessCaptions(data: OverviewResponse) {
  const c = data.cards.data.page2;
  const period = data.cards.filter.periodLabel;
  const where = data.cards.filter.departmentLabel;
  const notice = data.cards.data.captions.dueCohortOnTime?.dataClassNotice;
  const onTime = c.dueCohortOnTime.applicable
    ? `${c.dueCohortOnTime.percent.toFixed(1)}% (${c.dueCohortOnTime.numerator} of `
      + `${c.dueCohortOnTime.denominator})`
    : c.dueCohortOnTime.message;
  const turnaround = c.turnaround.applicable
    ? `median ${c.turnaround.median} working days, P90 ${c.turnaround.p90}, `
      + `n = ${c.turnaround.sampleSize}`
    : c.turnaround.message;
  return {
    howToRead: 'the share of the month’s due cohort verified complete on or before its original '
      + 'deadline, and how long the reports that finished actually took. Unfinished late '
      + 'applications sit in the on-time denominator.',
    whatThisShows: `${period}, ${where}: due-cohort on-time rate ${onTime}; turnaround `
      + `${turnaround}.`,
    ...(notice ? { dataClassNotice: notice } : {}),
  };
}

function moneyCaptions(data: OverviewResponse) {
  const c = data.cards.data.page2;
  const period = data.cards.filter.periodLabel;
  const where = data.cards.filter.departmentLabel;
  const notice = data.cards.data.captions.approvedUnpaid?.dataClassNotice;
  return {
    howToRead: 'eligible claim items with no form submitted, and approved claim value with no '
      + 'reconciled payment evidence. An approval or a payment instruction is not settlement, '
      + 'and neither figure affects when a patient receives their report.',
    whatThisShows: `${period}, ${where}: ${c.eligibleUnclaimed.value} eligible claim item`
      + `${c.eligibleUnclaimed.value === 1 ? ' has' : 's have'} no claim form submitted, and RM `
      + `${(c.approvedUnpaid.valueSen / 100).toFixed(2)} is approved without settlement evidence`
      + `${c.approvedUnpaid.inconsistencies.length > 0
        ? `, with ${c.approvedUnpaid.inconsistencies.length} item(s) where settlement exceeds `
          + 'approval and needs investigation' : ''}.`,
    ...(notice ? { dataClassNotice: notice } : {}),
  };
}
