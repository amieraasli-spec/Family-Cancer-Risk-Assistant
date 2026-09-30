/**
 * Semakan Status Laporan Perubatan — the applicant portal.
 *
 * The flow is deliberately short: enter code → verify only where required → see the
 * status and the next action. There is no account, no staff component and no
 * navigation into anything else.
 *
 * The tracking code is treated as a credential throughout: it travels in a POST
 * body, never appears in the URL, and is not written to `history`, so it cannot
 * leak through a referrer, a bookmark or a server access log.
 */
import { useCallback, useId, useMemo, useState } from 'react';
import { STAGE_ICON, stageTone, UI, type Language, type UiText } from './text.ts';

interface PublicStatus {
  publicReference: string;
  stage: string;
  stageLabel: string;
  stageExplanation: string;
  receivedDate: string;
  targetCompletionDate: string | null;
  targetNotSetNotice: string | null;
  revisedEstimateDate: string | null;
  estimateDisclaimer: string | null;
  lastUpdateDate: string;
  nextActionCode: string | null;
  nextActionText: string;
  outstandingItems: string[] | null;
  collectionInstructions: string;
  delayNotice: string | null;
  feeOutstanding: boolean;
  contact: {
    unitName: string; telephone: string | null; email: string | null;
    counterHours: string | null; unverifiedNotice: string | null;
  };
  dataClassNotice: string | null;
  verified: boolean;
}

type Screen =
  | { name: 'ENTER_REFERENCE' }
  | { name: 'ENTER_REPORT_NUMBER' }
  | { name: 'ENTER_CODE'; challengeId: string; destinationMasked: string | null; message: string;
    staffAssistedRoute: string }
  | { name: 'STATUS'; status: PublicStatus };

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // No credentials: the public surface holds no session.
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  const payload = await response.json().catch(() => null) as
    { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'We could not complete that request.');
  }
  return payload as T;
}

