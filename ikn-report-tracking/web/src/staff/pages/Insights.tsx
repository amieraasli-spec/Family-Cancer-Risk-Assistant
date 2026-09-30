/** Insights: KPIs · Trends · Turnaround · Workload · Heatmap · Forecast · Actions. */
import { ChartArea } from '../charts/ChartArea.tsx';
import { ForecastChart } from '../charts/ForecastChart.tsx';
import { Heatmap } from '../charts/Heatmap.tsx';
import { Histogram } from '../charts/Histogram.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { Scatter } from '../charts/Scatter.tsx';
import { SERIES } from '../charts/primitives.tsx';
import { FilterEchoStrip, Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';
import type { ActionsData, ForecastData, InsightsResponse, MetricDefinition, Panel as PanelType,
  RateMetric } from '../types.ts';

export function Insights({ data, forecast, actions, onDecision }: {
  data: InsightsResponse;
  forecast: PanelType<ForecastData> | null;
  actions: PanelType<ActionsData> | null;
  onDecision: (key: string, decision: 'ACCEPTED' | 'DECLINED' | 'DEFERRED') => void;
}) {
  const pages: Subpage[] = [
    { key: 'kpis', label: 'KPIs', render: () => <Kpis panel={data.kpis} /> },
    {
      key: 'trends',
      label: 'Trends',
      render: () => (
        <Panel title="Monthly received and completed" unit="applications"
          captions={data.trend.captions}>
          <FilterEchoStrip echo={data.trend.filter} />
          <ChartArea>{(h) => <LineChart height={h} yLabel="Applications"
            labels={data.trend.data.map((d) => d.month)}
            series={[
              { key: 'received', label: 'Received', colour: SERIES[0]!,
                values: data.trend.data.map((d) => d.received) },
              { key: 'completed', label: 'Completed', colour: SERIES[1]!,
                values: data.trend.data.map((d) => d.completed) },
            ]}
            title="Monthly applications received and completed"
            description={data.trend.captions.whatThisShows}
            tableCaption="Both series are counts of applications on one axis." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'timeliness',
      label: 'Timeliness',
      render: () => (
        <Panel title="Due-cohort on-time rate by month" unit="applications"
          captions={data.timeliness.captions}>
          <FilterEchoStrip echo={data.timeliness.filter} />
          <ChartArea>{(h) => <LineChart height={h} yLabel="Per cent" valueSuffix="%" maxOverride={100}
            labels={data.timeliness.data.series.map((s) => s.month)}
            series={[{
              key: 'ontime', label: 'On-time rate', colour: SERIES[0]!,
              values: data.timeliness.data.series.map((s) => percentOrNull(s.rate)),
            }]}
            referenceLine={{
              value: data.timeliness.data.targetPercent,
              label: `${data.timeliness.data.targetPercent}% reference`,
            }}
            title="Due-cohort on-time rate against the configured reference target"
            description={data.timeliness.captions.whatThisShows}
            tableCaption="Months with no eligible cases are shown as not applicable." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'turnaround',
      label: 'Turnaround',
      render: () => (
        <Panel title="Completed-report turnaround" unit="applications"
          captions={data.turnaround.captions}>
          <FilterEchoStrip echo={data.turnaround.filter} />
          <ChartArea>{(h) => <Histogram height={h} bins={data.turnaround.data.bins}
            total={data.turnaround.data.total} unitLabel="completed reports"
            title="Turnaround of completed reports, in working-day bands"
            description={data.turnaround.captions.whatThisShows}
            tableCaption="Working days from a complete application to verified completion." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'ageing',
      label: 'Open ageing',
      render: () => (
        <Panel title="Open-report ageing" unit="applications" captions={data.openAgeing.captions}>
          <FilterEchoStrip echo={data.openAgeing.filter} />
          <ChartArea>{(h) => <Histogram height={h} bins={data.openAgeing.data.bins}
            total={data.openAgeing.data.total} unitLabel="open reports"
            title="Age of open reports, in working-day bands"
            description={data.openAgeing.captions.whatThisShows}
            tableCaption="Working days since the application became complete, at the cutoff. This
              is unfinished work, not turnaround." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'workload',
      label: 'Workload',
      render: () => (
        <Panel title="Workload and doctor-task turnaround" unit="department-months"
          captions={data.workload.captions}>
          <FilterEchoStrip echo={data.workload.filter} />
          <ChartArea>{(h) => <Scatter height={h} points={data.workload.data.points}
            minSampleSize={data.workload.data.minSampleSize}
            title="Applications assigned against median doctor-task turnaround, by department-month"
            description={data.workload.captions.whatThisShows}
            tableCaption="One row per department-month. Suppressed medians are marked." />}</ChartArea>
        </Panel>
      ),
    },
    {
      key: 'heatmap',
      label: 'Heatmap',
      render: () => (
        <Panel title="Late-or-unfinished rate by department and month" unit="applications"
          captions={data.heatmap.captions}>
          <FilterEchoStrip echo={data.heatmap.filter} />
          <ChartArea>{(h) => <Heatmap height={h} cells={data.heatmap.data.cells} months={data.heatmap.data.months}
            title="Late or unfinished reports as a share of each month's due cohort, by department"
            description={data.heatmap.captions.whatThisShows}
            tableCaption="Late-or-unfinished rate with its numerator and denominator." />}</ChartArea>
        </Panel>
      ),
    },
  ];

  if (forecast) {
    pages.push(
      { key: 'forecast', label: 'Forecast', render: () => <Forecast panel={forecast} /> },
      { key: 'forecast-model', label: 'Model & validation',
        render: () => <ForecastModel panel={forecast} /> },
    );
  }
  if (actions) {
    pages.push({
      key: 'actions', label: 'Actions',
      render: () => <Actions panel={actions} onDecision={onDecision} />,
    });
  }

  const nav = useSubpages(pages, 'insights');
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {nav.active?.render()}
    </>
  );
}

function percentOrNull(rate: RateMetric): number | null {
  return rate.applicable ? rate.percent : null;
}

/** The metric dictionary, rendered one metric at a time so the page fits. */
function Kpis({ panel }: { panel: InsightsResponse['kpis'] }) {
  const definitions: MetricDefinition[] = panel.data.dictionary;
  return (
    <Panel title="KPI definitions and values" unit="mixed (labelled per metric)"
      captions={panel.captions}>
      <FilterEchoStrip echo={panel.filter} />
      <div className="notice">
        No metric here is labelled an official KKM KPI or an approved IKN target.{' '}
        {panel.data.targetProvenance}
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>
            Formula version {panel.data.formulaVersion}. Each metric shows its definition, its
            numerator and denominator, and the cases it excludes.
          </caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Value</th>
              <th scope="col">Definition, numerator and denominator</th>
              <th scope="col">Authority</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.key}>
                <td><strong>{d.label}</strong><br /><span className="muted">{d.unit}</span></td>
                <td>{renderValue(panel.data.values[d.key])}</td>
                <td>
                  {d.definition}
                  {d.numerator && <><br /><span className="muted">Numerator: {d.numerator}</span></>}
                  {d.denominator && <><br /><span className="muted">Denominator: {d.denominator}</span></>}
                  {d.exclusions.length > 0 && (
                    <><br /><span className="muted">Excludes: {d.exclusions.join('; ')}</span></>
                  )}
                  {d.notes && <><br /><span className="muted">{d.notes}</span></>}
                </td>
                <td>{d.authority.replace(/_/g, ' ').toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {panel.data.excludedCases.length > 0 && (
        <div className="notice notice--info">
          <strong>Excluded cases.</strong>{' '}
          {panel.data.excludedCases.map((e) => `${e.count} — ${e.reason}`).join(' ')}
        </div>
      )}
    </Panel>
  );
}

function renderValue(metric: unknown): string {
  if (!metric || typeof metric !== 'object') return '—';
  const m = metric as Record<string, unknown>;
  if (m.kind === 'count') return String(m.value);
  if (m.kind === 'rate') {
    return m.applicable
      ? `${(m.percent as number).toFixed(1)}% (${m.numerator}/${m.denominator})`
      : String(m.message);
  }
  if (m.kind === 'distribution') {
    return m.applicable
      ? `median ${m.median}, P90 ${m.p90}, n = ${m.sampleSize}`
      : String(m.message);
  }
  if (m.kind === 'money') return `RM ${((m.valueSen as number) / 100).toFixed(2)}`;
  if ('rate' in m && 'enquiryCount' in m) {
    const rate = m.rate as RateMetric;
    const count = (m.enquiryCount as { value: number }).value;
    return rate.applicable
      ? `${rate.percent.toFixed(1)} per 100 (${count} enquiries / ${rate.denominator} received)`
      : rate.message;
  }
  return '—';
}

function Forecast({ panel }: { panel: PanelType<ForecastData> }) {
  const d = panel.data;
  if ('available' in d && d.available === false) {
    return (
      <Panel title="Monthly application forecast" unit="applications" captions={panel.captions}>
        <FilterEchoStrip echo={panel.filter} />
        <div className="notice notice--critical">
          <strong>{d.message}</strong><br />
          {d.completeMonths} complete month{d.completeMonths === 1 ? '' : 's'} of history are
          available and {d.requiredMonths} are required. A missing month is unknown, not zero, so no
          forecast is shown rather than one fitted to gaps.
        </div>
      </Panel>
    );
  }
  const { forecast } = d as Extract<ForecastData, { scenario: unknown }>;
  return (
    <Panel title="Monthly application forecast" unit="applications" captions={panel.captions}>
      <FilterEchoStrip echo={panel.filter} />
      <ChartArea minHeight={150}>{(h) => <ForecastChart height={h} history={forecast.history}
        points={forecast.points} selectedModel={forecast.selectedModel}
        title="Observed monthly applications with the forecast and its prediction intervals"
        description={panel.captions.whatThisShows}
        tableCaption="Observed history and the forecast with its 80% and 95% intervals." />}</ChartArea>
    </Panel>
  );
}

/**
 * How the forecast was produced, on its own subpage.
 *
 * The training window, the fitted parameters, the rolling-origin backtest against the
 * baseline and the backlog scenario are what make the forecast auditable — but they
 * are a table, and a table and a chart do not share one tablet screen.
 */
function ForecastModel({ panel }: { panel: PanelType<ForecastData> }) {
  const d = panel.data;
  if ('available' in d && d.available === false) {
    return (
      <Panel title="Forecast model and validation" unit="applications" captions={panel.captions}>
        <div className="notice notice--critical">
          <strong>{d.message}</strong> No model was fitted, so there is nothing to validate.
        </div>
      </Panel>
    );
  }
  const { forecast, scenario } = d as Extract<ForecastData, { scenario: unknown }>;
  const validation = forecast.selectedModel === 'ETS_A_Ad_N'
    ? forecast.validation.ets : forecast.validation.baseline;
  return (
    <Panel title="Forecast model and validation" unit="applications" captions={panel.captions}>
      <FilterEchoStrip echo={panel.filter} />
      <div className="table-wrap">
        <table className="data">
          <caption>
            Model selection and validation. {forecast.modelSelectionReason}
          </caption>
          <tbody>
            <tr><th scope="row">Training window</th>
              <td>{forecast.trainingFrom} to {forecast.trainingTo}
                ({forecast.history.length} complete months)</td></tr>
            <tr><th scope="row">Forecast generated</th>
              <td>{forecast.forecastGeneratedAt.slice(0, 16).replace('T', ' ')}</td></tr>
            <tr><th scope="row">Horizon</th><td>{forecast.horizonMonths} months</td></tr>
            <tr><th scope="row">Model shown</th>
              <td>{forecast.selectedModel === 'ETS_A_Ad_N'
                ? 'ETS(A,Ad,N) — additive error, additive damped trend, no seasonality'
                : 'Trailing 3-month mean (baseline)'}</td></tr>
            {forecast.etsParameters && (
              <tr><th scope="row">Fitted parameters</th>
                <td>α = {forecast.etsParameters.alpha}, β = {forecast.etsParameters.beta},
                  φ = {forecast.etsParameters.phi}</td></tr>
            )}
            <tr><th scope="row">Backtest (rolling origin)</th>
              <td>
                ETS MAE {forecast.validation.ets.mae.toFixed(2)} applications
                {forecast.validation.ets.wape !== null
                  && `, WAPE ${forecast.validation.ets.wape.toFixed(1)}%`}
                <br />
                Baseline MAE {forecast.validation.baseline.mae.toFixed(2)} applications
                {forecast.validation.baseline.wape !== null
                  && `, WAPE ${forecast.validation.baseline.wape.toFixed(1)}%`}
                <br />
                <span className="muted">
                  {validation.origins.length} origins, each forecast from earlier data only.
                  {forecast.validation.ets.wape === null
                    && ' WAPE is withheld where total actual volume was zero.'}
                </span>
              </td></tr>
            <tr><th scope="row">Boundary handling</th><td>{forecast.boundaryHandling}</td></tr>
            <tr><th scope="row">Seasonality</th><td>{forecast.seasonalityNotice}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="notice">
        <strong>Backlog scenario — not a forecast.</strong> Starting from{' '}
        {scenario.startingBacklog} open applications:{' '}
        {scenario.months.map((m) => `${m.month} → ${m.projectedBacklog}`).join(', ')}.{' '}
        {scenario.assumptions.join(' ')} {scenario.disclaimer}
      </div>
    </Panel>
  );
}

function Actions({ panel, onDecision }: {
  panel: PanelType<ActionsData>;
  onDecision: (key: string, decision: 'ACCEPTED' | 'DECLINED' | 'DEFERRED') => void;
}) {
  const d = panel.data;
  return (
    <Panel title="Recommended actions" unit="mixed" captions={panel.captions}>
      <FilterEchoStrip echo={panel.filter} />
      <div className={d.ragStatus === 'ACTIVE' ? 'notice notice--info' : 'notice'}>
        {d.ragNotice}
      </div>
      <div className="table-wrap">
        {d.recommendations.map((r) => (
          <article key={r.key} className="card" style={{ marginBottom: 10 }}>
            <div className="row">
              <span className={`pill ${r.severity === 'HIGH' ? 'pill--overdue'
                : r.severity === 'MEDIUM' ? 'pill--due' : 'pill--ok'}`}>
                <span aria-hidden="true">
                  {r.severity === 'HIGH' ? '▲' : r.severity === 'MEDIUM' ? '●' : '○'}
                </span> {r.severity}
              </span>
              <span className="pill">
                {r.evidenceKind === 'POLICY_REQUIREMENT'
                  ? 'Requirement quoted from policy' : 'Management suggestion from the data'}
              </span>
            </div>
            <p style={{ margin: '6px 0 0' }}><strong>Observed:</strong> {r.observedIndicator}</p>
            <p style={{ margin: '4px 0 0' }}><strong>Action:</strong> {r.recommendedAction}</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Owner: {r.actionOwner} · Review by: {r.reviewDate}
              {r.examples.length > 0 && <> · Cases: {r.examples.join(', ')}</>}
            </p>
            {r.policyCitation ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Source: {r.policyCitation.documentTitle}, version{' '}
                {r.policyCitation.documentVersion}
                {r.policyCitation.effectiveDate && `, effective ${r.policyCitation.effectiveDate}`},{' '}
                {r.policyCitation.clauseOrPage}.{' '}
                {r.policyCitation.internalLink && (
                  <a href={r.policyCitation.internalLink} rel="noreferrer">Open the document</a>
                )}
                <br />
                <em>“{r.policyCitation.quotedPassage}”</em>
              </p>
            ) : (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                <strong>{r.policyGap?.message}</strong> Route to: {r.policyGap?.routeTo}.
              </p>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn--primary" type="button" style={{ minHeight: 38 }}
                onClick={() => onDecision(r.key, 'ACCEPTED')}>Accept</button>
              <button className="btn" type="button" style={{ minHeight: 38 }}
                onClick={() => onDecision(r.key, 'DEFERRED')}>Defer</button>
              <button className="btn" type="button" style={{ minHeight: 38 }}
                onClick={() => onDecision(r.key, 'DECLINED')}>Decline</button>
            </div>
          </article>
        ))}
        {d.recommendations.length === 0 && (
          <p className="muted">No recommendations for the selected filters.</p>
        )}
      </div>
      {d.rulesEvaluatedWithNoFinding.length > 0 && (
        <p className="muted">
          Evaluated with no finding: {d.rulesEvaluatedWithNoFinding.join(', ')}.
        </p>
      )}
      <p className="muted">
        A recommendation cannot alter a deadline, approve a claim, move money, issue a clinical
        report or send a message. Every one waits for a person to accept, defer or decline it, and
        that decision is recorded.
      </p>
    </Panel>
  );
}
