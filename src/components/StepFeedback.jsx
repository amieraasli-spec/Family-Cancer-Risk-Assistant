import { useState } from 'react'
import { t } from '../i18n/strings.js'

/**
 * Step 5 — anonymous feasibility feedback (Phase 7).
 *
 * Posts to /api/feedback, a serverless function that talks to EmailJS with
 * server-side keys. No EmailJS credential ever reaches the browser, and the
 * form collects no name, IC number or contact detail.
 */
export default function StepFeedback ({ lang, onBack, onHome }) {
  const [role, setRole] = useState('')
  const [scores, setScores] = useState({})
  const [comment, setComment] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState('idle') // idle | sending | sent | error

  const items = t('likertItems', lang)
  const scale = t('likert', lang)
  const complete = consent && role && items.every((_, i) => scores[i])

  async function submit () {
    setStatus('sending')
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          // Store the English statements so responses stay comparable across languages.
          scores: t('likertItems', 'en').map((statement, i) => ({ statement, score: scores[i] ?? null })),
          comment: comment.trim(),
          language: lang,
          submittedAt: new Date().toISOString()
        })
      })
      setStatus(response.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <section className="card">
        <h2>{t('feedbackTitle', lang)}</h2>
        <div className="notice success">
          <span className="ico" aria-hidden="true">✅</span>
          <span>{t('thanks', lang)}</span>
        </div>
        <button className="btn" onClick={onHome}>{t('home', lang)}</button>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{t('feedbackTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('feedbackIntro', lang)}</p>

      <label className="field">
        <span>{t('yourRole', lang)}</span>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="">—</option>
          {t('roles', lang).map((label, i) => (
            <option key={i} value={t('roles', 'en')[i]}>{label}</option>
          ))}
        </select>
      </label>

      {items.map((statement, i) => (
        <div className="field" key={i}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '.95rem' }}>
            {statement}
          </span>
          <div className="chips">
            {scale.map((label, n) => (
              <button
                key={n}
                className="chip"
                style={{ padding: '0 12px', fontSize: '.85rem' }}
                aria-pressed={scores[i] === n + 1}
                aria-label={`${statement} — ${label}`}
                onClick={() => setScores(s => ({ ...s, [i]: n + 1 }))}
              >
                {n + 1}
              </button>
            ))}
          </div>
          <p className="src">1 = {scale[0]} · 5 = {scale[4]}</p>
        </div>
      ))}

      <label className="field">
        <span>{t('comment', lang)}</span>
        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1200} />
      </label>

      <label className="check" data-on={consent}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>{t('consent', lang)}</span>
      </label>

      {status === 'error' && (
        <div className="notice danger">
          <span className="ico" aria-hidden="true">⚠️</span>
          <span>{t('sendFailed', lang)}</span>
        </div>
      )}

      <div className="btn-row">
        <button className="btn secondary" onClick={onBack}>← {t('back', lang)}</button>
        <button className="btn" disabled={!complete || status === 'sending'} onClick={submit}>
          {status === 'sending' ? t('sending', lang) : t('submit', lang)}
        </button>
      </div>
    </section>
  )
}
