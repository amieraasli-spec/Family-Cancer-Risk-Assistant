import { t, pick } from '../i18n/strings.js'
import { INHERITED_CONDITIONS } from '../lib/riskEngine.js'

/**
 * Step 3 — confirmed inherited conditions.
 *
 * Only genetically confirmed conditions count. The copy says so explicitly,
 * because a guessed "I think we have that" would push someone into the high
 * risk band and change their whole plan.
 */
export default function StepInherited ({ lang, selected, onChange, onNext, onBack }) {
  function toggle (id) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  return (
    <section className="card">
      <h2>{t('inheritedTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('inheritedIntro', lang)}</p>

      {Object.entries(INHERITED_CONDITIONS).map(([id, cond]) => {
        const on = selected.includes(id)
        return (
          <label className="check" key={id} data-on={on}>
            <input type="checkbox" checked={on} onChange={() => toggle(id)} />
            <span>{pick(cond.label, lang)}</span>
          </label>
        )
      })}

      <label className="check" data-on={selected.length === 0}>
        <input
          type="checkbox"
          checked={selected.length === 0}
          onChange={() => onChange([])}
        />
        <span>{t('noneOfThese', lang)}</span>
      </label>

      <div className="btn-row">
        <button className="btn secondary" onClick={onBack}>← {t('back', lang)}</button>
        <button className="btn" onClick={onNext}>{t('next', lang)} →</button>
      </div>
    </section>
  )
}
