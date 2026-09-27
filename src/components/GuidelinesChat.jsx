import { useRef, useState } from 'react'
import { t } from '../i18n/strings.js'
import { NOTEBOOKLM } from '../config/notebooklm.js'

/**
 * Guideline Q&A panel (Phase 9).
 *
 * Calls /api/chat, a serverless proxy, so ANTHROPIC_API_KEY never reaches the
 * browser. The same anchoring discipline as the rest of the app is carried into
 * the server-side system prompt: cite the guideline, and say so when there
 * isn't one rather than inventing a recommendation.
 *
 * When the proxy is not configured the panel degrades to pointing at the
 * NotebookLM notebook, which needs no key of ours.
 */
export default function GuidelinesChat ({ lang }) {
  const [turns, setTurns] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const listRef = useRef(null)

  async function ask (event) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || busy) return

    const next = [...turns, { role: 'user', content: question }]
    setTurns(next)
    setDraft('')
    setBusy(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, language: lang })
      })

      if (response.status === 503) { setUnavailable(true); return }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'request failed')

      setTurns([...next, { role: 'assistant', content: data.reply }])
    } catch {
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            lang === 'bm'
              ? 'Maaf, sambungan gagal. Sila cuba lagi, atau gunakan buku nota NotebookLM.'
              : 'Sorry, that request failed. Please try again, or use the NotebookLM notebook.'
        }
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => listRef.current?.scrollTo(0, listRef.current.scrollHeight))
    }
  }

  if (unavailable) {
    return (
      <section className="card">
        <h2>{t('chatTitle', lang)}</h2>
        <div className="notice info">
          <span className="ico" aria-hidden="true">ℹ️</span>
          <span>
            {t('chatUnavailable', lang)}{' '}
            <a href={NOTEBOOKLM.askUrl} target="_blank" rel="noopener noreferrer">
              {t('openNotebook', lang)} ↗
            </a>
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{t('chatTitle', lang)}</h2>
      <div className="notice warn">
        <span className="ico" aria-hidden="true">⚠️</span>
        <span>{t('notDiagnostic', lang)}</span>
      </div>

      <div
        ref={listRef}
        style={{ maxHeight: 340, overflowY: 'auto', margin: '12px 0' }}
        aria-live="polite"
      >
        {turns.map((turn, i) => (
          <div
            key={i}
            style={{
              margin: '0 0 10px',
              padding: '10px 12px',
              borderRadius: 12,
              background: turn.role === 'user' ? 'var(--teal-50)' : '#fff',
              border: '1px solid var(--line)',
              whiteSpace: 'pre-wrap'
            }}
          >
            <strong style={{ fontSize: '.78rem', color: 'var(--ink-soft)', display: 'block' }}>
              {turn.role === 'user' ? (lang === 'bm' ? 'Anda' : 'You') : (lang === 'bm' ? 'Pembantu' : 'Assistant')}
            </strong>
            {turn.content}
          </div>
        ))}
        {busy && <p className="src">…</p>}
      </div>

      <form onSubmit={ask}>
        <label className="field">
          <span className="sr-only">{t('chatPlaceholder', lang)}</span>
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('chatPlaceholder', lang)}
          />
        </label>
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>
          {t('chatSend', lang)}
        </button>
      </form>
    </section>
  )
}
