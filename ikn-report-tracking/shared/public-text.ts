/**
 * Applicant-facing wording, Bahasa Melayu first.
 *
 * Kept in `shared/` so the API and the portal cannot drift apart: the server
 * resolves a stage to text with the same table the browser uses.
 *
 * The rule these strings follow: an estimate is never phrased as a promise. The
 * original target date is always shown; a revised estimate, when one exists, is a
 * separate, separately-labelled line.
 */
import type { PublicStage } from './domain.ts';

export type Language = 'ms' | 'en';

export const STAGE_LABEL: Record<Language, Record<PublicStage, string>> = {
  ms: {
    PERMOHONAN_DITERIMA: 'Permohonan diterima',
    TINDAKAN_PEMOHON_DIPERLUKAN: 'Tindakan pemohon diperlukan',
    SEDANG_DIPROSES: 'Sedang diproses',
    DALAM_SEMAKAN_AKHIR: 'Dalam semakan akhir',
    SEDIA_UNTUK_DIAMBIL: 'Sedia untuk diambil / dihantar',
    SELESAI: 'Selesai',
    DIBATALKAN: 'Dibatalkan / tidak diteruskan',
  },
  en: {
    PERMOHONAN_DITERIMA: 'Application received',
    TINDAKAN_PEMOHON_DIPERLUKAN: 'Applicant action required',
    SEDANG_DIPROSES: 'Being processed',
    DALAM_SEMAKAN_AKHIR: 'In final review',
    SEDIA_UNTUK_DIAMBIL: 'Ready for collection / dispatch',
    SELESAI: 'Completed',
    DIBATALKAN: 'Cancelled / not proceeding',
  },
};

export const STAGE_EXPLANATION: Record<Language, Record<PublicStage, string>> = {
  ms: {
    PERMOHONAN_DITERIMA: 'Permohonan anda telah didaftarkan dan sedang disemak kelengkapannya.',
    TINDAKAN_PEMOHON_DIPERLUKAN: 'Terdapat dokumen, kebenaran atau bayaran yang masih diperlukan.',
    SEDANG_DIPROSES: 'Permohonan anda lengkap dan laporan sedang disediakan.',
    DALAM_SEMAKAN_AKHIR: 'Laporan yang telah ditandatangani sedang melalui semakan akhir Unit Rekod.',
    SEDIA_UNTUK_DIAMBIL: 'Laporan anda sedia untuk diambil atau dihantar.',
    SELESAI: 'Laporan telah diambil atau penghantaran telah disahkan.',
    DIBATALKAN: 'Permohonan ini tidak diteruskan.',
  },
  en: {
    PERMOHONAN_DITERIMA: 'Your application has been registered and is being checked for completeness.',
    TINDAKAN_PEMOHON_DIPERLUKAN: 'A document, consent or payment is still outstanding.',
    SEDANG_DIPROSES: 'Your application is complete and the report is being prepared.',
    DALAM_SEMAKAN_AKHIR: 'The signed report is undergoing the Records Unit’s final checks.',
    SEDIA_UNTUK_DIAMBIL: 'Your report is ready for collection or dispatch.',
    SELESAI: 'The report has been collected, or delivery has been confirmed.',
    DIBATALKAN: 'This application is not proceeding.',
  },
};

export const NEXT_ACTION_NONE: Record<Language, string> = {
  ms: 'Tiada tindakan diperlukan buat masa ini.',
  en: 'No action is needed from you at this time.',
};

export const NEXT_ACTION: Record<Language, Record<string, string>> = {
  ms: {
    SUBMIT_OUTSTANDING_DOCUMENTS:
      'Sila lengkapkan dokumen yang diperlukan. Butiran akan dipaparkan selepas pengesahan identiti.',
    SETTLE_FEE: 'Sila jelaskan bayaran di kaunter Unit Rekod Perubatan.',
    COLLECT_REPORT: 'Sila datang ke kaunter Unit Rekod Perubatan untuk mengambil laporan.',
    CONTACT_RECORDS: 'Sila hubungi Unit Rekod Perubatan untuk maklumat lanjut.',
  },
  en: {
    SUBMIT_OUTSTANDING_DOCUMENTS:
      'Please complete the outstanding documents. Details are shown after identity verification.',
    SETTLE_FEE: 'Please settle the payment at the Medical Records Unit counter.',
    COLLECT_REPORT: 'Please come to the Medical Records Unit counter to collect the report.',
    CONTACT_RECORDS: 'Please contact the Medical Records Unit for further information.',
  },
};

export const COLLECTION_INSTRUCTIONS: Record<Language, Record<string, string>> = {
  ms: {
    READY_COUNTER:
      'Bawa kad pengenalan asal. Jika diambil oleh wakil, bawa surat kebenaran dan kad '
      + 'pengenalan wakil. Kaunter dibuka pada hari bekerja.',
    NOT_READY:
      'Arahan pengambilan akan dimaklumkan apabila laporan sedia. Anda tidak perlu datang '
      + 'ke kaunter sebelum itu.',
    COMPLETED: 'Laporan ini telah diserahkan. Tiada tindakan lanjut diperlukan.',
    CANCELLED: 'Tiada laporan untuk diambil bagi permohonan ini.',
  },
  en: {
    READY_COUNTER:
      'Bring your original identity card. If a representative is collecting, bring the letter '
      + 'of authority and the representative’s identity card. The counter is open on working days.',
    NOT_READY:
      'Collection instructions will be sent when the report is ready. There is no need to visit '
      + 'the counter before then.',
    COMPLETED: 'This report has been handed over. No further action is needed.',
    CANCELLED: 'There is no report to collect for this application.',
  },
};

export const DELAY_MESSAGE: Record<Language, string> = {
  ms: 'Kami memohon maaf kerana permohonan ini mengambil masa lebih lama daripada '
    + 'sasaran asal. Permohonan anda masih dalam proses dan kemas kini terkini dipaparkan di atas.',
  en: 'We are sorry that this application is taking longer than the original target. '
    + 'Your application is still in progress and the latest update is shown above.',
};

export const ESTIMATE_DISCLAIMER: Record<Language, string> = {
  ms: 'Tarikh anggaran ini bukan jaminan tarikh siap.',
  en: 'This estimated date is not a guaranteed completion date.',
};

export const TARGET_NOT_SET: Record<Language, string> = {
  ms: 'Tarikh sasaran akan ditetapkan setelah permohonan anda lengkap.',
  en: 'A target date is set once your application is complete.',
};

/**
 * The verified Records Unit contact shown to applicants.
 *
 * These are placeholders. No IKN telephone number, e-mail address or counter hours
 * were supplied for this prototype, and publishing a guessed number to applicants
 * would send them to the wrong place. Administration → configuration holds the
 * real values, and the portal marks them unverified until they are set.
 */
export const RECORDS_CONTACT_PLACEHOLDER = {
  unitName: { ms: 'Unit Rekod Perubatan, Institut Kanser Negara', en: 'Medical Records Unit, Institut Kanser Negara' },
  telephone: null as string | null,
  email: null as string | null,
  counterHours: null as string | null,
  unverifiedNotice: {
    ms: 'Maklumat hubungan belum disahkan dalam prototaip ini.',
    en: 'Contact details are not yet verified in this prototype.',
  },
};