export default function PortalApp() {
  const [language, setLanguage] = useState<Language>('ms');
  const [screen, setScreen] = useState<Screen>({ name: 'ENTER_REFERENCE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reference and the verification token live in component state only. Neither
  // is placed in the URL, in localStorage, or in the browser's history.
  const [reference, setReference] = useState('');
  const [reportNumber, setReportNumber] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  const t = UI[language];

  const lookUp = useCallback(async (token?: string | null) => {
    setBusy(true); setError(null);
    try {
      const status = await post<PublicStatus>('/api/public/status', {
        reference, language, ...(token ? { verificationToken: token } : {}),
      });
      setScreen({ name: 'STATUS', status });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [reference, language]);

  const requestCode = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const out = await post<{
        challengeId: string | null; destinationMasked: string | null;
        message: string; staffAssistedRoute: string;
      }>('/api/public/verify/challenge', { reportNumber, language });
      // The response is uniform whether or not the report number exists, so the
      // portal always advances to the code screen and never confirms existence.
      setScreen({
        name: 'ENTER_CODE',
        challengeId: out.challengeId ?? '',
        destinationMasked: out.destinationMasked,
        message: out.message,
        staffAssistedRoute: out.staffAssistedRoute,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [reportNumber, language]);

  const verifyCode = useCallback(async (challengeId: string) => {
    setBusy(true); setError(null);
    try {
      const out = await post<{ verificationToken: string }>('/api/public/verify',
        { challengeId, code, language });
      setVerificationToken(out.verificationToken);
      // Verification alone reveals nothing; the caller still needs the reference.
      setScreen({ name: 'ENTER_REFERENCE' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [code, language]);

  return (
    <div className="portal">
      <div className="portal__banner" role="status">{t.demoBanner}</div>

      <header className="portal__head">
        <div className="portal__brand">
          <strong>{t.serviceTitle}</strong>
          <span>{t.org}</span>
        </div>
        <div className="portal__lang" role="group" aria-label="Bahasa / Language">
          <button type="button" aria-pressed={language === 'ms'}
            onClick={() => setLanguage('ms')}>BM</button>
          <button type="button" aria-pressed={language === 'en'}
            onClick={() => setLanguage('en')}>EN</button>
        </div>
      </header>

      <main className="portal__main">
        {screen.name === 'ENTER_REFERENCE' && (
          <ReferenceStep
            t={t} busy={busy} error={error} reference={reference} verified={!!verificationToken}
            onChange={setReference}
            onSubmit={() => lookUp(verificationToken)}
            onSwitch={() => { setError(null); setScreen({ name: 'ENTER_REPORT_NUMBER' }); }}
          />
        )}

        {screen.name === 'ENTER_REPORT_NUMBER' && (
          <ReportNumberStep
            t={t} busy={busy} error={error} reportNumber={reportNumber}
            onChange={setReportNumber} onSubmit={requestCode}
            onBack={() => { setError(null); setScreen({ name: 'ENTER_REFERENCE' }); }}
          />
        )}

        {screen.name === 'ENTER_CODE' && (
          <CodeStep
            t={t} busy={busy} error={error} code={code} screen={screen}
            onChange={setCode} onSubmit={() => verifyCode(screen.challengeId)}
            onBack={() => { setError(null); setScreen({ name: 'ENTER_REPORT_NUMBER' }); }}
          />
        )}

        {screen.name === 'STATUS' && (
          <StatusView
            t={t} status={screen.status} language={language}
            onReset={() => {
              setReference(''); setCode(''); setReportNumber('');
              setVerificationToken(null); setError(null);
              setScreen({ name: 'ENTER_REFERENCE' });
            }}
          />
        )}
      </main>

      <footer className="portal__foot">{t.privacy}</footer>
    </div>
  );
}

function ReferenceStep(props: {
  t: UiText; busy: boolean; error: string | null; reference: string; verified: boolean;
  onChange: (v: string) => void; onSubmit: () => void; onSwitch: () => void;
}) {
  const id = useId();
  const { t } = props;
  return (
    <form className="portal__card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}>
      <span className="portal__step">{t.step(1, 2)}</span>
      <h1>{t.enterHeading}</h1>
      <p>{t.enterIntro}</p>
      {props.verified && (
        <div className="notice notice--info">
          {/* Verification is application-scoped: it unlocks detail on the one case the
              reference resolves to, and nothing else. */}
          ✔ {t.showDetail}
        </div>
      )}
      <div className="portal__field">
        <label htmlFor={id}>{t.referenceLabel}</label>
        <input
          id={id} name="reference" value={props.reference} inputMode="text"
          autoComplete="off" autoCapitalize="characters" spellCheck={false}
          aria-describedby={`${id}-hint`} required minLength={8} maxLength={40}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="hint" id={`${id}-hint`}>{t.referenceHint}</span>
      </div>
      {props.error && <p className="portal__error" role="alert">{props.error}</p>}
      <button className="portal__btn" type="submit" disabled={props.busy || props.reference.length < 8}>
        {props.busy ? t.checking : t.check}
      </button>
      <p className="muted">{t.noReference}</p>
      <button className="portal__btn portal__btn--quiet" type="button" onClick={props.onSwitch}>
        {t.useReportNumber}
      </button>
    </form>
  );
}

function ReportNumberStep(props: {
  t: UiText; busy: boolean; error: string | null; reportNumber: string;
  onChange: (v: string) => void; onSubmit: () => void; onBack: () => void;
}) {
  const id = useId();
  const { t } = props;
  return (
    <form className="portal__card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}>
      <span className="portal__step">{t.step(1, 3)}</span>
      <h1>{t.reportNumberHeading}</h1>
      <p>{t.reportNumberIntro}</p>
      <div className="portal__field">
        <label htmlFor={id}>{t.reportNumberLabel}</label>
        <input id={id} name="reportNumber" value={props.reportNumber} autoComplete="off"
          spellCheck={false} required minLength={6} maxLength={64}
          onChange={(e) => props.onChange(e.target.value)} />
      </div>
      {props.error && <p className="portal__error" role="alert">{props.error}</p>}
      <button className="portal__btn" type="submit"
        disabled={props.busy || props.reportNumber.length < 6}>
        {props.busy ? t.sending : t.sendCode}
      </button>
      <button className="portal__btn portal__btn--quiet" type="button" onClick={props.onBack}>
        {t.useReference}
      </button>
    </form>
  );
}

function CodeStep(props: {
  t: UiText; busy: boolean; error: string | null; code: string;
  screen: Extract<Screen, { name: 'ENTER_CODE' }>;
  onChange: (v: string) => void; onSubmit: () => void; onBack: () => void;
}) {
  const id = useId();
  const { t, screen } = props;
  return (
    <form className="portal__card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}>
      <span className="portal__step">{t.step(2, 3)}</span>
      <h1>{t.codeHeading}</h1>
      <p>{screen.message}</p>
      {screen.destinationMasked && (
        <p className="muted">{t.codeSentTo} {screen.destinationMasked}</p>
      )}
      <div className="notice notice--info">{t.simulationNotice}</div>
      <div className="portal__field">
        <label htmlFor={id}>{t.codeLabel}</label>
        <input id={id} name="otp" value={props.code} inputMode="numeric"
          autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
          onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ''))} />
      </div>
      {props.error && <p className="portal__error" role="alert">{props.error}</p>}
      <button className="portal__btn" type="submit"
        disabled={props.busy || props.code.length !== 6 || !screen.challengeId}>
        {props.busy ? t.verifying : t.verify}
      </button>
      <p className="muted">{screen.staffAssistedRoute}</p>
      <button className="portal__btn portal__btn--quiet" type="button" onClick={props.onBack}>
        {t.back}
      </button>
    </form>
  );
}

function StatusView(props: {
  t: UiText; status: PublicStatus; language: Language; onReset: () => void;
}) {
  const { t, status } = props;
  const tone = useMemo(() => stageTone(status.stage), [status.stage]);
  return (
    <section className="portal__card" aria-live="polite">
      <span className="portal__step">{t.step(2, 2)}</span>
      <h1>{t.statusHeading}</h1>

      <div className={`status__stage status__stage--${tone}`}>
        <span className="status__icon" aria-hidden="true">{STAGE_ICON[status.stage] ?? 'ℹ️'}</span>
        <span className="status__stage-text">
          <strong>{status.stageLabel}</strong>
          <span>{status.stageExplanation}</span>
        </span>
      </div>

      {/* A delay adds a courteous message; it never replaces the true stage. */}
      {status.delayNotice && <p className="portal__delay">{status.delayNotice}</p>}

      <dl className="status__dates">
        <div className="status__date">
          <dt>{t.received}</dt><dd>{status.receivedDate}</dd>
        </div>
        <div className="status__date">
          <dt>{t.target}</dt>
          <dd>{status.targetCompletionDate ?? t.targetNotSet}</dd>
        </div>
        {/* The revised estimate is a separate, separately-labelled line. The original
            target above stays visible, and the disclaimer says an estimate is not a
            guarantee. */}
        {status.revisedEstimateDate && (
          <div className="status__date">
            <dt>{t.revised}</dt><dd>{status.revisedEstimateDate}</dd>
          </div>
        )}
        <div className="status__date">
          <dt>{t.lastUpdate}</dt><dd>{status.lastUpdateDate}</dd>
        </div>
      </dl>
      {status.targetNotSetNotice && <p className="muted">{status.targetNotSetNotice}</p>}
      {status.estimateDisclaimer && <p className="muted">{status.estimateDisclaimer}</p>}

      <div className="status__next">
        <strong>{t.nextAction}</strong>
        <p>{status.nextActionText}</p>
        {status.feeOutstanding && <p className="muted">{t.feeOutstanding}</p>}
        {status.outstandingItems === null && status.nextActionCode === 'SUBMIT_OUTSTANDING_DOCUMENTS' && (
          <p className="muted">{t.showDetail}</p>
        )}
        {status.outstandingItems !== null && status.outstandingItems.length > 0 && (
          <>
            <strong>{t.outstanding}</strong>
            <ul className="status__list">
              {status.outstandingItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
      </div>

      <div>
        <strong className="muted">{t.collection}</strong>
        <p>{status.collectionInstructions}</p>
      </div>

      <div className="portal__contact">
        <strong>{t.contact}</strong>
        <p>{status.contact.unitName}</p>
        {status.contact.telephone && <p>{status.contact.telephone}</p>}
        {status.contact.counterHours && <p>{status.contact.counterHours}</p>}
        {status.contact.unverifiedNotice && (
          <p className="muted">{status.contact.unverifiedNotice}</p>
        )}
      </div>

      {/* The reference and the data-class notice share one line: the notice is also
          in the page banner above, and repeating it on its own row cost the footer
          its place on a tablet screen. */}
      <p className="status__ref">
        {t.reference}: {status.publicReference}
        {status.dataClassNotice && ` · ${status.dataClassNotice}`}
      </p>

      <button className="portal__btn portal__btn--quiet" type="button" onClick={props.onReset}>
        {t.checkAnother}
      </button>
    </section>
  );
}
