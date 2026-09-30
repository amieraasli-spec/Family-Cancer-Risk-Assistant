/**
 * The staff application.
 *
 * Five tabs, administration in a separate menu, one shared filter bar, and every
 * panel fetched from the API with its captions already computed. The client never
 * derives a figure of its own: if the screen shows a number, the server calculated
 * it, so the screen and the export cannot disagree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, filterQuery, newIdempotencyKey, RequestFailed, ROLE_LABEL, type Session } from './api.ts';
import { Admin } from './pages/Admin.tsx';
import { Doctors } from './pages/Doctors.tsx';
import { Finance } from './pages/Finance.tsx';
import { Insights } from './pages/Insights.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { Reports } from './pages/Reports.tsx';
import type { ActionsData, DepartmentsResponse, DoctorClaimItem, DoctorTask, FinanceResponse,
  ForecastData, InsightsResponse, OverviewResponse, Panel as PanelType, ReferenceData,
  ReportsResponse } from './types.ts';

type Tab = 'overview' | 'reports' | 'doctors' | 'finance' | 'insights' | 'admin';

const TABS: { key: Tab; label: string; permission: string | null }[] = [
  { key: 'overview', label: 'Overview', permission: 'metrics.read.hospital' },
  { key: 'reports', label: 'Reports', permission: 'application.read' },
  { key: 'doctors', label: 'Doctors', permission: 'task.read' },
  { key: 'finance', label: 'Finance', permission: 'claim.read' },
  { key: 'insights', label: 'Insights', permission: 'metrics.read.hospital' },
];

/**
 * The prototype dataset stops at its snapshot date, so the default cutoff is that
 * instant rather than "now" — otherwise every panel would read as an empty month.
 * A live deployment leaves `asOf` unset and the server uses the present.
 */
