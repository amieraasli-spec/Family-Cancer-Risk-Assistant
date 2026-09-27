/**
 * Single editable branding constant.
 * Phase 5 of the prompt library: "Put all branding behind a single editable
 * constant so it's easy to change." Change values here only — nothing else
 * in the app hard-codes an institution name, author or contact.
 */
export const BRANDING = {
  appName: 'Family Cancer Risk Assistant',
  appNameBm: 'Pembantu Risiko Kanser Keluarga',
  shortName: 'FCRA',
  author: 'Dr Nurul Amiera Asli',
  institution: 'Institut Kanser Negara (IKN)',
  ministry: 'Kementerian Kesihatan Malaysia',
  liveUrl: 'https://family-cancer-risk-assistant.vercel.app',
  version: '1.0.0',
  // Used in the printable GP summary footer.
  summaryFooter:
    'Research and education prototype. Not a certified medical device. Not a diagnostic tool.',
  emergencyNumber: '999'
}

export default BRANDING
