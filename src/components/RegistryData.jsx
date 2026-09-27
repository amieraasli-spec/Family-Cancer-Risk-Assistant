import { t, pick } from '../i18n/strings.js'
import {
  LIFETIME_RISK, TOP_CANCERS, LATE_STAGE, HEREDITARY_SHARE,
  REGISTRY_SOURCE, REGISTRY_VERIFIED
} from '../data/registry.js'

/**
 * Landing-page data card (Phase 8) — open with credibility, not marketing.
 *
 * Chart choices:
 *   · Lifetime risk and the hereditary share are single headline figures, so
 *     they are stat tiles, not charts.
 *   · "Most common cancers" and "diagnosed late" are magnitude comparisons
 *     across a handful of named categories: horizontal bars, sorted descending,
 *     one hue per chart (single series, so no legend — the heading names it).
 *   · Every bar is directly labelled, and the label is ink rather than the
 *     series colour, so nothing depends on colour to be read.
 *
 * Provenance is rendered, never assumed: any figure that is not published by
 * the registry is labelled as an estimate, and while REGISTRY_VERIFIED is false
 * the whole card carries a verification banner.
 */
function BarChart ({ caption, rows, lang, tone, max = 100 }) {
  return (
    <figure style={{ margin: '0 0 20px' }}>
      <figcaption style={{ fontWeight: 700, marginBottom: 10 }}>{caption}</figcaption>
      {rows.map(row => {
        const label = pick(row.label, lang)
        return (
          <div className="bar-row" key={row.id} title={`${label}: ${row.percent}%`}>
            <div className="bar-head">
              <span className="name">{label}</span>
              <span className="val">{row.percent}%</span>
            </div>
            <div
              className="bar-track"
              role="img"
              aria-label={`${label}: ${row.percent} per cent`}
            >
              <div
                className="bar-fill"
                data-tone={tone}
                style={{ width: `${Math.min(100, (row.percent / max) * 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </figure>
  )
}

export default function RegistryData ({ lang }) {
  const sorted = list => [...list].sort((a, b) => b.percent - a.percent)

  return (
    <section className="card">
      <h2>{t('dataTitle', lang)}</h2>

      {!REGISTRY_VERIFIED && (
        <div className="notice warn">
          <span className="ico" aria-hidden="true">📄</span>
          <span>{t('unverifiedBanner', lang)}</span>
        </div>
      )}

      <h3>{t('lifetimeRisk', lang)}</h3>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {LIFETIME_RISK.map(item => (
          <div className="stat" key={item.id}>
            <span className="big">{pick(item.value, lang)}</span>
            <span className="cap">{pick(item.label, lang)} — {pick(item.caption, lang)}</span>
          </div>
        ))}
      </div>

      <BarChart
        caption={t('topCancers', lang)}
        rows={sorted(TOP_CANCERS)}
        lang={lang}
        max={25}
      />

      <BarChart
        caption={t('lateStage', lang)}
        rows={sorted(LATE_STAGE)}
        lang={lang}
        tone="late"
      />
      <p className="src" style={{ marginTop: -12, marginBottom: 20 }}>{t('lateStageNote', lang)}</p>

      <div className="stat" style={{ textAlign: 'left' }}>
        <span className="big">{HEREDITARY_SHARE.value}</span>
        <span className="cap">{pick(HEREDITARY_SHARE.label, lang)}</span>
        <p className="src" style={{ marginTop: 8 }}>
          <strong>{t('estimateLabel', lang)}.</strong> {pick(HEREDITARY_SHARE.note, lang)}
        </p>
      </div>

      <p className="src" style={{ marginTop: 16 }}>
        {REGISTRY_SOURCE.title} · {REGISTRY_SOURCE.org}
        <br />
        {pick(REGISTRY_SOURCE.note, lang)}
      </p>
    </section>
  )
}
