import { t } from '../i18n/strings.js'
import { BRANDING } from '../config/branding.js'

/**
 * Landing hub (Phase 12).
 *
 * One big Start button, then three smaller tiles: ask the guidelines, the quiz,
 * and the registry data. No mascot — calm and clinical.
 */
export default function Landing ({ lang, onStart, onOpen }) {
  const why = t('whyItems', lang)

  return (
    <section>
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ color: 'var(--teal-900)' }}>
          {lang === 'bm' ? BRANDING.appNameBm : BRANDING.appName}
        </h1>
        <p style={{ color: 'var(--ink-soft)' }}>{t('tagline', lang)}</p>

        <button className="btn big block" onClick={onStart}>{t('start', lang)} →</button>
        <p className="src" style={{ marginTop: 8 }}>{t('startSub', lang)}</p>
      </div>

      <div className="tiles">
        <button className="tile" onClick={() => onOpen('notebook')}>
          <span className="tile-ico" aria-hidden="true">📓</span>
          <span className="tile-title">{t('tileAsk', lang)}</span>
          <span className="tile-sub">{t('tileAskSub', lang)}</span>
        </button>
        <button className="tile" onClick={() => onOpen('quiz')}>
          <span className="tile-ico" aria-hidden="true">🧠</span>
          <span className="tile-title">{t('tileQuiz', lang)}</span>
          <span className="tile-sub">{t('tileQuizSub', lang)}</span>
        </button>
        <button className="tile" onClick={() => onOpen('data')}>
          <span className="tile-ico" aria-hidden="true">📊</span>
          <span className="tile-title">{t('tileData', lang)}</span>
          <span className="tile-sub">{t('tileDataSub', lang)}</span>
        </button>
      </div>

      <div className="card">
        <h2>{t('whyTitle', lang)}</h2>
        {why.map(([icon, title, body]) => (
          <div key={title} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: '1.3rem' }} aria-hidden="true">{icon}</span>
            <div>
              <strong>{title}</strong>
              <div style={{ color: 'var(--ink-soft)', fontSize: '.92rem' }}>{body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
