/**
 * Vocabulary shared by the server and both frontends.
 *
 * Nothing in this file is a policy decision. Numeric allowances, targets and
 * rates live in versioned database rows (see `docs/05-assumptions-register.md`),
 * because every one of them is an unverified prototype assumption.
 */

export const ROLES = [
  'records_officer', 'doctor', 'hod', 'finance_officer', 'director', 'system_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const INTERNAL_STATUSES = [
  'RECEIVED', 'AWAITING_DOCUMENTS', 'COMPLETE_UNASSIGNED', 'ASSIGNED', 'ACKNOWLEDGED',
  'IN_PREPARATION', 'SIGNED_SUBMITTED', 'RECORDS_VERIFICATION', 'READY_FOR_RELEASE',
  'COLLECTED_OR_DELIVERED', 'CANCELLED',
] as const;
export type InternalStatus = (typeof INTERNAL_STATUSES)[number];

export const PUBLIC_STAGES = [
  'PERMOHONAN_DITERIMA', 'TINDAKAN_PEMOHON_DIPERLUKAN', 'SEDANG_DIPROSES',
  'DALAM_SEMAKAN_AKHIR', 'SEDIA_UNTUK_DIAMBIL', 'SELESAI', 'DIBATALKAN',
] as const;
export type PublicStage = (typeof PUBLIC_STAGES)[number];

/** Internal event meaning → the stage an applicant is allowed to see. */
export const PUBLIC_STAGE_OF: Record<InternalStatus, PublicStage> = {
  RECEIVED: 'PERMOHONAN_DITERIMA',
  AWAITING_DOCUMENTS: 'TINDAKAN_PEMOHON_DIPERLUKAN',
  COMPLETE_UNASSIGNED: 'SEDANG_DIPROSES',
  ASSIGNED: 'SEDANG_DIPROSES',
  ACKNOWLEDGED: 'SEDANG_DIPROSES',
  IN_PREPARATION: 'SEDANG_DIPROSES',
  SIGNED_SUBMITTED: 'SEDANG_DIPROSES',
  RECORDS_VERIFICATION: 'DALAM_SEMAKAN_AKHIR',
  READY_FOR_RELEASE: 'SEDIA_UNTUK_DIAMBIL',
  COLLECTED_OR_DELIVERED: 'SELESAI',
  CANCELLED: 'DIBATALKAN',
};

/** The stages that count as "open" for backlog and overdue measurement. */
export const OPEN_STATUSES: readonly InternalStatus[] = [
  'RECEIVED', 'AWAITING_DOCUMENTS', 'COMPLETE_UNASSIGNED', 'ASSIGNED', 'ACKNOWLEDGED',
  'IN_PREPARATION', 'SIGNED_SUBMITTED', 'RECORDS_VERIFICATION',
];

/**
 * Queue-composition buckets for the donut. Mutually exclusive by construction:
 * every open internal status appears in exactly one bucket.
 */
export const QUEUE_BUCKETS = [
  { key: 'AWAITING_APPLICANT', statuses: ['AWAITING_DOCUMENTS'] },
  { key: 'AWAITING_ASSIGNMENT', statuses: ['RECEIVED', 'COMPLETE_UNASSIGNED'] },
  { key: 'WITH_DOCTOR', statuses: ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PREPARATION'] },
  { key: 'AWAITING_RECORDS_CHECK', statuses: ['SIGNED_SUBMITTED', 'RECORDS_VERIFICATION'] },
] as const satisfies readonly { key: string; statuses: readonly InternalStatus[] }[];

export const FEE_STATUSES = [
  'NOT_REQUIRED', 'AWAITING_PAYMENT', 'PAID', 'EXEMPT', 'REFUNDED', 'RECONCILIATION_EXCEPTION',
] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const ELIGIBILITY_STATUSES = ['UNASSESSED', 'ELIGIBLE', 'NOT_ELIGIBLE'] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const CLAIM_STATUSES = [
  'NOT_SUBMITTED', 'SUBMITTED', 'UNDER_VERIFICATION', 'RETURNED', 'VERIFIED', 'APPROVED',
  'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAID', 'PAYMENT_FAILED', 'REVERSED',
  'REJECTED', 'WITHDRAWN',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Claim statuses that hold a live slot for an eligible service. Anything outside
 * this set has released the slot, so a corrected claim can be raised again.
 */
export const CLAIM_SLOT_HELD_BY: readonly ClaimStatus[] = CLAIM_STATUSES
  .filter((s) => s !== 'REJECTED' && s !== 'WITHDRAWN' && s !== 'REVERSED');

/** Claim statuses where the money is approved but settlement is not yet proven. */
export const CLAIM_AWAITING_SETTLEMENT: readonly ClaimStatus[] = [
  'APPROVED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAYMENT_FAILED',
];

export const DELAY_STAGES = [
  'REGISTRATION', 'COMPLETENESS', 'ASSIGNMENT', 'DOCTOR_PREPARATION',
  'RECORDS_VERIFICATION', 'RELEASE', 'COLLECTION', 'FINANCE',
] as const;
export type DelayStage = (typeof DELAY_STAGES)[number];

export const REPORT_TYPES = [
  'Ordinary report', 'Specialist summary', 'Detailed specialist report',
] as const;

export const VERIFICATION_STATES = ['UNVERIFIED', 'PENDING_IKN', 'CONFIRMED'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export type DataClass = 'SYNTHETIC' | 'LIVE';

/**
 * Turnaround histogram bins, in working days. The upper edge of the fourth bin is
 * the configured service allowance, so the ">28" bin means "missed the allowance"
 * under the default rule version.
 */
export const TURNAROUND_BINS = [
  { key: '0_7', label: '0–7', min: 0, max: 7 },
  { key: '8_14', label: '8–14', min: 8, max: 14 },
  { key: '15_21', label: '15–21', min: 15, max: 21 },
  { key: '22_28', label: '22–28', min: 22, max: 28 },
  { key: 'over_28', label: 'Over 28', min: 29, max: Number.POSITIVE_INFINITY },
] as const;

/** A metric whose denominator is zero is never rendered as a percentage. */
export const NOT_APPLICABLE = 'Not applicable — no eligible cases' as const;

/** Both captions every analytical output must carry, including in exports. */
export interface Captions {
  howToRead: string;
  whatThisShows: string;
  dataClassNotice?: string;
}
