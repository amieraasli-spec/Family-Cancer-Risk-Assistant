import { t, pick } from '../i18n/strings.js'
import { buildSymptomGroups, EMERGENCY } from '../data/symptoms.js'
import { MODULES } from '../data/cpg.js'
import { BRANDING } from '../config/branding.js'

/**
 * Targeted symptom check (Phase 6).
 *
 * Questions are generated only for the cancers this person was assessed for,
 * plus the constitutional group everyone gets. Ticking anything escalates to
 * "see your nearest doctor" — never to 999, which stays reserved for the acute
 * presentations in EMERGENCY.
 */
export default function SymptomCheck ({ lang, moduleIds, flagged, onChange }) {
  const names = Object.fromEntries(Object.values(MODULES).map(m => [m.id, m.name]))
  const groups = buildSymptomGroups(moduleIds, names)

  const emergencyFlagged = EMERGENCY.items.some(item => flagged.includes(item.id))
  const routineFlagged = flagged.some(id => !EMERGENCY.items.find(e => e.id === id))

  function toggle (id) {
    onChange(flagged.includes(id) ? flagged.filter(x => x !== id) : [...flagged, id])
  }

  return (
    <section className="card">
      <h2>{t('symptomTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('symptomIntro', lang)}</p>

      {/* Acute group first — but styled as a check, not a shout. */}
      <h3 style={{ marginTop: 16, color: 'var(--red-700)' }}>{EMERGENCY.title[lang] ?? EMERGENCY.title.en}</h3>
      {EMERGENCY.items.map(item => (
        <label className="check" key={item.id} data-on={flagged.includes(item.id)}>
          <input type="checkbox" checked={flagged.includes(item.id)} onChange={() => toggle(item.id)} />
          <span>{pick(item, lang)}</span>
        </label>
      ))}

      {emergencyFlagged && (
        <div className="notice danger" style={{ flexDirection: 'column' }}>
          <strong>
            {lang === 'bm'
              ? 'Ini adalah kecemasan. Dapatkan bantuan sekarang — jangan tunggu.'
              : 'This is an emergency. Get help now — do not wait.'}
          </strong>
          <a className="btn danger" href={`tel:${BRANDING.emergencyNumber}`} style={{ marginTop: 10 }}>
            📞 {t('emergencyAction', lang)}
          </a>
        </div>
      )}

      {groups.map(group => (
        <div key={group.id}>
          <h3 style={{ marginTop: 20 }}>{pick(group.title, lang)}</h3>
          {group.items.map(item => (
            <label className="check" key={item.id} data-on={flagged.includes(item.id)}>
              <input type="checkbox" checked={flagged.includes(item.id)} onChange={() => toggle(item.id)} />
              <span>{pick(item, lang)}</span>
            </label>
          ))}
        </div>
      ))}

      {routineFlagged ? (
        <div className="notice warn" aria-live="polite">
          <span className="ico" aria-hidden="true">🏥</span>
          <span>{t('symptomFlagged', lang)}</span>
        </div>
      ) : (
        !emergencyFlagged && (
          <div className="notice success" aria-live="polite">
            <span className="ico" aria-hidden="true">✅</span>
            <span>{t('symptomNone', lang)}</span>
          </div>
        )
      )}
    </section>
  )
}

/** Flatten every symptom definition so the printable summary can name them. */
export function symptomLabels (moduleIds) {
  const names = Object.fromEntries(Object.values(MODULES).map(m => [m.id, m.name]))
  const all = [...buildSymptomGroups(moduleIds, names).flatMap(g => g.items), ...EMERGENCY.items]
  return Object.fromEntries(all.map(item => [item.id, item]))
}
