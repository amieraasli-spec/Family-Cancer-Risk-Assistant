import { t } from '../i18n/strings.js'
import { STATES } from '../data/states.js'

/**
 * Step 1 — demographics only.
 *
 * Phase 2 (privacy): full name, IC number, phone number and alternative contact
 * were removed for PDPA reasons, along with every feature that depended on
 * them. What is left is only what the risk engine actually reads: age, sex,
 * ethnicity, state and smoking status.
 */
export default function StepProfile ({ lang, profile, onChange, onNext }) {
  const set = (key, value) => onChange({ ...profile, [key]: value })
  const canContinue = Number(profile.age) > 0 && Boolean(profile.sex)

  return (
    <section className="card">
      <h2>{t('profileTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('profileIntro', lang)}</p>

      <label className="field">
        <span>{t('age', lang)}</span>
        <input
          type="number" inputMode="numeric" min="18" max="110"
          value={profile.age}
          onChange={e => set('age', e.target.value)}
          placeholder="45"
        />
      </label>

      <div className="field">
        <span style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '.95rem' }}>
          {t('sex', lang)}
        </span>
        <div className="chips">
          {['female', 'male'].map(value => (
            <button
              key={value}
              className="chip"
              aria-pressed={profile.sex === value}
              onClick={() => set('sex', value)}
            >
              {t(value, lang)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>{t('ethnicity', lang)}</span>
        <select value={profile.ethnicity} onChange={e => set('ethnicity', e.target.value)}>
          <option value="">—</option>
          {t('ethnicities', lang).map((label, i) => (
            <option key={i} value={t('ethnicities', 'en')[i]}>{label}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{t('state', lang)}</span>
        <select value={profile.state} onChange={e => set('state', e.target.value)}>
          <option value="">—</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <div className="field">
        <span style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '.95rem' }}>
          {t('smoking', lang)}
        </span>
        <div className="chips">
          {t('smokingOpts', lang).map((label, i) => {
            const value = ['never', 'former', 'current'][i]
            return (
              <button
                key={value}
                className="chip"
                aria-pressed={profile.smoking === value}
                onClick={() => set('smoking', value)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="btn-row">
        <button className="btn" disabled={!canContinue} onClick={onNext}>
          {t('next', lang)} →
        </button>
      </div>
    </section>
  )
}
