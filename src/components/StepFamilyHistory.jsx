import { t, pick } from '../i18n/strings.js'
import { MODULE_LIST } from '../data/cpg.js'

/**
 * Step 2 — family lineage.
 *
 * Relationships are grouped by degree because that is what the risk engine
 * reads. The labels stay in plain language ("close relative" rather than
 * "first-degree") with the clinical term kept out of the way.
 */
const RELATIONSHIPS = [
  { id: 'mother',      degree: 1, en: 'Mother',              bm: 'Ibu' },
  { id: 'father',      degree: 1, en: 'Father',              bm: 'Bapa' },
  { id: 'sister',      degree: 1, en: 'Sister',              bm: 'Kakak / adik perempuan' },
  { id: 'brother',     degree: 1, en: 'Brother',             bm: 'Abang / adik lelaki' },
  { id: 'daughter',    degree: 1, en: 'Daughter',            bm: 'Anak perempuan' },
  { id: 'son',         degree: 1, en: 'Son',                 bm: 'Anak lelaki' },
  { id: 'grandmother', degree: 2, en: 'Grandmother',         bm: 'Nenek' },
  { id: 'grandfather', degree: 2, en: 'Grandfather',         bm: 'Datuk' },
  { id: 'aunt',        degree: 2, en: 'Aunt',                bm: 'Mak cik' },
  { id: 'uncle',       degree: 2, en: 'Uncle',               bm: 'Pak cik' },
  { id: 'niece',       degree: 2, en: 'Niece',               bm: 'Anak saudara perempuan' },
  { id: 'nephew',      degree: 2, en: 'Nephew',              bm: 'Anak saudara lelaki' },
  { id: 'halfsibling', degree: 2, en: 'Half-brother or half-sister', bm: 'Adik-beradik tiri sedarah' }
]

export { RELATIONSHIPS }

export default function StepFamilyHistory ({ lang, relatives, onChange, onNext, onBack }) {
  function addRelative () {
    onChange([
      ...relatives,
      { key: `r${Date.now()}`, relationship: '', degree: 1, cancer: '', ageAtDiagnosis: '' }
    ])
  }

  function update (key, patch) {
    onChange(relatives.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  function remove (key) {
    onChange(relatives.filter(r => r.key !== key))
  }

  function setRelationship (key, id) {
    const rel = RELATIONSHIPS.find(r => r.id === id)
    update(key, { relationship: id, degree: rel ? rel.degree : 1 })
  }

  return (
    <section className="card">
      <h2>{t('familyTitle', lang)}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.93rem' }}>{t('familyIntro', lang)}</p>

      {relatives.length === 0 && (
        <div className="notice info">
          <span className="ico" aria-hidden="true">👪</span>
          <span>{t('noRelatives', lang)}</span>
        </div>
      )}

      {relatives.map(relative => (
        <div className="relative-row" key={relative.key}>
          <div className="grid2">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>{t('relationship', lang)}</span>
              <select
                value={relative.relationship}
                onChange={e => setRelationship(relative.key, e.target.value)}
              >
                <option value="">—</option>
                {RELATIONSHIPS.map(r => (
                  <option key={r.id} value={r.id}>{pick(r, lang)}</option>
                ))}
              </select>
            </label>

            <label className="field" style={{ marginBottom: 0 }}>
              <span>{t('whichCancer', lang)}</span>
              <select
                value={relative.cancer}
                onChange={e => update(relative.key, { cancer: e.target.value })}
              >
                <option value="">—</option>
                {MODULE_LIST.map(m => (
                  <option key={m.id} value={m.id}>{pick(m.name, lang)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid2" style={{ marginTop: 10 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>{t('ageAtDiagnosis', lang)}</span>
              <input
                type="number" inputMode="numeric" min="1" max="110"
                value={relative.ageAtDiagnosis}
                placeholder={t('unknownAge', lang)}
                onChange={e => update(relative.key, { ageAtDiagnosis: e.target.value })}
              />
            </label>

            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                className="btn secondary"
                style={{ color: 'var(--red-700)' }}
                onClick={() => remove(relative.key)}
              >
                {t('remove', lang)}
              </button>
            </div>
          </div>

          {relative.relationship && (
            <p className="src" style={{ marginTop: 8 }}>
              {relative.degree === 1 ? t('firstDegree', lang) : t('secondDegree', lang)}
            </p>
          )}
        </div>
      ))}

      <button className="btn secondary block" onClick={addRelative}>+ {t('addRelative', lang)}</button>

      <div className="btn-row">
        <button className="btn secondary" onClick={onBack}>← {t('back', lang)}</button>
        <button className="btn" onClick={onNext}>{t('next', lang)} →</button>
      </div>
    </section>
  )
}
