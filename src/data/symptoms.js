/**
 * Targeted symptom check (Phase 6).
 *
 * Two rules govern this file:
 *   1. Red-flag questions are generated only for the cancers a person was
 *      actually assessed for — everyone also gets the constitutional group.
 *   2. The 999 emergency line is reserved strictly for severe acute
 *      presentations. Everything else escalates to "see your nearest doctor".
 *
 * A tool that shouts "emergency" at everything stops being believed.
 */

/** Shown to everyone: non-specific symptoms worth acting on. */
export const CONSTITUTIONAL = {
  id: 'constitutional',
  title: { en: 'General symptoms', bm: 'Gejala umum' },
  items: [
    {
      id: 'weight-loss',
      en: 'Losing weight without trying (more than 5% of your body weight in 6 months)',
      bm: 'Kehilangan berat badan tanpa cuba (lebih 5% berat badan dalam 6 bulan)'
    },
    { id: 'appetite', en: 'Losing your appetite for several weeks', bm: 'Hilang selera makan selama beberapa minggu' },
    { id: 'fatigue', en: 'Feeling very tired all the time, not helped by rest', bm: 'Rasa sangat letih sepanjang masa, tidak hilang walaupun berehat' },
    { id: 'fever', en: 'Fevers or night sweats that keep coming back', bm: 'Demam atau berpeluh malam yang berulang' },
    { id: 'lump', en: 'Any new lump anywhere that does not go away', bm: 'Sebarang ketulan baharu yang tidak hilang' }
  ]
}

/**
 * ACUTE presentations only. These — and only these — justify the 999 prompt.
 * Keep this list short and genuinely emergency-grade.
 */
export const EMERGENCY = {
  id: 'emergency',
  title: { en: 'Get emergency help now', bm: 'Dapatkan bantuan kecemasan sekarang' },
  items: [
    { id: 'breathless', en: 'Severe shortness of breath, or struggling to breathe', bm: 'Sesak nafas teruk, atau sukar bernafas' },
    { id: 'bleeding', en: 'Heavy bleeding that will not stop', bm: 'Pendarahan berat yang tidak berhenti' },
    { id: 'choking', en: 'Choking, or unable to swallow your own saliva', bm: 'Tercekik, atau tidak boleh menelan air liur sendiri' },
    { id: 'chestpain', en: 'Severe chest pain', bm: 'Sakit dada yang teruk' },
    { id: 'collapse', en: 'Fainting, collapse, or sudden confusion', bm: 'Pengsan, rebah, atau keliru secara tiba-tiba' }
  ]
}

/** Red-flag questions per module, generated only for assessed cancers. */
export const RED_FLAGS = {
  colorectal: [
    { id: 'crc-blood', en: 'Blood in your stool, or black tarry stools', bm: 'Darah dalam najis, atau najis hitam pekat' },
    { id: 'crc-habit', en: 'Your bowel habit has changed for more than 6 weeks', bm: 'Tabiat buang air besar berubah melebihi 6 minggu' },
    { id: 'crc-pain', en: 'Ongoing tummy pain, cramping or bloating', bm: 'Sakit perut, senggugut atau kembung berpanjangan' }
  ],
  breast: [
    { id: 'br-lump', en: 'A new lump in the breast or armpit', bm: 'Ketulan baharu pada payudara atau ketiak' },
    { id: 'br-skin', en: 'Skin dimpling, puckering, or nipple turning inward', bm: 'Kulit berlekuk, berkedut, atau puting tertarik ke dalam' },
    { id: 'br-discharge', en: 'Blood-stained discharge from the nipple', bm: 'Lelehan berdarah dari puting' }
  ],
  cervical: [
    { id: 'cx-bleed', en: 'Bleeding between periods, after sex, or after menopause', bm: 'Pendarahan antara haid, selepas hubungan seks, atau selepas menopaus' },
    { id: 'cx-discharge', en: 'Unusual or foul-smelling vaginal discharge', bm: 'Lelehan faraj luar biasa atau berbau busuk' },
    { id: 'cx-pain', en: 'Persistent pelvic or lower back pain', bm: 'Sakit pelvis atau belakang bawah berpanjangan' }
  ],
  lung: [
    { id: 'lu-cough', en: 'A cough lasting more than 3 weeks, or a change in a long-standing cough', bm: 'Batuk melebihi 3 minggu, atau perubahan pada batuk lama' },
    { id: 'lu-haemoptysis', en: 'Coughing up blood', bm: 'Batuk berdarah' },
    { id: 'lu-infection', en: 'Chest infections that keep coming back', bm: 'Jangkitan dada yang berulang' }
  ],
  nasopharyngeal: [
    { id: 'npc-neck', en: 'A lump in the neck that does not go away', bm: 'Ketulan di leher yang tidak hilang' },
    { id: 'npc-nose', en: 'Blood-stained nasal discharge, or blood in saliva when clearing your throat', bm: 'Lelehan hidung berdarah, atau darah dalam air liur ketika berdehem' },
    { id: 'npc-ear', en: 'Hearing loss, ringing, or a blocked feeling in one ear only', bm: 'Kehilangan pendengaran, berdengung, atau rasa tersumbat pada sebelah telinga sahaja' }
  ]
}

/** Build the question set for the modules this person was actually assessed for. */
export function buildSymptomGroups (moduleIds, moduleNames) {
  const groups = moduleIds
    .filter(id => RED_FLAGS[id])
    .map(id => ({ id, title: moduleNames[id], items: RED_FLAGS[id] }))
  groups.push(CONSTITUTIONAL)
  return groups
}

export default { RED_FLAGS, CONSTITUTIONAL, EMERGENCY, buildSymptomGroups }
