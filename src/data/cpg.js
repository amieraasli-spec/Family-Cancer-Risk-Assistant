/**
 * CPG anchor layer.
 *
 * RAG-FIRST PRINCIPLE (Phase 2 of the prompt library)
 * ---------------------------------------------------
 * This file is the retrieval target. Every screening value the app shows must
 * come from a retrieved Malaysian Clinical Practice Guideline, not from the
 * model's memory and not from international practice.
 *
 * Each module therefore carries an explicit `status`:
 *
 *   'anchored'    — values were extracted from the named source document and
 *                   the `citation` string points at the exact recommendation
 *                   or table. Safe to display as guideline-backed.
 *   'provisional' — no guideline document has been retrieved for this module
 *                   yet. The UI MUST show the fail-safe banner and must not
 *                   present these values as guideline-backed.
 *
 * Every module below is currently 'provisional'. The source PDFs have not been
 * ingested into this repository, so nothing here has been verified against a
 * primary document. The values are placeholders that reflect widely published
 * Malaysian programme practice; they are shown to demonstrate the interface,
 * and each one must be replaced with a verbatim extraction before any use with
 * real patients.
 *
 * TO ANCHOR A MODULE
 * ------------------
 *   1. Obtain the CPG PDF named in `source`.
 *   2. Replace each value with the text/number as printed in the document.
 *   3. Put the exact recommendation number or table reference in `citation`.
 *   4. Set `status: 'anchored'` and fill `verifiedOn` / `verifiedBy`.
 *
 * Do not set `status: 'anchored'` without step 1.
 */

export const CPG_STATUS = {
  ANCHORED: 'anchored',
  PROVISIONAL: 'provisional'
}

