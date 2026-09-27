/**
 * English / Bahasa Malaysia strings.
 * Default is English; UK spelling throughout (Phase 1).
 */

export const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'bm', label: 'Bahasa Malaysia' }
]

export const S = {
  // --- shell -------------------------------------------------------------
  tagline: {
    en: 'Understand your family cancer risk, and what to do next.',
    bm: 'Fahami risiko kanser keluarga anda, dan apa langkah seterusnya.'
  },
  notDiagnostic: {
    en: 'This is a decision-support and education tool. It is not a diagnostic tool and does not confirm any diagnosis. Every result needs review by a doctor.',
    bm: 'Ini adalah alat sokongan keputusan dan pendidikan. Ia bukan alat diagnostik dan tidak mengesahkan sebarang diagnosis. Setiap keputusan perlu disemak oleh doktor.'
  },
  langToggle: { en: 'Bahasa Malaysia', bm: 'English' },

  // --- disclaimer gate ---------------------------------------------------
  gateTitle: { en: 'Before you begin', bm: 'Sebelum anda mula' },
  gatePoints: {
    en: [
      'This tool gives general guidance based on Malaysian clinical practice guidelines. It does not diagnose cancer.',
      'It does not replace your doctor. Please discuss anything it shows you with a healthcare professional.',
      'Nothing you type is stored. Your answers stay on this device and disappear when you close the page.',
      'We never ask for your name, IC number, or phone number.',
      'This is a research and education prototype, not a certified medical device.'
    ],
    bm: [
      'Alat ini memberi panduan umum berdasarkan garis panduan amalan klinikal Malaysia. Ia tidak mendiagnos kanser.',
      'Ia tidak menggantikan doktor anda. Sila bincangkan apa-apa yang dipaparkan dengan profesional kesihatan.',
      'Apa yang anda taip tidak disimpan. Jawapan anda kekal di peranti ini dan hilang apabila anda menutup halaman.',
      'Kami tidak sekali-kali meminta nama, nombor kad pengenalan, atau nombor telefon anda.',
      'Ini adalah prototaip penyelidikan dan pendidikan, bukan peranti perubatan yang diperakui.'
    ]
  },
  gateAccept: { en: 'I understand — continue', bm: 'Saya faham — teruskan' },

  // --- landing hub -------------------------------------------------------
  start: { en: 'Start the assessment', bm: 'Mulakan penilaian' },
  startSub: { en: 'Takes about 5 minutes', bm: 'Mengambil masa kira-kira 5 minit' },
  tileAsk: { en: 'Ask the guidelines', bm: 'Tanya garis panduan' },
  tileAskSub: { en: 'Questions answered from the CPGs only', bm: 'Soalan dijawab daripada CPG sahaja' },
  tileQuiz: { en: 'Quick quiz', bm: 'Kuiz ringkas' },
  tileQuizSub: { en: 'Nine questions, no jargon', bm: 'Sembilan soalan, tanpa istilah sukar' },
  tileData: { en: 'Malaysian cancer data', bm: 'Data kanser Malaysia' },
  tileDataSub: { en: 'From the national registry', bm: 'Daripada pendaftaran kebangsaan' },
  whyTitle: { en: 'Why use this', bm: 'Mengapa gunakan ini' },
  whyItems: {
    en: [
      ['🔍', 'Early detection', 'Cancers found early are usually easier to treat.'],
      ['👨‍👩‍👧', 'Family awareness', 'What runs in your family changes what screening you need.'],
      ['✅', 'An actionable next step', 'You leave with a printable sheet to take to your clinic.'],
      ['🔒', 'Private by design', 'No name, no IC, no phone number. Nothing is stored.']
    ],
    bm: [
      ['🔍', 'Pengesanan awal', 'Kanser yang dikesan awal biasanya lebih mudah dirawat.'],
      ['👨‍👩‍👧', 'Kesedaran keluarga', 'Apa yang ada dalam keluarga anda mengubah saringan yang anda perlukan.'],
      ['✅', 'Langkah seterusnya yang jelas', 'Anda pergi dengan helaian bercetak untuk dibawa ke klinik.'],
      ['🔒', 'Privasi terbina', 'Tiada nama, tiada kad pengenalan, tiada nombor telefon. Tiada apa disimpan.']
    ]
  },

  // --- stepper -----------------------------------------------------------
  steps: {
    en: ['About you', 'Family history', 'Inherited conditions', 'Your plan', 'Feedback'],
    bm: ['Tentang anda', 'Sejarah keluarga', 'Keadaan warisan', 'Pelan anda', 'Maklum balas']
  },
  next: { en: 'Next', bm: 'Seterusnya' },
  back: { en: 'Back', bm: 'Kembali' },

  // --- step 1: profile ---------------------------------------------------
  profileTitle: { en: 'About you', bm: 'Tentang anda' },
  profileIntro: {
    en: 'We only ask what is needed to work out your screening plan. No name, no IC number, no contact details.',
    bm: 'Kami hanya bertanya apa yang diperlukan untuk menentukan pelan saringan anda. Tiada nama, tiada nombor kad pengenalan, tiada butiran perhubungan.'
  },
  age: { en: 'Your age', bm: 'Umur anda' },
  sex: { en: 'Sex at birth', bm: 'Jantina semasa lahir' },
  male: { en: 'Male', bm: 'Lelaki' },
  female: { en: 'Female', bm: 'Perempuan' },
  ethnicity: { en: 'Ethnicity', bm: 'Etnik' },
  ethnicities: {
    en: ['Malay', 'Chinese', 'Indian', 'Bumiputera Sabah', 'Bumiputera Sarawak', 'Other', 'Prefer not to say'],
    bm: ['Melayu', 'Cina', 'India', 'Bumiputera Sabah', 'Bumiputera Sarawak', 'Lain-lain', 'Tidak mahu nyatakan']
  },
  state: { en: 'State', bm: 'Negeri' },
  smoking: { en: 'Do you smoke, or have you smoked before?', bm: 'Adakah anda merokok, atau pernah merokok?' },
  smokingOpts: {
    en: ['Never smoked', 'Used to smoke', 'Smoke now'],
    bm: ['Tidak pernah merokok', 'Pernah merokok', 'Merokok sekarang']
  },

  // --- step 2: family history -------------------------------------------
  familyTitle: { en: 'Family history', bm: 'Sejarah keluarga' },
  familyIntro: {
    en: 'Add any blood relative who has had cancer. If you are not sure of the exact age, give your best guess — it still helps.',
    bm: 'Tambah mana-mana saudara sedarah yang pernah menghidap kanser. Jika anda tidak pasti umurnya, berikan anggaran terbaik — ia tetap membantu.'
  },
  addRelative: { en: 'Add a relative', bm: 'Tambah saudara' },
  noRelatives: {
    en: 'No relatives added yet. If nobody in your family has had cancer, just continue.',
    bm: 'Belum ada saudara ditambah. Jika tiada sesiapa dalam keluarga anda menghidap kanser, teruskan sahaja.'
  },
  relationship: { en: 'Who is this?', bm: 'Siapakah ini?' },
  whichCancer: { en: 'Which cancer?', bm: 'Kanser yang mana?' },
  ageAtDiagnosis: { en: 'Age when diagnosed', bm: 'Umur semasa didiagnos' },
  unknownAge: { en: 'Not sure', bm: 'Tidak pasti' },
  remove: { en: 'Remove', bm: 'Buang' },
  firstDegree: { en: 'Close relative', bm: 'Saudara terdekat' },
  secondDegree: { en: 'More distant relative', bm: 'Saudara lebih jauh' },

  // --- step 3: inherited -------------------------------------------------
  inheritedTitle: { en: 'Known inherited conditions', bm: 'Keadaan warisan yang diketahui' },
  inheritedIntro: {
    en: 'Has anyone in your family been told by a doctor that they carry one of these? Only tick a box if it was confirmed by a genetic test. If you have never heard of these, that is normal — leave them all unticked.',
    bm: 'Adakah sesiapa dalam keluarga anda diberitahu oleh doktor bahawa mereka membawa salah satu daripada ini? Tandakan hanya jika disahkan melalui ujian genetik. Jika anda tidak pernah mendengarnya, itu perkara biasa — biarkan semua tidak ditanda.'
  },
  noneOfThese: { en: 'None of these / I do not know', bm: 'Tiada / Saya tidak tahu' },

  // --- step 4: results ---------------------------------------------------
  resultsTitle: { en: 'Your plan', bm: 'Pelan anda' },
  riskLevel: { en: 'Risk level', bm: 'Tahap risiko' },
  recommendedScreening: { en: 'Recommended screening', bm: 'Saringan disyorkan' },
  interval: { en: 'How often', bm: 'Berapa kerap' },
  warningSigns: { en: 'Warning signs to watch for', bm: 'Tanda amaran untuk diperhatikan' },
  whenToSeekHelp: { en: 'When to seek help', bm: 'Bila perlu dapatkan bantuan' },
  seekHelpText: {
    en: 'If you notice any of the warning signs above, book an appointment at your nearest clinic. Do not wait for your next scheduled screening.',
    bm: 'Jika anda perasan mana-mana tanda amaran di atas, tempah temu janji di klinik terdekat. Jangan tunggu saringan berjadual anda yang seterusnya.'
  },
  riskNames: {
    en: { average: 'Average risk', increased: 'Increased risk', high: 'High risk' },
    bm: { average: 'Risiko purata', increased: 'Risiko meningkat', high: 'Risiko tinggi' }
  },
  whyThis: { en: 'Why this result', bm: 'Mengapa keputusan ini' },
  startFrom: { en: 'Suggested starting age', bm: 'Umur mula dicadangkan' },
  dueNow: { en: 'You are already in this age range — worth asking your clinic now.', bm: 'Anda sudah berada dalam lingkungan umur ini — patut bertanya klinik sekarang.' },
  notYet: { en: 'Not due yet. Note the age and diarise it.', bm: 'Belum tiba masanya. Catat umur tersebut dan rancang awal.' },
  provisionalBanner: {
    en: 'No guideline document has been retrieved for this cancer yet. The information below is provisional and must be confirmed with your doctor.',
    bm: 'Tiada dokumen garis panduan diperoleh untuk kanser ini lagi. Maklumat di bawah adalah sementara dan mesti disahkan dengan doktor anda.'
  },
  anchoredTo: { en: 'Anchored to', bm: 'Berpandukan' },
  printSummary: { en: 'Print summary for your clinic', bm: 'Cetak ringkasan untuk klinik anda' },

  // --- symptom check -----------------------------------------------------
  symptomTitle: { en: 'Any symptoms right now?', bm: 'Ada gejala sekarang?' },
  symptomIntro: {
    en: 'Tick anything you have noticed recently. These questions are chosen for the cancers you were just assessed for.',
    bm: 'Tandakan apa-apa yang anda perasan baru-baru ini. Soalan ini dipilih untuk kanser yang baru dinilai.'
  },
  symptomNone: { en: 'Nothing ticked — good. Keep to your screening plan above.', bm: 'Tiada ditanda — baik. Teruskan pelan saringan di atas.' },
  symptomFlagged: {
    en: 'You have ticked one or more symptoms. Please see a doctor at your nearest clinic. This does not mean you have cancer — most of these symptoms have other causes — but they should be checked.',
    bm: 'Anda telah menandakan satu atau lebih gejala. Sila jumpa doktor di klinik terdekat. Ini tidak bermakna anda menghidap kanser — kebanyakan gejala ini mempunyai punca lain — tetapi ia perlu diperiksa.'
  },
  emergencyTitle: { en: 'Call 999 now if you have any of these', bm: 'Hubungi 999 sekarang jika anda mengalami mana-mana ini' },
  emergencyAction: { en: 'Call 999', bm: 'Hubungi 999' },

  // --- feedback ----------------------------------------------------------
  feedbackTitle: { en: 'Your feedback', bm: 'Maklum balas anda' },
  feedbackIntro: {
    en: 'This helps us find out whether the tool is usable and useful. It is anonymous — we collect no name, IC number or contact detail.',
    bm: 'Ini membantu kami mengetahui sama ada alat ini boleh digunakan dan berguna. Ia tanpa nama — kami tidak mengumpul nama, nombor kad pengenalan atau butiran perhubungan.'
  },
  yourRole: { en: 'You are a…', bm: 'Anda seorang…' },
  roles: {
    en: ['Member of the public', 'Patient', 'Family member / carer', 'Nurse', 'Doctor', 'Other healthcare worker', 'Student'],
    bm: ['Orang awam', 'Pesakit', 'Ahli keluarga / penjaga', 'Jururawat', 'Doktor', 'Petugas kesihatan lain', 'Pelajar']
  },
  likert: {
    en: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
    bm: ['Sangat tidak setuju', 'Tidak setuju', 'Neutral', 'Setuju', 'Sangat setuju']
  },
  likertItems: {
    en: [
      'The app was easy to use.',
      'The information was clear.',
      'I understood what I was asked to do.',
      'This would be useful for me or my family.',
      'I intend to act on what it recommended.'
    ],
    bm: [
      'Aplikasi ini mudah digunakan.',
      'Maklumat yang diberikan jelas.',
      'Saya faham apa yang diminta.',
      'Ini berguna untuk saya atau keluarga saya.',
      'Saya berniat untuk bertindak atas apa yang disyorkan.'
    ]
  },
  comment: { en: 'Anything else? (optional)', bm: 'Ada apa-apa lagi? (pilihan)' },
  consent: {
    en: 'I agree that my anonymous answers may be used to evaluate this prototype.',
    bm: 'Saya bersetuju jawapan tanpa nama saya boleh digunakan untuk menilai prototaip ini.'
  },
  submit: { en: 'Send feedback', bm: 'Hantar maklum balas' },
  sending: { en: 'Sending…', bm: 'Menghantar…' },
  thanks: { en: 'Thank you — your feedback has been sent.', bm: 'Terima kasih — maklum balas anda telah dihantar.' },
  sendFailed: { en: 'Could not send. Please try again later.', bm: 'Tidak dapat dihantar. Sila cuba lagi kemudian.' },

  // --- notebook / chat / quiz -------------------------------------------
  notebookTitle: { en: 'Ask about the guidelines', bm: 'Tanya tentang garis panduan' },
  notebookIntro: {
    en: 'This notebook can only answer from the Malaysian clinical practice guidelines loaded into it. Because it has nothing else to draw on, it is far less likely to invent an answer than a general chatbot. It still does not know anything about you personally.',
    bm: 'Buku nota ini hanya boleh menjawab daripada garis panduan amalan klinikal Malaysia yang dimuatkan ke dalamnya. Kerana ia tiada sumber lain, ia jauh kurang berkemungkinan mereka-reka jawapan berbanding chatbot umum. Ia tetap tidak tahu apa-apa tentang anda secara peribadi.'
  },
  openNotebook: { en: 'Open the notebook', bm: 'Buka buku nota' },
  embedBlocked: {
    en: 'Google does not allow this notebook to be displayed inside another website, so it opens in a new tab.',
    bm: 'Google tidak membenarkan buku nota ini dipaparkan di dalam laman web lain, jadi ia dibuka dalam tab baharu.'
  },
  loadingEmbed: { en: 'Loading the notebook…', bm: 'Memuatkan buku nota…' },
  quizTitle: { en: 'Quick quiz', bm: 'Kuiz ringkas' },
  quizIntro: {
    en: 'Nine short questions on family cancer risk and early detection. No medical knowledge needed.',
    bm: 'Sembilan soalan ringkas tentang risiko kanser keluarga dan pengesanan awal. Tiada pengetahuan perubatan diperlukan.'
  },
  quizScore: { en: 'You scored', bm: 'Skor anda' },
  quizOutOf: { en: 'out of', bm: 'daripada' },
  quizRestart: { en: 'Try again', bm: 'Cuba lagi' },
  quizNext: { en: 'Next question', bm: 'Soalan seterusnya' },
  quizFinish: { en: 'See my score', bm: 'Lihat skor saya' },
  quizCorrect: { en: 'Correct', bm: 'Betul' },
  quizIncorrect: { en: 'Not quite', bm: 'Kurang tepat' },
  quizNotebookLink: {
    en: 'There is also a quiz generated inside the NotebookLM notebook, drawn straight from the guidelines.',
    bm: 'Terdapat juga kuiz yang dijana di dalam buku nota NotebookLM, diambil terus daripada garis panduan.'
  },
  openNotebookQuiz: { en: 'Open the NotebookLM quiz', bm: 'Buka kuiz NotebookLM' },
  chatTitle: { en: 'Ask about Malaysian guidelines', bm: 'Tanya tentang garis panduan Malaysia' },
  chatPlaceholder: { en: 'Type your question…', bm: 'Taip soalan anda…' },
  chatSend: { en: 'Ask', bm: 'Tanya' },
  chatUnavailable: {
    en: 'The guidelines assistant is not configured on this deployment. Use the NotebookLM notebook above instead.',
    bm: 'Pembantu garis panduan tidak dikonfigurasikan pada penerbitan ini. Gunakan buku nota NotebookLM di atas.'
  },

  // --- data card ---------------------------------------------------------
  dataTitle: { en: 'Cancer in Malaysia', bm: 'Kanser di Malaysia' },
  lifetimeRisk: { en: 'Lifetime risk of cancer', bm: 'Risiko kanser seumur hidup' },
  topCancers: { en: 'Most common cancers', bm: 'Kanser paling biasa' },
  lateStage: { en: 'Diagnosed late (stage III or IV)', bm: 'Didiagnos lewat (peringkat III atau IV)' },
  lateStageNote: {
    en: 'This is what early detection is trying to change.',
    bm: 'Inilah yang cuba diubah oleh pengesanan awal.'
  },
  estimateLabel: { en: 'International estimate', bm: 'Anggaran antarabangsa' },
  unverifiedBanner: {
    en: 'These figures have not yet been checked against the published registry report and are shown for demonstration only.',
    bm: 'Angka ini belum disemak dengan laporan pendaftaran yang diterbitkan dan dipaparkan untuk demonstrasi sahaja.'
  },

  // --- misc --------------------------------------------------------------
  close: { en: 'Close', bm: 'Tutup' },
  home: { en: 'Home', bm: 'Utama' },
  generatedOn: { en: 'Generated on', bm: 'Dijana pada' },
  summaryHeading: { en: 'Summary for your clinic', bm: 'Ringkasan untuk klinik anda' },
  summaryAbout: { en: 'About this person', bm: 'Tentang individu ini' },
  // The printed sheet uses noun labels, not the form's questions.
  sumAge: { en: 'Age', bm: 'Umur' },
  sumSmoking: { en: 'Smoking', bm: 'Merokok' },
  summaryFamily: { en: 'Family history reported', bm: 'Sejarah keluarga dilaporkan' },
  summarySymptoms: { en: 'Symptoms reported', bm: 'Gejala dilaporkan' },
  summaryNoSymptoms: { en: 'None reported', bm: 'Tiada dilaporkan' },
  years: { en: 'years', bm: 'tahun' }
}

/** Look up a string in the active language, falling back to English. */
export function t (key, lang) {
  const entry = S[key]
  if (!entry) return key
  return entry[lang] ?? entry.en ?? key
}

/** Pick the right half of a { en, bm } pair. */
export function pick (pair, lang) {
  if (pair == null) return ''
  if (typeof pair === 'string') return pair
  return pair[lang] ?? pair.en ?? ''
}

export default S
