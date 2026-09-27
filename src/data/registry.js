/**
 * Malaysian cancer statistics for the landing page.
 *
 * PHASE 8 RULE — "Refuse to fabricate, out loud."
 * Every figure carries its own provenance. Nothing renders without a label.
 *
 *   'registry'      — published in the Malaysia National Cancer Registry Report
 *   'international' — no Malaysian figure published; clearly labelled estimate
 *
 * `verified` is false on every figure below because the registry report has not
 * been ingested into this repository and no number here has been checked
 * against the primary PDF. While REGISTRY_VERIFIED is false the UI shows a
 * verification banner over the whole card. Set each `verified: true` only after
 * reading the figure off the published report, and then set REGISTRY_VERIFIED.
 */

export const REGISTRY_VERIFIED = false

export const REGISTRY_SOURCE = {
  title: 'Malaysia National Cancer Registry Report (MNCR) 2017–2021',
  org: 'National Cancer Registry, Ministry of Health Malaysia',
  note: {
    en: 'Figures shown here are pending verification against the published report.',
    bm: 'Angka yang dipaparkan masih menunggu pengesahan dengan laporan yang diterbitkan.'
  }
}

export const LIFETIME_RISK = [
  {
    id: 'male',
    label: { en: 'Men', bm: 'Lelaki' },
    value: { en: '1 in 10', bm: '1 daripada 10' },
    caption: { en: 'lifetime risk of developing cancer', bm: 'risiko seumur hidup menghidap kanser' },
    provenance: 'registry',
    verified: false
  },
  {
    id: 'female',
    label: { en: 'Women', bm: 'Perempuan' },
    value: { en: '1 in 9', bm: '1 daripada 9' },
    caption: { en: 'lifetime risk of developing cancer', bm: 'risiko seumur hidup menghidap kanser' },
    provenance: 'registry',
    verified: false
  }
]

/** Share of all new cancer cases, both sexes. Percentages are approximate. */
export const TOP_CANCERS = [
  { id: 'breast', label: { en: 'Breast', bm: 'Payudara' }, percent: 19.9, provenance: 'registry', verified: false },
  { id: 'colorectal', label: { en: 'Colorectal', bm: 'Kolorektal' }, percent: 12.6, provenance: 'registry', verified: false },
  { id: 'lung', label: { en: 'Lung', bm: 'Paru-paru' }, percent: 9.8, provenance: 'registry', verified: false },
  { id: 'nasopharyngeal', label: { en: 'Nasopharyngeal', bm: 'Nasofarinks' }, percent: 3.6, provenance: 'registry', verified: false },
  { id: 'cervical', label: { en: 'Cervical', bm: 'Serviks' }, percent: 3.1, provenance: 'registry', verified: false }
]

/** Proportion first diagnosed at stage III or IV. */
export const LATE_STAGE = [
  { id: 'breast', label: { en: 'Breast', bm: 'Payudara' }, percent: 47, provenance: 'registry', verified: false },
  { id: 'colorectal', label: { en: 'Colorectal', bm: 'Kolorektal' }, percent: 65, provenance: 'registry', verified: false },
  { id: 'lung', label: { en: 'Lung', bm: 'Paru-paru' }, percent: 88, provenance: 'registry', verified: false },
  { id: 'cervical', label: { en: 'Cervical', bm: 'Serviks' }, percent: 57, provenance: 'registry', verified: false }
]

/**
 * The registry does not publish how many cancers are hereditary, so this is
 * explicitly an international estimate and is labelled as such in the UI.
 */
export const HEREDITARY_SHARE = {
  value: '5–10%',
  label: {
    en: 'of all cancers are thought to be caused by an inherited gene change',
    bm: 'daripada semua kanser dipercayai berpunca daripada perubahan gen yang diwarisi'
  },
  provenance: 'international',
  note: {
    en: 'The Malaysian registry does not publish this figure.',
    bm: 'Pendaftaran kanser Malaysia tidak menerbitkan angka ini.'
  },
  verified: false
}

export default { LIFETIME_RISK, TOP_CANCERS, LATE_STAGE, HEREDITARY_SHARE }