export const MODULES = {
  colorectal: {
    id: 'colorectal',
    name: { en: 'Colorectal cancer', bm: 'Kanser kolorektal' },
    icon: '🩺',
    status: CPG_STATUS.PROVISIONAL,
    source: {
      title: 'CPG Management of Colorectal Carcinoma',
      year: 2017,
      org: 'Ministry of Health Malaysia'
    },
    citation: null,
    verifiedOn: null,
    verifiedBy: null,
    averageRisk: {
      startAge: 50,
      test: { en: 'Immunochemical faecal occult blood test (iFOBT)', bm: 'Ujian darah tersembunyi dalam najis (iFOBT)' },
      interval: { en: 'Every year', bm: 'Setiap tahun' },
      note: {
        en: 'Available free at government health clinics for eligible adults.',
        bm: 'Disediakan percuma di klinik kesihatan kerajaan untuk dewasa yang layak.'
      }
    },
    increasedRisk: {
      startAge: 40,
      startRule: {
        en: 'From age 40, or 10 years before the youngest affected relative was diagnosed — whichever comes first.',
        bm: 'Dari umur 40 tahun, atau 10 tahun sebelum umur saudara termuda didiagnos — mana yang lebih awal.'
      },
      test: { en: 'Colonoscopy', bm: 'Kolonoskopi' },
      interval: { en: 'Every 5 years, or as advised by your doctor', bm: 'Setiap 5 tahun, atau mengikut nasihat doktor' }
    },
    highRisk: {
      startAge: 25,
      startRule: {
        en: 'Earlier and more frequent surveillance, arranged through a genetics or colorectal clinic.',
        bm: 'Pemantauan lebih awal dan lebih kerap, diaturkan melalui klinik genetik atau kolorektal.'
      },
      test: { en: 'Colonoscopy under specialist supervision', bm: 'Kolonoskopi di bawah penyeliaan pakar' },
      interval: { en: 'Every 1–2 years', bm: 'Setiap 1–2 tahun' }
    },
    warningSigns: {
      en: [
        'Blood in the stool, or black tarry stools',
        'A lasting change in bowel habit (looser, harder, or more frequent) for more than 6 weeks',
        'Feeling that the bowel does not empty completely',
        'Ongoing abdominal pain, cramping or bloating',
        'Unexplained tiredness or pale skin (possible anaemia)'
      ],
      bm: [
        'Darah dalam najis, atau najis hitam pekat',
        'Perubahan tabiat buang air besar (lebih cair, lebih keras, atau lebih kerap) melebihi 6 minggu',
        'Rasa usus tidak kosong sepenuhnya selepas buang air besar',
        'Sakit perut, senggugut atau kembung berpanjangan',
        'Letih luar biasa atau kulit pucat (kemungkinan anemia)'
      ]
    }
  },

  breast: {
    id: 'breast',
    name: { en: 'Breast cancer', bm: 'Kanser payudara' },
    icon: '🎀',
    status: CPG_STATUS.PROVISIONAL,
    source: {
      title: 'CPG Management of Breast Cancer (3rd Edition)',
      year: 2021,
      org: 'Ministry of Health Malaysia'
    },
    citation: null,
    verifiedOn: null,
    verifiedBy: null,
    averageRisk: {
      startAge: 40,
      test: { en: 'Mammogram, plus breast awareness', bm: 'Mamogram, serta kesedaran payudara' },
      interval: { en: 'Every 2 years from age 50 to 74; discuss starting at 40 with your doctor', bm: 'Setiap 2 tahun dari umur 50 hingga 74; bincang untuk mula pada umur 40 dengan doktor' },
      note: {
        en: 'Get to know how your breasts normally look and feel, and report any change.',
        bm: 'Kenali rupa dan rasa payudara anda yang biasa, dan laporkan sebarang perubahan.'
      }
    },
    increasedRisk: {
      startAge: 40,
      startRule: {
        en: 'From age 40, or 10 years before the youngest affected relative was diagnosed — whichever comes first.',
        bm: 'Dari umur 40 tahun, atau 10 tahun sebelum umur saudara termuda didiagnos — mana yang lebih awal.'
      },
      test: { en: 'Annual mammogram; ultrasound may be added for dense breasts', bm: 'Mamogram setiap tahun; ultrasound mungkin ditambah untuk payudara padat' },
      interval: { en: 'Every year', bm: 'Setiap tahun' }
    },
    highRisk: {
      startAge: 30,
      startRule: {
        en: 'Referral to a genetics or breast clinic for a personalised surveillance plan.',
        bm: 'Rujukan ke klinik genetik atau payudara untuk pelan pemantauan peribadi.'
      },
      test: { en: 'Annual mammogram ± breast MRI, under specialist supervision', bm: 'Mamogram tahunan ± MRI payudara, di bawah penyeliaan pakar' },
      interval: { en: 'Every year', bm: 'Setiap tahun' }
    },
    warningSigns: {
      en: [
        'A new lump or thickening in the breast or armpit',
        'Change in the size or shape of one breast',
        'Skin dimpling, puckering, or an orange-peel texture',
        'A nipple that turns inward, or a rash on the nipple',
        'Blood-stained or unusual nipple discharge'
      ],
      bm: [
        'Ketulan baharu atau pengerasan pada payudara atau ketiak',
        'Perubahan saiz atau bentuk pada sebelah payudara',
        'Kulit berlekuk, berkedut, atau bertekstur seperti kulit oren',
        'Puting yang tertarik ke dalam, atau ruam pada puting',
        'Lelehan puting berdarah atau luar biasa'
      ]
    }
  },

  cervical: {
    id: 'cervical',
    name: { en: 'Cervical cancer', bm: 'Kanser serviks' },
    icon: '🌸',
    status: CPG_STATUS.PROVISIONAL,
    source: {
      title: 'CPG Management of Cervical Cancer / Program Saringan Kanser Serviks',
      year: null,
      org: 'Ministry of Health Malaysia'
    },
    citation: null,
    verifiedOn: null,
    verifiedBy: null,
    averageRisk: {
      startAge: 30,
      test: { en: 'HPV DNA test (or Pap smear where HPV testing is unavailable)', bm: 'Ujian DNA HPV (atau ujian Pap jika ujian HPV tiada)' },
      interval: { en: 'Every 5 years for HPV testing; every 3 years for Pap smear', bm: 'Setiap 5 tahun untuk ujian HPV; setiap 3 tahun untuk ujian Pap' },
      note: {
        en: 'HPV vaccination is offered to schoolgirls nationally and prevents most cervical cancers. Vaccination does not replace screening.',
        bm: 'Vaksin HPV ditawarkan kepada pelajar perempuan di seluruh negara dan mencegah kebanyakan kanser serviks. Vaksin tidak menggantikan saringan.'
      }
    },
    increasedRisk: {
      startAge: 25,
      startRule: {
        en: 'Discuss earlier or more frequent screening with your doctor.',
        bm: 'Bincang saringan lebih awal atau lebih kerap dengan doktor anda.'
      },
      test: { en: 'HPV DNA test with cytology', bm: 'Ujian DNA HPV bersama sitologi' },
      interval: { en: 'As advised by your doctor', bm: 'Mengikut nasihat doktor anda' }
    },
    highRisk: {
      startAge: 25,
      startRule: {
        en: 'Specialist gynaecology follow-up, especially if immunosuppressed.',
        bm: 'Susulan pakar sakit puan, terutamanya jika sistem imun lemah.'
      },
      test: { en: 'HPV DNA test with cytology ± colposcopy', bm: 'Ujian DNA HPV bersama sitologi ± kolposkopi' },
      interval: { en: 'Every year, or as advised', bm: 'Setiap tahun, atau mengikut nasihat' }
    },
    warningSigns: {
      en: [
        'Bleeding between periods, after sex, or after menopause',
        'Unusual or foul-smelling vaginal discharge',
        'Pain during sex',
        'Persistent pelvic or lower back pain'
      ],
      bm: [
        'Pendarahan antara haid, selepas hubungan seks, atau selepas menopaus',
        'Lelehan faraj luar biasa atau berbau busuk',
        'Sakit semasa hubungan seks',
        'Sakit pelvis atau belakang bawah yang berpanjangan'
      ]
    }
  },

  lung: {
    id: 'lung',
    name: { en: 'Lung cancer', bm: 'Kanser paru-paru' },
    icon: '🫁',
    status: CPG_STATUS.PROVISIONAL,
    source: {
      title: 'CPG Management of Lung Cancer',
      year: null,
      org: 'Ministry of Health Malaysia'
    },
    citation: null,
    verifiedOn: null,
    verifiedBy: null,
    averageRisk: {
      startAge: null,
      test: { en: 'No routine population screening in Malaysia. Stopping smoking is the single most effective step.', bm: 'Tiada saringan rutin populasi di Malaysia. Berhenti merokok adalah langkah paling berkesan.' },
      interval: { en: 'Not applicable', bm: 'Tidak berkenaan' },
      note: {
        en: 'Ask your clinic about free smoking-cessation support (Klinik Berhenti Merokok).',
        bm: 'Tanya klinik anda tentang sokongan berhenti merokok percuma (Klinik Berhenti Merokok).'
      }
    },
    increasedRisk: {
      startAge: 50,
      startRule: {
        en: 'Discuss with your doctor whether low-dose CT screening is appropriate for you. Availability in Malaysia is limited.',
        bm: 'Bincang dengan doktor sama ada saringan CT dos rendah sesuai untuk anda. Ketersediaan di Malaysia adalah terhad.'
      },
      test: { en: 'Low-dose CT chest (specialist decision)', bm: 'CT dada dos rendah (keputusan pakar)' },
      interval: { en: 'As advised by your doctor', bm: 'Mengikut nasihat doktor anda' }
    },
    highRisk: {
      startAge: 50,
      startRule: {
        en: 'Specialist respiratory assessment, particularly with heavy smoking history plus family history.',
        bm: 'Penilaian pakar respiratori, terutamanya dengan sejarah merokok berat serta sejarah keluarga.'
      },
      test: { en: 'Low-dose CT chest under specialist supervision', bm: 'CT dada dos rendah di bawah penyeliaan pakar' },
      interval: { en: 'As advised by your specialist', bm: 'Mengikut nasihat pakar anda' }
    },
    warningSigns: {
      en: [
        'A cough that lasts more than 3 weeks, or a change in a long-standing cough',
        'Coughing up blood',
        'Chest pain that is worse on breathing or coughing',
        'Breathlessness that is new or getting worse',
        'Repeated chest infections'
      ],
      bm: [
        'Batuk melebihi 3 minggu, atau perubahan pada batuk lama',
        'Batuk berdarah',
        'Sakit dada yang bertambah teruk semasa bernafas atau batuk',
        'Sesak nafas yang baharu atau semakin teruk',
        'Jangkitan dada berulang'
      ]
    }
  },

  nasopharyngeal: {
    id: 'nasopharyngeal',
    name: { en: 'Nasopharyngeal cancer (NPC)', bm: 'Kanser nasofarinks (NPC)' },
    icon: '👂',
    status: CPG_STATUS.PROVISIONAL,
    source: {
      title: 'CPG Management of Nasopharyngeal Carcinoma',
      year: null,
      org: 'Ministry of Health Malaysia'
    },
    citation: null,
    verifiedOn: null,
    verifiedBy: null,
    averageRisk: {
      startAge: null,
      test: { en: 'No routine population screening. Awareness of early symptoms is the priority.', bm: 'Tiada saringan rutin populasi. Kesedaran tentang gejala awal adalah keutamaan.' },
      interval: { en: 'Not applicable', bm: 'Tidak berkenaan' },
      note: {
        en: 'NPC is notably more common in some Malaysian communities, particularly among Chinese and Bidayuh populations.',
        bm: 'NPC lebih kerap berlaku dalam sesetengah komuniti di Malaysia, terutamanya penduduk Cina dan Bidayuh.'
      }
    },
    increasedRisk: {
      startAge: 30,
      startRule: {
        en: 'With an affected first-degree relative, report nose or ear symptoms early rather than waiting.',
        bm: 'Jika ada saudara terdekat yang terjejas, laporkan gejala hidung atau telinga lebih awal.'
      },
      test: { en: 'ENT assessment (nasoendoscopy) if symptoms appear; EBV serology where offered', bm: 'Penilaian pakar ENT (nasoendoskopi) jika gejala muncul; serologi EBV jika ditawarkan' },
      interval: { en: 'Symptom-triggered, or as advised by your doctor', bm: 'Berdasarkan gejala, atau mengikut nasihat doktor' }
    },
    highRisk: {
      startAge: 30,
      startRule: {
        en: 'ENT clinic follow-up for families with several affected members.',
        bm: 'Susulan klinik ENT untuk keluarga dengan beberapa ahli yang terjejas.'
      },
      test: { en: 'Nasoendoscopy ± EBV serology under ENT supervision', bm: 'Nasoendoskopi ± serologi EBV di bawah penyeliaan ENT' },
      interval: { en: 'As advised by your specialist', bm: 'Mengikut nasihat pakar anda' }
    },
    warningSigns: {
      en: [
        'A lump in the neck that does not go away (the commonest first sign)',
        'Blood-stained nasal discharge, or blood in the saliva when clearing the throat',
        'Blocked nose or nosebleeds on one side only',
        'Hearing loss, ringing, or a blocked feeling in one ear',
        'Persistent headache, double vision, or numbness of the face'
      ],
      bm: [
        'Ketulan di leher yang tidak hilang (tanda pertama paling biasa)',
        'Lelehan hidung berdarah, atau darah dalam air liur ketika berdehem',
        'Hidung tersumbat atau berdarah pada sebelah sahaja',
        'Kehilangan pendengaran, berdengung, atau rasa tersumbat pada sebelah telinga',
        'Sakit kepala berpanjangan, penglihatan berganda, atau kebas pada muka'
      ]
    }
  }
}

export const MODULE_LIST = Object.values(MODULES)

/** True when no guideline document has been retrieved for this module. */
export function isProvisional (moduleId) {
  return MODULES[moduleId]?.status !== CPG_STATUS.ANCHORED
}

/** Human-readable source line, or null when nothing has been retrieved. */
export function sourceLine (moduleId) {
  const m = MODULES[moduleId]
  if (!m) return null
  const { title, year, org } = m.source
  return [title, year, org].filter(Boolean).join(' · ')
}

export default MODULES
