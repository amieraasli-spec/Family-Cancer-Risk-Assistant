import { t, pick } from '../i18n/strings.js'
import { MODULES, sourceLine } from '../data/cpg.js'

/**
 * Step 4 — the plan.
 *
 * FIXED OUTPUT ORDER (Phase 1, non-negotiable):
 *   risk level → recommended screening → interval → warning signs → when to seek help
 *
 * Every module renders in that order, every time, so results are predictable
 * and auditable. When a module has no retrieved guideline, the fail-safe banner
 * renders above the plan rather than the plan being silently presented as
 * guideline-backed.
 */
export default function StepResults ({ lang, results, onPrint, onNext, onBack, children }) {
  return (
    <section>
      <div className="card">
        <h2>{t('resultsTitle', lang)}</h2>
        <div className="notice warn">
          <span className="ico" aria-hidden="true">⚠️</span>
          <span>{t('notDiagnostic', lang)}</span>
        </div>
      </div>

      {results.map(result => {
        const mod = MODULES[result.moduleId]
        const plan = result.plan
        // Average-risk modules collapse by default. Five expanded modules bury
        // the one or two that actually changed, and the point of the page is
        // that the raised bands are seen.
        const collapsed = result.level === 'average'
        const Body = collapsed ? 'details' : 'div'
        return (
          <article className="card risk-card" data-level={result.level} key={result.moduleId}>
            <Body>
              {collapsed ? (
                <summary className="module-summary">
                  <span>
                    <span aria-hidden="true">{mod.icon}</span> {pick(mod.name, lang)}
                  </span>
                  <span className="badge" data-level={result.level}>
                    {t('riskNames', lang)[result.level]}
                  </span>
                </summary>
              ) : (
                <>
                  <h3>
                    <span aria-hidden="true">{mod.icon}</span> {pick(mod.name, lang)}
                  </h3>
                  {/* 1. risk level */}
                  <p>
                    <span className="badge" data-level={result.level}>
                      {t('riskNames', lang)[result.level]}
                    </span>
                  </p>
                </>
              )}

            {plan.provisional && (
              <div className="notice warn">
                <span className="ico" aria-hidden="true">📄</span>
                <span>{t('provisionalBanner', lang)}</span>
              </div>
            )}

            {result.reasons.length > 0 && (
              <details style={{ margin: '8px 0 12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.92rem' }}>
                  {t('whyThis', lang)}
                </summary>
                <ul className="tight" style={{ marginTop: 8 }}>
                  {result.reasons.map((reason, i) => <li key={i}>{pick(reason, lang)}</li>)}
                </ul>
              </details>
            )}

            {/* 2. recommended screening */}
            <div className="plan-row">
              <div className="k">{t('recommendedScreening', lang)}</div>
              <div className="v">{pick(plan.test, lang)}</div>
            </div>

            {/* 3. interval */}
            <div className="plan-row">
              <div className="k">{t('interval', lang)}</div>
              <div className="v">{pick(plan.interval, lang)}</div>
            </div>

            {plan.suggestedStartAge !== null && (
              <div className="plan-row">
                <div className="k">{t('startFrom', lang)}</div>
                <div className="v">
                  {plan.suggestedStartAge} {t('years', lang)}
                  <div className="src">{plan.dueNow ? t('dueNow', lang) : t('notYet', lang)}</div>
                  {plan.startRule && <div className="src">{pick(plan.startRule, lang)}</div>}
                </div>
              </div>
            )}

            {plan.note && (
              <div className="notice info">
                <span className="ico" aria-hidden="true">💡</span>
                <span>{pick(plan.note, lang)}</span>
              </div>
            )}

            {/* 4. warning signs */}
            <div className="plan-row">
              <div className="k">{t('warningSigns', lang)}</div>
              <div className="v">
                <ul className="tight">
                  {pick(mod.warningSigns, lang).map((sign, i) => <li key={i}>{sign}</li>)}
                </ul>
              </div>
            </div>

            {/* 5. when to seek help */}
            <div className="plan-row">
              <div className="k">{t('whenToSeekHelp', lang)}</div>
              <div className="v">{t('seekHelpText', lang)}</div>
            </div>

            <p className="src">
              {plan.provisional
                ? `${t('anchoredTo', lang)}: — (${sourceLine(result.moduleId)}, ${lang === 'bm' ? 'belum diperoleh' : 'not yet retrieved'})`
                : `${t('anchoredTo', lang)}: ${sourceLine(result.moduleId)}${plan.citation ? ` · ${plan.citation}` : ''}`}
            </p>
            </Body>
          </article>
        )
      })}

      {children}

      <div className="btn-row no-print">
        <button className="btn secondary" onClick={onBack}>← {t('back', lang)}</button>
        <button className="btn secondary" onClick={onPrint}>🖨 {t('printSummary', lang)}</button>
        <button className="btn" onClick={onNext}>{t('next', lang)} →</button>
      </div>
    </section>
  )
}
