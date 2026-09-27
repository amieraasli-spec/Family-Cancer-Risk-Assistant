import { useState } from 'react'
import { t, pick } from '../i18n/strings.js'
import { QUIZ } from '../data/quiz.js'
import { NOTEBOOKLM } from '../config/notebooklm.js'

/**
 * Short public-awareness quiz.
 *
 * One question at a time with immediate feedback, so it teaches rather than
 * tests. Nothing here is scored, stored or sent anywhere — the answers live in
 * component state and vanish with the page.
 *
 * The NotebookLM-generated quiz (grounded in the CPGs) is linked at the foot as
 * a second, source-anchored version of the same idea.
 */
export default function QuizPanel ({ lang }) {
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  const question = QUIZ[index]
  const isLast = index === QUIZ.length - 1

  function choose (optionId) {
    if (chosen) return
    setChosen(optionId)
    if (optionId === question.answer) setScore(s => s + 1)
  }

  function advance () {
    if (isLast) { setDone(true); return }
    setIndex(i => i + 1)
    setChosen(null)
  }

  function restart () {
    setIndex(0); setChosen(null); setScore(0); setDone(false)
  }

  const notebookQuizLink = (
    <div className="notice info" style={{ marginTop: 20 }}>
      <span className="ico" aria-hidden="true">📓</span>
      <span>
        {t('quizNotebookLink', lang)}{' '}
        <a href={NOTEBOOKLM.quizUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
          {t('openNotebookQuiz', lang)} ↗
        </a>
      </span>
    </div>
  )

  if (done) {
    const pct = Math.round((score / QUIZ.length) * 100)
    return (
      <section className="card">
        <h2>{t('quizTitle', lang)}</h2>
        <div className="stat" style={{ margin: '16px 0' }}>
          <span className="big">{score} / {QUIZ.length}</span>
          <span className="cap">{t('quizScore', lang)} {score} {t('quizOutOf', lang)} {QUIZ.length} ({pct}%)</span>
        </div>
        <p>
          {lang === 'bm'
            ? 'Kuiz ini untuk kesedaran sahaja. Skor anda tidak disimpan dan tidak bermakna apa-apa tentang risiko peribadi anda.'
            : 'This quiz is for awareness only. Your score is not stored and says nothing about your personal risk.'}
        </p>
        <button className="btn secondary" onClick={restart}>{t('quizRestart', lang)}</button>
        {notebookQuizLink}
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{t('quizTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('quizIntro', lang)}</p>

      <p className="quiz-progress" aria-live="polite">
        {index + 1} / {QUIZ.length}
      </p>

      <h3>{pick(question.question, lang)}</h3>

      <div role="group" aria-label={pick(question.question, lang)}>
        {question.options.map(option => {
          let state
          if (chosen) {
            if (option.id === question.answer) state = 'correct'
            else if (option.id === chosen) state = 'wrong'
          }
          return (
            <button
              key={option.id}
              className="quiz-opt"
              data-state={state}
              disabled={Boolean(chosen)}
              onClick={() => choose(option.id)}
            >
              {pick(option, lang)}
              {state === 'correct' && ' ✓'}
              {state === 'wrong' && ' ✕'}
            </button>
          )
        })}
      </div>

      {chosen && (
        <>
          <div className={`notice ${chosen === question.answer ? 'success' : 'warn'}`} aria-live="polite">
            <span className="ico" aria-hidden="true">{chosen === question.answer ? '✅' : '💡'}</span>
            <span>
              <strong>{chosen === question.answer ? t('quizCorrect', lang) : t('quizIncorrect', lang)}.</strong>{' '}
              {pick(question.explain, lang)}
            </span>
          </div>
          <button className="btn" onClick={advance}>
            {isLast ? t('quizFinish', lang) : t('quizNext', lang)}
          </button>
        </>
      )}

      {notebookQuizLink}
    </section>
  )
}
