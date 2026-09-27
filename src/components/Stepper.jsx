import { t } from '../i18n/strings.js'

/** Labelled, numbered horizontal stepper (Phase 5) — replaces plain dots. */
export default function Stepper ({ lang, current }) {
  const labels = t('steps', lang)
  return (
    <nav className="stepper no-print" aria-label="Progress">
      <ol>
        {labels.map((label, i) => {
          const state = i === current ? 'active' : i < current ? 'done' : 'todo'
          return (
            <li key={label} data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
              <div className="step-num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</div>
              <div className="step-label">{label}</div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
