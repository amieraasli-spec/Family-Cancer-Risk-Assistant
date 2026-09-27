/**
 * Risk stratification.
 *
 * Deliberately rule-based and fully transparent: every result carries the
 * `reasons` that produced it, so a clinician reviewing the printed summary can
 * see exactly why a person was placed in a band. No model inference is used to
 * decide a risk level.
 *
 * Bands
 *   average   — no significant family history found
 *   increased — one close relative, an early diagnosis, or a cluster of
 *               second-degree relatives
 *   high      — a known inherited condition, or a strong family pattern
 *
 * These bands drive which screening block is read from the CPG module. They do
 * not diagnose anything and do not replace formal genetic risk assessment.
 */

import { MODULES } from '../data/cpg.js'

export const RISK = { AVERAGE: 'average', INCREASED: 'increased', HIGH: 'high' }

export const RISK_ORDER = [RISK.AVERAGE, RISK.INCREASED, RISK.HIGH]

/** Inherited conditions and the modules they raise to high risk. */
export const INHERITED_CONDITIONS = {
  lynch: {
    label: { en: 'Lynch syndrome (HNPCC)', bm: 'Sindrom Lynch (HNPCC)' },
    raises: ['colorectal']
  },
  fap: {
    label: { en: 'Familial adenomatous polyposis (FAP)', bm: 'Poliposis adenomatosa familial (FAP)' },
    raises: ['colorectal']
  },
  brca: {
    label: { en: 'BRCA1 or BRCA2 gene change', bm: 'Perubahan gen BRCA1 atau BRCA2' },
    raises: ['breast']
  },
  lifraumeni: {
    label: { en: 'Li-Fraumeni syndrome', bm: 'Sindrom Li-Fraumeni' },
    raises: ['breast', 'colorectal', 'lung']
  }
}

/** Age below which a relative's diagnosis counts as "early". */
const EARLY_DIAGNOSIS_AGE = 50
/** Age below which a single first-degree diagnosis alone signals high risk. */
const VERY_EARLY_DIAGNOSIS_AGE = 40

