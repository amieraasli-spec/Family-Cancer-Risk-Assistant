import { t, pick } from '../i18n/strings.js'
import { MODULES, sourceLine } from '../data/cpg.js'
import { BRANDING } from '../config/branding.js'
import { RELATIONSHIPS } from './StepFamilyHistory.jsx'
import { symptomLabels } from './SymptomCheck.jsx'

/**
 * Printable GP summary (Phase 5).
 *
 * Carries a disclaimer at both the top and the foot, because a printed sheet
 * gets separated from the app that produced it. Reported symptoms are fed in
 * from the symptom check (Phase 6) so the clinician sees them alongside the
 * screening plan.
 */
export default function PrintableSummary ({ lang, profile, relatives, results, flagged }) {
  const today = new Date().toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-GB')
  const labels = symptomLabels(results.map(r => r.moduleId))
  const reported = flagged.map(id => labels[id]).filter(Boolean)

  const disclaimer = (
    <div className="notice warn">
      <span className="ico" aria-hidden="true">⚠️</span>
      <span>{t('notDiagnostic', lang)}</span>
    </div>
  )

  return (
    <section className="card" id="printable-summary">
      <h2>{t('summaryHeading', lang)}</h2>
      <p className="src">
        {BRANDING.appName} · {BRANDING.institution} · {t('generatedOn', lang)} {today}
      </p>

      {disclaimer}

      <h3>{t('summaryAbout', lang)}</h3>
      <ul className="tight">
        <li>{t('sumAge', lang)}: {profile.age || '—'}</li>
        <li>{t('sex', lang)}: {profile.sex ? t(profile.sex, lang) : '—'}</li>
        <li>{t('ethnicity', lang)}: {profile.ethnicity || '—'}</li>
        <li>{t('state', lang)}: {profile.state || '—'}</li>
        <li>
          {t('sumSmoking', lang)}:{' '}
          {profile.smoking
            ? t('smokingOpts', lang)[['never', 'former', 'current'].indexOf(profile.smoking)]
            : '—'}
        </li>
      </ul>

      <h3>{t('summaryFamily', lang)}</h3>
      {relatives.filter(r => r.relationship && r.cancer).length === 0 ? (
        <p>—</p>
      ) : (
        <ul className="tight">
          {relatives.filter(r => r.relationship && r.cancer).map(r => {
            const rel = RELATIONSHIPS.find(x => x.id === r.relationship)
            const mod = MODULES[r.cancer]
            return (
              <li key={r.key}>
                {rel ? pick(rel, lang) : r.relationship} — {mod ? pick(mod.name, lang) : r.cancer}
                {r.ageAtDiagnosis ? `, ${t('sumAge', lang).toLowerCase()} ${r.ageAtDiagnosis}` : ''}
                {' '}({r.degree === 1 ? t('firstDegree', lang) : t('secondDegree', lang)})
              </li>
            )
          })}
        </ul>
      )}

      <h3>{t('resultsTitle', lang)}</h3>
      {results.map(result => {
        const mod = MODULES[result.moduleId]
        return (
          <div key={result.moduleId} style={{ marginBottom: 12 }}>
            <strong>{pick(mod.name, lang)} — {t('riskNames', lang)[result.level]}</strong>
            <ul className="tight">
              <li>{t('recommendedScreening', lang)}: {pick(result.plan.test, lang)}</li>
              <li>{t('interval', lang)}: {pick(result.plan.interval, lang)}</li>
              {result.plan.suggestedStartAge !== null && (
                <li>{t('startFrom', lang)}: {result.plan.suggestedStartAge} {t('years', lang)}</li>
              )}
              <li className="src">
                {result.plan.provisional
                  ? `${t('anchoredTo', lang)}: — (${sourceLine(result.moduleId)}, ${lang === 'bm' ? 'belum diperoleh — sementara' : 'not retrieved — provisional'})`
                  : `${t('anchoredTo', lang)}: ${sourceLine(result.moduleId)}`}
              </li>
            </ul>
          </div>
        )
      })}

      <h3>{t('summarySymptoms', lang)}</h3>
      {reported.length === 0 ? (
        <p>{t('summaryNoSymptoms', lang)}</p>
      ) : (
        <ul className="tight">
          {reported.map(item => <li key={item.id}>{pick(item, lang)}</li>)}
        </ul>
      )}

      {disclaimer}
      <p className="src">{BRANDING.summaryFooter} · {BRANDING.author} · {BRANDING.ministry}</p>
    </section>
  )
}
