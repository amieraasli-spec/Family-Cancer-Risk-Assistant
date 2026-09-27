import { useState } from 'react'
import { t } from '../i18n/strings.js'
import { NOTEBOOKLM } from '../config/notebooklm.js'

/**
 * Embedded NotebookLM notebook, grounded solely in the Malaysian CPGs.
 *
 * WHY THIS EXISTS
 * ---------------
 * A general chatbot answering guideline questions can hallucinate a screening
 * age. A NotebookLM notebook can only answer from the documents loaded into it,
 * so the failure mode becomes "I could not find that in the sources" instead of
 * a confident invention. That is the same fail-safe principle the CPG module
 * layer uses, applied to free-text questions.
 *
 * WHY THE FRAME IS OPT-IN
 * -----------------------
 * notebook.google.com refuses to be framed by a third-party site. A blocked
 * frame still fires its `load` event, so there is no reliable way to detect the
 * refusal from the parent page — probing for it renders a dead grey box to
 * every user before giving up. So the working path is the default: a card that
 * opens the notebook in a new tab. The inline frame stays available behind an
 * explicit toggle for anyone whose browser or future Google policy permits it.
 */
export default function NotebookPanel ({ lang, url = NOTEBOOKLM.askUrl, title, intro }) {
  const [showFrame, setShowFrame] = useState(NOTEBOOKLM.attemptInlineEmbed)

  const heading = title ?? t('notebookTitle', lang)

  return (
    <section className="card">
      <h2>{heading}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>
        {intro ?? t('notebookIntro', lang)}
      </p>

      <div className="notice info">
        <span className="ico" aria-hidden="true">📚</span>
        <span>
          {lang === 'bm'
            ? 'Buku nota ini hanya membaca daripada garis panduan yang dimuat naik. Jika jawapan tiada di dalamnya, ia akan berkata begitu.'
            : 'This notebook reads only from the guidelines uploaded into it. If an answer is not in them, it will say so.'}
        </span>
      </div>

      {showFrame ? (
        <>
          <iframe
            className="embed-frame"
            src={url}
            title={heading}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
          <div className="btn-row">
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              {t('openNotebook', lang)} ↗
            </a>
            <button className="btn secondary" onClick={() => setShowFrame(false)}>
              {lang === 'bm' ? 'Sembunyikan paparan dalam' : 'Hide inline view'}
            </button>
          </div>
        </>
      ) : (
        <div className="embed-fallback">
          <div style={{ fontSize: '2.2rem', marginBottom: 8 }} aria-hidden="true">📓</div>
          <p style={{ marginBottom: 16 }}>{t('embedBlocked', lang)}</p>
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
            {t('openNotebook', lang)} ↗
          </a>
          <p style={{ marginTop: 14, marginBottom: 0 }}>
            <button
              className="linkish"
              onClick={() => setShowFrame(true)}
            >
              {lang === 'bm' ? 'Cuba paparkan di sini' : 'Try showing it here anyway'}
            </button>
          </p>
        </div>
      )}
    </section>
  )
}