function higherOf (a, b) {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

/**
 * @param {string} moduleId          e.g. 'colorectal'
 * @param {Array}  relatives         [{ degree: 1|2, cancer, ageAtDiagnosis, side }]
 * @param {Array}  inheritedIds      keys of INHERITED_CONDITIONS the user selected
 * @param {object} profile           { age, sex, ethnicity, state }
 */
export function assessModule (moduleId, relatives, inheritedIds, profile) {
  const affected = relatives.filter(r => r.cancer === moduleId)
  const firstDegree = affected.filter(r => Number(r.degree) === 1)
  const secondDegree = affected.filter(r => Number(r.degree) === 2)

  const ages = affected
    .map(r => Number(r.ageAtDiagnosis))
    .filter(n => Number.isFinite(n) && n > 0)
  const youngestAge = ages.length ? Math.min(...ages) : null

  let level = RISK.AVERAGE
  const reasons = []

  // 1. A confirmed inherited condition always dominates.
  for (const id of inheritedIds) {
    const cond = INHERITED_CONDITIONS[id]
    if (cond && cond.raises.includes(moduleId)) {
      level = RISK.HIGH
      reasons.push({
        en: `A known inherited condition in your family (${cond.label.en}) affects this cancer.`,
        bm: `Keadaan warisan yang diketahui dalam keluarga anda (${cond.label.bm}) mempengaruhi kanser ini.`
      })
    }
  }

  // 2. Family pattern.
  if (firstDegree.length >= 2) {
    level = higherOf(level, RISK.HIGH)
    reasons.push({
      en: `${firstDegree.length} close relatives (parent, brother, sister or child) had this cancer.`,
      bm: `${firstDegree.length} saudara terdekat (ibu bapa, adik-beradik atau anak) menghidap kanser ini.`
    })
  } else if (firstDegree.length === 1) {
    const early = firstDegree.some(
      r => Number(r.ageAtDiagnosis) > 0 && Number(r.ageAtDiagnosis) < VERY_EARLY_DIAGNOSIS_AGE
    )
    level = higherOf(level, early ? RISK.HIGH : RISK.INCREASED)
    reasons.push(
      early
        ? {
            en: `One close relative was diagnosed before age ${VERY_EARLY_DIAGNOSIS_AGE}.`,
            bm: `Seorang saudara terdekat didiagnos sebelum umur ${VERY_EARLY_DIAGNOSIS_AGE} tahun.`
          }
        : {
            en: 'One close relative (parent, brother, sister or child) had this cancer.',
            bm: 'Seorang saudara terdekat (ibu bapa, adik-beradik atau anak) menghidap kanser ini.'
          }
    )
  }

  if (secondDegree.length >= 2) {
    level = higherOf(level, RISK.INCREASED)
    reasons.push({
      en: `${secondDegree.length} more distant relatives (grandparent, aunt, uncle, niece or nephew) had this cancer.`,
      bm: `${secondDegree.length} saudara lebih jauh (datuk nenek, pak cik, mak cik, anak saudara) menghidap kanser ini.`
    })
  } else if (secondDegree.length === 1 && firstDegree.length === 0) {
    reasons.push({
      en: 'One more distant relative had this cancer. On its own this usually does not change your screening plan.',
      bm: 'Seorang saudara lebih jauh menghidap kanser ini. Ia biasanya tidak mengubah pelan saringan anda.'
    })
  }

  if (youngestAge !== null && youngestAge < EARLY_DIAGNOSIS_AGE && level === RISK.AVERAGE) {
    level = RISK.INCREASED
    reasons.push({
      en: `A relative was diagnosed young (age ${youngestAge}).`,
      bm: `Seorang saudara didiagnos pada usia muda (${youngestAge} tahun).`
    })
  }

  return {
    moduleId,
    level,
    reasons,
    youngestAffectedAge: youngestAge,
    counts: { firstDegree: firstDegree.length, secondDegree: secondDegree.length },
    plan: buildPlan(moduleId, level, youngestAge, profile)
  }
}

/** Read the screening block for this band out of the CPG module. */
export function buildPlan (moduleId, level, youngestAge, profile) {
  const mod = MODULES[moduleId]
  if (!mod) return null

  const block =
    level === RISK.HIGH ? mod.highRisk : level === RISK.INCREASED ? mod.increasedRisk : mod.averageRisk

  // "10 years before the youngest affected relative" — computed, never guessed.
  let suggestedStartAge = block.startAge ?? null
  if (youngestAge && level !== RISK.AVERAGE) {
    const derived = youngestAge - 10
    if (suggestedStartAge === null || derived < suggestedStartAge) suggestedStartAge = derived
  }
  if (suggestedStartAge !== null) suggestedStartAge = Math.max(18, suggestedStartAge)

  const userAge = Number(profile?.age)
  const dueNow =
    suggestedStartAge !== null && Number.isFinite(userAge) && userAge >= suggestedStartAge

  return {
    test: block.test,
    interval: block.interval,
    startRule: block.startRule || null,
    note: block.note || null,
    suggestedStartAge,
    dueNow,
    provisional: mod.status !== 'anchored',
    source: mod.source,
    citation: mod.citation
  }
}

/** Which modules apply to this person, before family history is considered. */
export function applicableModules (profile) {
  const sex = profile?.sex
  return Object.values(MODULES).filter(m => {
    if (m.id === 'cervical' && sex === 'male') return false
    if (m.id === 'breast' && sex === 'male') return false // male breast cancer exists but is out of this prototype's scope
    return true
  })
}

/** Full assessment across every applicable module, highest risk first. */
export function assessAll (profile, relatives, inheritedIds) {
  return applicableModules(profile)
    .map(m => assessModule(m.id, relatives, inheritedIds, profile))
    .sort((a, b) => RISK_ORDER.indexOf(b.level) - RISK_ORDER.indexOf(a.level))
}

export default assessAll
