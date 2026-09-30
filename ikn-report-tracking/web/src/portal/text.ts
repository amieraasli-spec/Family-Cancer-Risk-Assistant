/**
 * Portal wording, Bahasa Melayu first.
 *
 * Stage labels and applicant-facing explanations come from the API, which reads
 * them out of `shared/public-text.ts`, so the portal and the API cannot disagree.
 * This file holds only the chrome: headings, field labels and button text.
 */
export type Language = 'ms' | 'en';

/** The copy one language supplies. Both language blocks are checked against it. */
export interface UiText {
  serviceTitle: string; org: string; demoBanner: string;
  step: (n: number, of: number) => string;
  enterHeading: string; enterIntro: string; referenceLabel: string; referenceHint: string;
  check: string; checking: string; noReference: string; useReportNumber: string;
  useReference: string; reportNumberHeading: string; reportNumberIntro: string;
  reportNumberLabel: string; sendCode: string; sending: string; codeHeading: string;
  codeLabel: string; codeSentTo: string; verify: string; verifying: string; back: string;
  statusHeading: string; reference: string; received: string; target: string;
  targetNotSet: string; revised: string; lastUpdate: string; nextAction: string;
  outstanding: string; collection: string; contact: string; checkAnother: string;
  showDetail: string; feeOutstanding: string; privacy: string; simulationNotice: string;
}

export const UI: Record<Language, UiText> = {
  ms: {
    serviceTitle: 'Semakan Status Laporan Perubatan',
    org: 'Institut Kanser Negara',
    demoBanner: 'Data demonstrasi — bukan prestasi sebenar IKN.',
    step: (n: number, of: number) => `Langkah ${n} daripada ${of}`,
    enterHeading: 'Masukkan kod semakan anda',
    enterIntro: 'Kod semakan tercatat pada resit permohonan anda. Anda tidak perlu '
      + 'membuka akaun.',
    referenceLabel: 'Kod semakan',
    referenceHint: 'Contoh format: XXXX-XXXX-XXXX-XXXX-XXXX. Huruf besar atau kecil '
      + 'diterima.',
    check: 'Semak status',
    checking: 'Menyemak…',
    noReference: 'Tiada kod semakan? Anda boleh menggunakan nombor laporan dan '
      + 'pengesahan melalui kod sekali guna.',
    useReportNumber: 'Guna nombor laporan',
    useReference: 'Guna kod semakan',
    reportNumberHeading: 'Pengesahan diperlukan',
    reportNumberIntro: 'Nombor laporan sahaja tidak mencukupi untuk memaparkan status. '
      + 'Kami akan menghantar kod sekali guna kepada maklumat hubungan yang telah '
      + 'disahkan sebelum ini.',
    reportNumberLabel: 'Nombor laporan',
    sendCode: 'Hantar kod sekali guna',
    sending: 'Menghantar…',
    codeHeading: 'Masukkan kod sekali guna',
    codeLabel: 'Kod 6 angka',
    codeSentTo: 'Kod dihantar kepada',
    verify: 'Sahkan',
    verifying: 'Mengesahkan…',
    back: 'Kembali',
    statusHeading: 'Status permohonan anda',
    reference: 'Kod semakan',
    received: 'Tarikh diterima',
    target: 'Tarikh sasaran',
    targetNotSet: 'Belum ditetapkan',
    revised: 'Anggaran terkini',
    lastUpdate: 'Kemas kini terakhir',
    nextAction: 'Tindakan anda',
    outstanding: 'Perkara yang masih diperlukan',
    collection: 'Arahan pengambilan',
    contact: 'Hubungan Unit Rekod',
    checkAnother: 'Semak permohonan lain',
    showDetail: 'Lihat butiran dokumen (perlu pengesahan)',
    feeOutstanding: 'Terdapat bayaran yang belum dijelaskan.',
    privacy: 'Kod semakan adalah peribadi. Jangan berkongsi kod ini. Halaman ini tidak '
      + 'memaparkan diagnosis, teks klinikal atau maklumat doktor.',
    simulationNotice: 'Dalam prototaip ini, kod sekali guna tidak dihantar kepada '
      + 'sesiapa. Ia hanya direkodkan dalam log sistem.',
  },
  en: {
    serviceTitle: 'Medical Report Status Check',
    org: 'Institut Kanser Negara',
    demoBanner: 'Demonstration data — not actual IKN performance.',
    step: (n: number, of: number) => `Step ${n} of ${of}`,
    enterHeading: 'Enter your tracking code',
    enterIntro: 'Your tracking code is printed on your application receipt. You do not '
      + 'need an account.',
    referenceLabel: 'Tracking code',
    referenceHint: 'Example format: XXXX-XXXX-XXXX-XXXX-XXXX. Upper or lower case is fine.',
    check: 'Check status',
    checking: 'Checking…',
    noReference: 'No tracking code? You can use your report number and verify with a '
      + 'one-time code.',
    useReportNumber: 'Use report number',
    useReference: 'Use tracking code',
    reportNumberHeading: 'Verification required',
    reportNumberIntro: 'A report number on its own is not enough to show a status. We '
      + 'will send a one-time code to a contact that was verified previously.',
    reportNumberLabel: 'Report number',
    sendCode: 'Send one-time code',
    sending: 'Sending…',
    codeHeading: 'Enter the one-time code',
    codeLabel: '6-digit code',
    codeSentTo: 'Code sent to',
    verify: 'Verify',
    verifying: 'Verifying…',
    back: 'Back',
    statusHeading: 'Your application status',
    reference: 'Tracking code',
    received: 'Date received',
    target: 'Target date',
    targetNotSet: 'Not yet set',
    revised: 'Latest estimate',
    lastUpdate: 'Last update',
    nextAction: 'What you should do',
    outstanding: 'Still needed',
    collection: 'Collection instructions',
    contact: 'Records Unit contact',
    checkAnother: 'Check another application',
    showDetail: 'Show document details (verification required)',
    feeOutstanding: 'There is an outstanding payment.',
    privacy: 'Your tracking code is private. Do not share it. This page never shows a '
      + 'diagnosis, clinical text or doctor information.',
    simulationNotice: 'In this prototype, one-time codes are not sent to anyone. They are '
      + 'only written to the system log.',
  },
};

/** Icon paired with each stage, so state is never carried by colour alone. */
export const STAGE_ICON: Record<string, string> = {
  PERMOHONAN_DITERIMA: '📥',
  TINDAKAN_PEMOHON_DIPERLUKAN: '❗',
  SEDANG_DIPROSES: '⏳',
  DALAM_SEMAKAN_AKHIR: '🔍',
  SEDIA_UNTUK_DIAMBIL: '✅',
  SELESAI: '📄',
  DIBATALKAN: '⛔',
};

export function stageTone(stage: string): 'ready' | 'action' | 'closed' | 'plain' {
  if (stage === 'SEDIA_UNTUK_DIAMBIL') return 'ready';
  if (stage === 'TINDAKAN_PEMOHON_DIPERLUKAN') return 'action';
  if (stage === 'SELESAI' || stage === 'DIBATALKAN') return 'closed';
  return 'plain';
}
