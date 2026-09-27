import { useState } from 'react'
import { t, pick } from '../i18n/strings.js'
import { EMERGENCY } from '../data/symptoms.js'
import { BRANDING } from '../config/branding.js'

/**
 * Persistent emergency access (Phase 3 / Phase 6).
 *
 * Collapsed by default so it does not shout. The 999 prompt is scoped strictly
 * to the acute presentations listed in EMERGENCY — never used as a general
 * "see someone" nudge.
 */
export default function EmergencyBanner ({ lang }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="no-print">
      <button
        className="btn secondary block"
        style={{ borderColor: 'var(--red-100)', color: 'var(--red-700)', minHeight: 44 }}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        🚨 {t('emergencyTitle', lang)}
      </button>

      {open && (
        <div className="notice danger" style={{ flexDirection: 'column' }}>
          <ul className="tight" style={{ marginBottom: 8 }}>
            {EMERGENCY.items.map(item => (
              <li key={item.id}>{pick(item, lang)}</li>
            ))}
          </ul>
          <a className="btn danger" href={`tel:${BRANDING.emergencyNumber}`}>
            📞 {t('emergencyAction', lang)}
          </a>
        </div>
      )}
    </div>
  )
}
