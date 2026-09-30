/**
 * Administration — a separate permitted menu, not a sixth tab.
 *
 * The system administrator manages the machinery here and holds no permission over
 * patient content, clinical approval or payment approval. Every route this page
 * calls refuses those roles server-side, so what the menu offers and what the
 * server allows cannot drift apart.
 */
import { useEffect, useState } from 'react';
import { api, RequestFailed } from '../api.ts';
import { Panel, SubpageNav, useSubpages, type Subpage } from '../components/Shell.tsx';

interface ConfigRow {
  config_key: string; version: number; value_json: string; verification_state: string;
  owner_to_confirm: string | null; basis: string | null; effective_from: string;
  superseded_at: string | null;
}

interface AuditRow {
  occurred_at: string; actor_user_id: string | null; actor_role: string | null; action: string;
  outcome: string; permission: string | null; resource_type: string | null;
  resource_id: string | null; request_path: string | null;
}

interface NotificationStatus {
  provider: string; simulation: boolean; testAllowlist: string[]; notice: string;
  counts: { status: string; n: number }[];
  recentFailures: { notification_id: string; application_id: string | null; channel: string;
    template_key: string; failure_reason: string | null; attempt_count: number;
    created_at: string }[];
}

export function Admin() {
  const [config, setConfig] = useState<ConfigRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [notify, setNotify] = useState<NotificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const load = async <T,>(path: string, set: (v: T) => void) => {
        try { set(await api.get<T>(path)); } catch (err) {
          if (err instanceof RequestFailed && err.status === 403) return;
          setError(err instanceof RequestFailed ? err.apiError.message : String(err));
        }
      };
      await load<{ settings: ConfigRow[] }>('/api/staff/config', (v) => setConfig(v.settings));
      await load<{ events: AuditRow[] }>('/api/staff/audit', (v) => setAudit(v.events));
      await load<NotificationStatus>('/api/staff/notifications', setNotify);
    })();
  }, []);

  const pages: Subpage[] = [
    {
      key: 'assumptions',
      label: 'Assumptions & rules',
      render: () => (
        <Panel title="Configuration and prototype assumptions" unit="configuration keys"
          captions={configCaptions(config)}>
          <div className="notice">
            Every value below is a prototype assumption until its verification state reads
            CONFIRMED. The dashboard never applies the words “official”, “KKM KPI” or “IKN target”
            to a figure derived from an unconfirmed value.
          </div>
          {config === null ? <p className="muted">Not available to your role.</p> : (
            <div className="table-wrap">
              <table className="data">
                <caption>Current versions. A change supersedes rather than overwrites.</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th><th scope="col">Value</th><th scope="col">State</th>
                    <th scope="col">Owner to confirm</th><th scope="col">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {config.filter((c) => !c.superseded_at).map((c) => (
                    <tr key={`${c.config_key}-${c.version}`}>
                      <td>{c.config_key} <span className="muted">v{c.version}</span></td>
                      <td><code>{c.value_json}</code></td>
                      <td>
                        <span className={`pill ${c.verification_state === 'CONFIRMED'
                          ? 'pill--ok' : 'pill--due'}`}>
                          <span aria-hidden="true">
                            {c.verification_state === 'CONFIRMED' ? '✓' : '●'}
                          </span> {c.verification_state}
                        </span>
                      </td>
                      <td>{c.owner_to_confirm ?? '—'}</td>
                      <td className="muted">{c.basis ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ),
    },
    {
      key: 'notifications',
      label: 'Messaging adapter',
      render: () => (
        <Panel title="Notification adapter" unit="notifications"
          captions={notifyCaptions(notify)}>
          {notify === null ? <p className="muted">Not available to your role.</p> : (
            <>
              <div className={notify.simulation ? 'notice' : 'notice notice--info'}>
                <strong>{notify.provider}.</strong> {notify.notice}
                {notify.simulation && notify.testAllowlist.length > 0 && (
                  <> Test destinations are limited to: {notify.testAllowlist.join(', ')}.</>
                )}
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>Delivery outcomes. Failures are listed so they can be acted on.</caption>
                  <thead><tr><th scope="col">Status</th><th scope="col" className="num">Count</th></tr></thead>
                  <tbody>
                    {notify.counts.map((c) => (
                      <tr key={c.status}><td>{c.status}</td><td className="num">{c.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {notify.recentFailures.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <caption>Recent failed notifications.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Application</th><th scope="col">Template</th>
                        <th scope="col">Reason</th><th scope="col" className="num">Attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notify.recentFailures.slice(0, 5).map((f) => (
                        <tr key={f.notification_id}>
                          <td>{f.application_id ?? '—'}</td>
                          <td>{f.template_key}</td>
                          <td>{f.failure_reason ?? '—'}</td>
                          <td className="num">{f.attempt_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
      ),
    },
    {
      key: 'audit',
      label: 'Audit trail',
      render: () => (
        <Panel title="Audit trail" unit="audit events" captions={auditCaptions(audit)}>
          {audit === null ? <p className="muted">Not available to your role.</p> : (
            <div className="table-wrap">
              <table className="data">
                <caption>
                  Most recent first. Denials are recorded alongside grants: a run of denials
                  against one account is the signal that matters most.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th>
                    <th scope="col">Outcome</th><th scope="col">Permission</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.slice(0, 20).map((e, i) => (
                    <tr key={`${e.occurred_at}-${i}`}>
                      <td>{e.occurred_at.slice(0, 19).replace('T', ' ')}</td>
                      <td>{e.actor_role ?? '—'}</td>
                      <td>{e.action}</td>
                      <td>
                        <span className={`pill ${e.outcome === 'ALLOWED' ? 'pill--ok' : 'pill--overdue'}`}>
                          <span aria-hidden="true">{e.outcome === 'ALLOWED' ? '✓' : '▲'}</span>{' '}
                          {e.outcome}
                        </span>
                      </td>
                      <td className="muted">{e.permission ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ),
    },
    {
      key: 'calendar',
      label: 'Business calendar',
      render: () => <CalendarLoader />,
    },
  ];

  const nav = useSubpages(pages, 'admin');
  return (
    <>
      <SubpageNav pages={pages} current={nav.current} onSelect={nav.setCurrent} />
      {error && <p className="error">{error}</p>}
      {nav.active?.render()}
    </>
  );
}

/** Loads gazetted holiday dates. Deliberately a paste-in CSV, not a guessed generator. */
function CalendarLoader() {
  const [csv, setCsv] = useState('calendar_date,day_kind,label\n');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null); setResult(null);
    try {
      const out = await api.post<{ accepted: number; rejected: { row: number; reason: string }[];
        notice: string }>('/api/staff/calendar/days',
        { calendarVersion: 'CAL-2024-2026-v1', csv });
      setResult(`${out.accepted} dates loaded, ${out.rejected.length} rejected. ${out.notice}`);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.apiError.message : String(err));
    }
  };

  return (
    <Panel title="Business calendar — load gazetted holidays" unit="calendar dates">
      <div className="notice">
        Fixed-date Federal Territory holidays are seeded. Variable-date holidays — Chinese New
        Year, Thaipusam, both Hari Raya, Awal Muharram, Maulidur Rasul, Nuzul Al-Quran, Wesak,
        Deepavali, the Agong’s birthday — and officially recognised replacement days are
        deliberately <strong>not</strong> generated: guessing them would move real deadlines for
        real applicants by whole working days. Paste the gazetted dates below.
      </div>
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor="cal-csv">
          CSV: <code>calendar_date,day_kind,label</code> — day_kind is PUBLIC_HOLIDAY,
          REPLACEMENT_HOLIDAY or WORKING_OVERRIDE
        </label>
        <textarea id="cal-csv" value={csv} rows={7}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, padding: 8 }}
          onChange={(e) => setCsv(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn btn--primary" type="button" onClick={() => void submit()}>
          Load dates
        </button>
      </div>
      {result && <p className="muted">{result}</p>}
      {error && <p className="error">{error}</p>}
    </Panel>
  );
}

/**
 * Captions for the administration tables.
 *
 * The rule the brief sets — two captions under every chart and every table — applies
 * here too, and these are the tables where an unverified assumption or a run of
 * denied authorisations is exactly what somebody needs to notice.
 */
function configCaptions(config: ConfigRow[] | null) {
  if (config === null) {
    return {
      howToRead: 'this table lists the configuration keys the system calculates from.',
      whatThisShows: 'Configuration is not available to your role.',
    };
  }
  const current = config.filter((c) => !c.superseded_at);
  const unverified = current.filter((c) => c.verification_state === 'UNVERIFIED').length;
  const confirmed = current.filter((c) => c.verification_state === 'CONFIRMED').length;
  return {
    howToRead: 'one row per configuration key in force, with the value the engine uses, who has '
      + 'to confirm it and what it is currently based on. A change supersedes the row rather than '
      + 'overwriting it, so a past figure stays reproducible.',
    whatThisShows: `${current.length} configuration keys are in force: ${confirmed} confirmed and `
      + `${unverified} still unverified. Until a key reads CONFIRMED, no figure derived from it is `
      + 'labelled an official KKM KPI or an approved IKN target.',
    dataClassNotice: 'Demonstration data — not actual IKN performance.',
  };
}

function notifyCaptions(notify: NotificationStatus | null) {
  if (notify === null) {
    return {
      howToRead: 'this panel reports how notifications are being delivered.',
      whatThisShows: 'The notification adapter is not available to your role.',
    };
  }
  const total = notify.counts.reduce((sum, c) => sum + c.n, 0);
  const failed = notify.counts.find((c) => c.status === 'FAILED')?.n ?? 0;
  return {
    howToRead: 'the counts are notification outcomes to date, and the second table lists recent '
      + 'failures so the responsible officer can act on them rather than discover them later.',
    whatThisShows: `${total} notifications have been recorded through the ${notify.provider} `
      + `adapter, of which ${failed} failed to deliver.`
      + (notify.simulation
        ? ' The adapter is in simulation mode, so no message has left this system and no test '
          + 'notification can reach a real applicant.'
        : ''),
    dataClassNotice: 'Demonstration data — not actual IKN performance.',
  };
}

function auditCaptions(audit: AuditRow[] | null) {
  if (audit === null) {
    return {
      howToRead: 'this table lists privileged access and authorisation decisions.',
      whatThisShows: 'The audit trail is not available to your role.',
    };
  }
  const denied = audit.filter((e) => e.outcome === 'DENIED').length;
  const shown = Math.min(20, audit.length);
  return {
    howToRead: 'one row per recorded access or authorisation decision, newest first. Denials are '
      + 'recorded alongside grants, because a run of denials against one account is the signal '
      + 'that matters most.',
    whatThisShows: `${audit.length} recent events are loaded, of which ${denied} `
      + `${denied === 1 ? 'was' : 'were'} denied. Showing the newest ${shown}.`,
    dataClassNotice: 'Demonstration data — not actual IKN performance.',
  };
}
