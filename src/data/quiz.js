/**
 * Short public-awareness quiz.
 *
 * Written at a level the general public can answer — no clinical jargon, no
 * numbers a layperson would have to memorise. Questions deliberately avoid
 * asserting specific screening ages or intervals, because those belong to the
 * CPG layer and are marked provisional there; a quiz must not become a back
 * door for unverified clinical values.
 *
 * A companion quiz generated inside the NotebookLM notebook (grounded solely in
 * the CPGs) is linked from the same panel — see src/config/notebooklm.js.
 */

export const QUIZ = [
  {
    id: 'q1',
    question: {
      en: 'If a close relative had cancer, does that mean you will definitely get it too?',
      bm: 'Jika saudara terdekat menghidap kanser, adakah bermakna anda pasti akan mendapatnya juga?'
    },
    options: [
      { id: 'a', en: 'Yes, it is certain', bm: 'Ya, ia pasti' },
      { id: 'b', en: 'No, but your risk may be higher than average', bm: 'Tidak, tetapi risiko anda mungkin lebih tinggi daripada purata' },
      { id: 'c', en: 'No, family history makes no difference at all', bm: 'Tidak, sejarah keluarga langsung tidak memberi kesan' }
    ],
    answer: 'b',
    explain: {
      en: 'Most people with a family history never develop that cancer. A family history raises your risk, which is why it changes when and how often you should be screened.',
      bm: 'Kebanyakan orang yang mempunyai sejarah keluarga tidak menghidap kanser tersebut. Sejarah keluarga meningkatkan risiko, dan itulah sebabnya ia mengubah bila dan berapa kerap anda perlu menjalani saringan.'
    }
  },
  {
    id: 'q2',
    question: {
      en: 'Which of these counts as a "close" (first-degree) relative?',
      bm: 'Antara berikut, siapakah yang dikira saudara "terdekat" (darjah pertama)?'
    },
    options: [
      { id: 'a', en: 'Your parent, brother, sister or child', bm: 'Ibu bapa, adik-beradik atau anak anda' },
      { id: 'b', en: 'Your cousin', bm: 'Sepupu anda' },
      { id: 'c', en: 'Your grandparent', bm: 'Datuk atau nenek anda' }
    ],
    answer: 'a',
    explain: {
      en: 'First-degree relatives share about half your genes: parents, brothers, sisters and children. Grandparents, aunts, uncles, nieces and nephews are second-degree.',
      bm: 'Saudara darjah pertama berkongsi kira-kira separuh gen anda: ibu bapa, adik-beradik dan anak. Datuk nenek, pak cik, mak cik dan anak saudara adalah darjah kedua.'
    }
  },
  {
    id: 'q3',
    question: {
      en: 'Why does screening matter even when you feel completely well?',
      bm: 'Mengapa saringan penting walaupun anda berasa sihat sepenuhnya?'
    },
    options: [
      { id: 'a', en: 'It can find cancer early, before symptoms start, when treatment works best', bm: 'Ia boleh mengesan kanser lebih awal, sebelum gejala bermula, ketika rawatan paling berkesan' },
      { id: 'b', en: 'It prevents you from ever getting cancer', bm: 'Ia menghalang anda daripada menghidap kanser selama-lamanya' },
      { id: 'c', en: 'It is only useful if you already have symptoms', bm: 'Ia hanya berguna jika anda sudah mempunyai gejala' }
    ],
    answer: 'a',
    explain: {
      en: 'Screening is done on people with no symptoms. Cancers found early are usually easier to treat than cancers found late.',
      bm: 'Saringan dilakukan ke atas orang yang tiada gejala. Kanser yang dikesan awal biasanya lebih mudah dirawat berbanding yang dikesan lewat.'
    }
  },
  {
    id: 'q4',
    question: {
      en: 'You have lost a noticeable amount of weight over a few months without trying. What should you do?',
      bm: 'Anda kehilangan berat badan yang ketara dalam beberapa bulan tanpa cuba. Apa yang patut anda lakukan?'
    },
    options: [
      { id: 'a', en: 'Wait and see if it continues for another year', bm: 'Tunggu dan lihat jika ia berterusan selama setahun lagi' },
      { id: 'b', en: 'Get it checked by a doctor', bm: 'Dapatkan pemeriksaan doktor' },
      { id: 'c', en: 'Nothing — losing weight is always good news', bm: 'Tiada apa-apa — kehilangan berat badan sentiasa berita baik' }
    ],
    answer: 'b',
    explain: {
      en: 'Unintentional weight loss is a general warning sign with many possible causes. It is worth checking rather than waiting.',
      bm: 'Kehilangan berat badan tanpa sengaja adalah tanda amaran umum dengan banyak kemungkinan punca. Ia patut diperiksa, bukan ditunggu.'
    }
  },
  {
    id: 'q5',
    question: {
      en: 'Which of these should make you call 999 rather than book a clinic appointment?',
      bm: 'Antara berikut, yang manakah patut membuat anda menghubungi 999 dan bukan menempah temu janji klinik?'
    },
    options: [
      { id: 'a', en: 'A cough that has lasted four weeks', bm: 'Batuk yang berlarutan empat minggu' },
      { id: 'b', en: 'Severe difficulty breathing or heavy bleeding that will not stop', bm: 'Kesukaran bernafas yang teruk atau pendarahan berat yang tidak berhenti' },
      { id: 'c', en: 'A lump you noticed last month', bm: 'Ketulan yang anda perasan bulan lepas' }
    ],
    answer: 'b',
    explain: {
      en: '999 is for severe, sudden problems — struggling to breathe, heavy bleeding, choking, severe chest pain. A persistent cough or a lump needs a doctor soon, but not an ambulance.',
      bm: '999 adalah untuk masalah teruk dan mengejut — sukar bernafas, pendarahan berat, tercekik, sakit dada teruk. Batuk berpanjangan atau ketulan perlu jumpa doktor segera, tetapi bukan ambulans.'
    }
  },
  {
    id: 'q6',
    question: {
      en: 'The HPV vaccine protects against most cervical cancers. Does a vaccinated woman still need cervical screening?',
      bm: 'Vaksin HPV melindungi daripada kebanyakan kanser serviks. Adakah wanita yang divaksin masih perlu menjalani saringan serviks?'
    },
    options: [
      { id: 'a', en: 'Yes — the vaccine does not cover every type', bm: 'Ya — vaksin tidak melindungi daripada semua jenis' },
      { id: 'b', en: 'No — the vaccine replaces screening', bm: 'Tidak — vaksin menggantikan saringan' },
      { id: 'c', en: 'Only if she has symptoms', bm: 'Hanya jika dia mempunyai gejala' }
    ],
    answer: 'a',
    explain: {
      en: 'Vaccination and screening work together. The vaccine prevents most, but not all, cervical cancers, so screening still applies.',
      bm: 'Vaksinasi dan saringan bekerja bersama. Vaksin mencegah kebanyakan, tetapi bukan semua, kanser serviks, jadi saringan masih diperlukan.'
    }
  },
  {
    id: 'q7',
    question: {
      en: 'A lump in the neck that does not go away is most typically the first sign of which cancer in this tool?',
      bm: 'Ketulan di leher yang tidak hilang paling lazim menjadi tanda pertama kanser yang mana dalam alat ini?'
    },
    options: [
      { id: 'a', en: 'Colorectal cancer', bm: 'Kanser kolorektal' },
      { id: 'b', en: 'Nasopharyngeal cancer', bm: 'Kanser nasofarinks' },
      { id: 'c', en: 'Breast cancer', bm: 'Kanser payudara' }
    ],
    answer: 'b',
    explain: {
      en: 'A painless neck lump is the commonest first sign of nasopharyngeal cancer. Blocked nose, one-sided ear symptoms and blood-stained nasal discharge are others.',
      bm: 'Ketulan leher tanpa sakit adalah tanda pertama paling biasa bagi kanser nasofarinks. Hidung tersumbat, gejala telinga sebelah dan lelehan hidung berdarah adalah tanda lain.'
    }
  },
  {
    id: 'q8',
    question: {
      en: 'What is the single most effective thing a smoker can do to lower their lung cancer risk?',
      bm: 'Apakah perkara paling berkesan yang boleh dilakukan oleh perokok untuk mengurangkan risiko kanser paru-paru?'
    },
    options: [
      { id: 'a', en: 'Switch to fewer cigarettes a day', bm: 'Kurangkan bilangan rokok sehari' },
      { id: 'b', en: 'Stop smoking completely', bm: 'Berhenti merokok sepenuhnya' },
      { id: 'c', en: 'Take vitamin supplements', bm: 'Ambil suplemen vitamin' }
    ],
    answer: 'b',
    explain: {
      en: 'Stopping completely lowers risk far more than cutting down. Free cessation support is available at government clinics (Klinik Berhenti Merokok).',
      bm: 'Berhenti sepenuhnya mengurangkan risiko jauh lebih banyak daripada mengurangkan jumlah. Sokongan berhenti merokok percuma tersedia di klinik kerajaan (Klinik Berhenti Merokok).'
    }
  },
  {
    id: 'q9',
    question: {
      en: 'What is this app able to do?',
      bm: 'Apakah yang boleh dilakukan oleh aplikasi ini?'
    },
    options: [
      { id: 'a', en: 'Diagnose cancer', bm: 'Mendiagnos kanser' },
      { id: 'b', en: 'Help you understand your family risk and what to discuss with a doctor', bm: 'Membantu anda memahami risiko keluarga dan apa yang perlu dibincangkan dengan doktor' },
      { id: 'c', en: 'Replace your doctor', bm: 'Menggantikan doktor anda' }
    ],
    answer: 'b',
    explain: {
      en: 'This is an education and decision-support prototype. It never diagnoses, and every result is meant to be reviewed by a clinician.',
      bm: 'Ini adalah prototaip pendidikan dan sokongan keputusan. Ia tidak pernah mendiagnos, dan setiap keputusan perlu disemak oleh doktor.'
    }
  }
]

export default QUIZ
