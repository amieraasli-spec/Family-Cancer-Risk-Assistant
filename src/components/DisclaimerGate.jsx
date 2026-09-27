import { t } from '../i18n/strings.js'
import { BRANDING } from '../config/branding.js'

/**
 * Entry gate (Phase 5). The user must acknowledge before anything else loads.
 * Deliberately a blocking modal, not a dismissible toast.
 */
export default function DisclaimerGate ({ lang, onAccept }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="modal">
        <h1 id="gate-title" style={{ color: 'var(--teal-900)' }}>{t('gateTitle', lang)}</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: '.95rem' }}>
          {BRANDING.appName} · {BRANDING.institution}
        </p>

        <ul className="tight" style={{ marginTop: 16 }}>
          {t('gatePoints', lang).map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>

        <div className="notice warn">
          <span className="ico" aria-hidden="true">⚠️</span>
          <span>{t('notDiagnostic', lang)}</span>
        </div>

        <button className="btn block" onClick={onAccept}>
          {t('gateAccept', lang)}
        </button>
      </div>
    </div>
  )
}