const SNAPSHOT_CUTOFF = '2026-09-27T15:59:59.000Z';
const DEFAULT_MONTH = '2026-09';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Shared filter, inherited by every panel.
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [trailingMonths, setTrailingMonths] = useState(12);
  const [departments, setDepartments] = useState<string[]>([]);
  const [reportTypes, setReportTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [depts, setDepts] = useState<DepartmentsResponse | null>(null);
  const [finance, setFinance] = useState<FinanceResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [forecast, setForecast] = useState<PanelType<ForecastData> | null>(null);
  const [actions, setActions] = useState<PanelType<ActionsData> | null>(null);
  const [myTasks, setMyTasks] = useState<{ tasks: DoctorTask[]; notice: string } | null>(null);
  const [myClaims, setMyClaims] = useState<{ items: DoctorClaimItem[]; notice: string } | null>(null);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false, [session]);

  const query = useMemo(() => filterQuery({
    month, trailingMonths, departments, reportTypes, asOf: SNAPSHOT_CUTOFF, page, pageSize: 5,
  }), [month, trailingMonths, departments, reportTypes, page]);

  useEffect(() => {
    void (async () => {
      try { setSession(await api.get<Session>('/api/auth/me')); } catch { /* not signed in */ }
      finally { setLoading(false); }
    })();
  }, []);

  /** Loads only what the caller's permissions allow, ignoring 403 silently. */
  const load = useCallback(async () => {
    if (!session || session.mfaPending) return;
    setError(null);
    const tryGet = async <T,>(path: string, set: (v: T | null) => void) => {
      try { set(await api.get<T>(path)); } catch (err) {
        if (err instanceof RequestFailed && (err.status === 403 || err.status === 401)) {
          set(null); return;
        }
        setError(err instanceof RequestFailed ? err.apiError.message : String(err));
      }
    };
    await Promise.all([
      tryGet<ReferenceData>('/api/staff/reference', setReference),
      can('metrics.read.hospital')
        ? tryGet<OverviewResponse>(`/api/staff/metrics/overview?${query}`, setOverview)
        : Promise.resolve(),
      can('application.read')
        ? tryGet<ReportsResponse>(`/api/staff/applications?${query}`, setReports)
        : Promise.resolve(),
      can('metrics.read.hospital')
        ? tryGet<DepartmentsResponse>(`/api/staff/metrics/departments?${query}`, setDepts)
        : Promise.resolve(),
      can('claim.read') && session.principal.role !== 'doctor'
        ? tryGet<FinanceResponse>(`/api/staff/claims?${query}`, setFinance)
        : Promise.resolve(),
      can('metrics.read.hospital')
        ? tryGet<InsightsResponse>(`/api/staff/metrics/insights?${query}`, setInsights)
        : Promise.resolve(),
      can('forecast.read')
        ? tryGet<PanelType<ForecastData>>(`/api/staff/metrics/forecast?${query}`, setForecast)
        : Promise.resolve(),
      can('recommendations.read')
        ? tryGet<PanelType<ActionsData>>(`/api/staff/metrics/actions?${query}`, setActions)
        : Promise.resolve(),
      session.principal.role === 'doctor'
        ? tryGet<{ tasks: DoctorTask[]; notice: string }>('/api/staff/my-tasks', setMyTasks)
        : Promise.resolve(),
      session.principal.role === 'doctor'
        ? tryGet<{ items: DoctorClaimItem[]; notice: string }>('/api/staff/my-claims', setMyClaims)
        : Promise.resolve(),
    ]);
  }, [session, query, can]);

  useEffect(() => { void load(); }, [load]);

  // A doctor lands on their own work; nobody else has a reason to.
  useEffect(() => {
    if (session?.principal.role === 'doctor') setTab('doctors');
    if (session?.principal.role === 'system_admin') setTab('admin');
  }, [session?.principal.role]);

  const onTaskEvent = useCallback(async (applicationId: string, event: string) => {
    try {
      await api.post(`/api/staff/applications/${applicationId}/events`, { event },
        newIdempotencyKey());
      setToast(`Recorded: ${event.toLowerCase().replace(/_/g, ' ')}`);
      await load();
    } catch (err) {
      setError(err instanceof RequestFailed ? err.apiError.message : String(err));
    }
  }, [load]);

  const onDecision = useCallback(async (
    key: string, decision: 'ACCEPTED' | 'DECLINED' | 'DEFERRED',
  ) => {
    try {
      await api.post('/api/staff/metrics/actions/decisions',
        { recommendationKey: key, periodKey: month, decision }, newIdempotencyKey());
      setToast(`Recommendation ${decision.toLowerCase()} and recorded against ${month}.`);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.apiError.message : String(err));
    }
  }, [month]);

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!session) return <Login onSignedIn={setSession} />;
  if (session.mfaPending) return <Login onSignedIn={setSession} />;

  const visibleTabs = TABS.filter((t) => !t.permission || can(t.permission));
  const months = monthOptions();

  return (
    <div className="app">
      {session.dataClass === 'SYNTHETIC' && (
        <div className="app__banner" role="status">
          Demonstration data — not actual IKN performance. This prototype is not connected to the
          IKN website, a registration system, a finance system or a messaging gateway.
        </div>
      )}

      <header className="app__head">
        <h1 className="app__title">IKN Medical Report Tracking &amp; Performance System</h1>
        <div className="row">
          <span className="app__meta">
            {session.principal.displayName} · {ROLE_LABEL[session.principal.role]
              ?? session.principal.role}
            {session.principal.isSupervisor && ' (supervisor)'}
          </span>
          <button className="btn" type="button" style={{ minHeight: 36 }}
            onClick={() => { void api.post('/api/auth/logout').then(() => setSession(null)); }}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Main sections">
        {visibleTabs.map((t) => (
          <button key={t.key} type="button" className="tabs__btn"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => { setTab(t.key); setPage(1); }}>
            {t.label}
          </button>
        ))}
        {can('admin.users') || can('admin.rules') ? (
          <button type="button" className="tabs__btn"
            aria-current={tab === 'admin' ? 'page' : undefined}
            onClick={() => setTab('admin')}>Administration</button>
        ) : null}
      </nav>

      <main className="app__main">
        {/* The shared filter bar sits in one row above the panels. */}
        {tab !== 'admin' && (
          <div className="filters">
            <span className="field">
              <label htmlFor="f-month">Month</label>
              <select id="f-month" value={month}
                onChange={(e) => { setMonth(e.target.value); setPage(1); }}>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </span>
            <span className="field">
              <label htmlFor="f-window">Trailing window</label>
              <select id="f-window" value={trailingMonths}
                onChange={(e) => setTrailingMonths(Number(e.target.value))}>
                {[6, 12, 18, 24, 32].map((n) => <option key={n} value={n}>{n} months</option>)}
              </select>
            </span>
            <span className="field">
              <label htmlFor="f-dept">Department</label>
              <select id="f-dept" value={departments[0] ?? ''}
                onChange={(e) => {
                  setDepartments(e.target.value ? [e.target.value] : []); setPage(1);
                }}>
                <option value="">All departments</option>
                {(reference?.departments ?? []).map((d) => (
                  <option key={d.department_id} value={d.department_id}>{d.name}</option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="f-type">Report type</label>
              <select id="f-type" value={reportTypes[0] ?? ''}
                onChange={(e) => {
                  setReportTypes(e.target.value ? [e.target.value] : []); setPage(1);
                }}>
                <option value="">All report types</option>
                {(reference?.reportTypes ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </span>
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {toast && <p className="muted" role="status">{toast}</p>}

        {tab === 'overview' && (overview
          ? <Overview data={overview} />
          : <Unavailable />)}
        {tab === 'reports' && (reports
          ? <Reports data={reports} page={page} onPage={setPage} />
          : <Unavailable />)}
        {tab === 'doctors' && (
          <Doctors data={depts} myTasks={myTasks} myClaims={myClaims}
            isDoctor={session.principal.role === 'doctor'} onTaskEvent={onTaskEvent} />
        )}
        {tab === 'finance' && (finance
          ? <Finance data={finance} page={page} onPage={setPage} />
          : <Unavailable />)}
        {tab === 'insights' && (insights
          ? <Insights data={insights} forecast={forecast} actions={actions}
            onDecision={onDecision} />
          : <Unavailable />)}
        {tab === 'admin' && <Admin />}
      </main>

      <footer className="app__foot">
        <span className="muted">
          {reference
            ? `SLA ${reference.slaRule.slaRuleVersion} (${reference.slaRule.verificationState}) · `
              + `${reference.slaRule.serviceWorkingDays} working-day service allowance · `
              + `${reference.slaRule.doctorWorkingDays}-day doctor allowance (prototype value) · `
              + `${reference.slaRule.onTimeTargetPercent}% reference target`
            : 'Loading configuration…'}
        </span>
        {can('export.monthly') && tab !== 'admin' && (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <a className="btn" href={`/api/staff/exports/monthly?${query}&format=pdf`}
              target="_blank" rel="noreferrer"
              style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center',
                textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Monthly PDF
            </a>
            <a className="btn" href={`/api/staff/exports/monthly?${query}&format=csv`}
              style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center',
                textDecoration: 'none', whiteSpace: 'nowrap' }}>
              CSV
            </a>
          </span>
        )}
      </footer>
    </div>
  );
}

function Unavailable() {
  return (
    <section className="panel">
      <p className="muted">
        This section is not available to your role. Permissions are enforced on the server for
        every request, so hiding a tab is a convenience rather than the control.
      </p>
    </section>
  );
}

/** The months the prototype dataset covers, newest first. */
function monthOptions(): string[] {
  const out: string[] = [];
  for (let year = 2026; year >= 2024; year -= 1) {
    for (let m = 12; m >= 1; m -= 1) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      if (key <= DEFAULT_MONTH && key >= '2024-01') out.push(key);
    }
  }
  return out;
}
