/**
 * The applicant-facing status service.
 *
 * Everything a member of the public can see comes out of `buildPublicStatus`, and
 * the response is assembled field by field from an allowlist. A future query that
 * happens to select a clinical column, a doctor name or a claim amount still
 * cannot put it in the response, because nothing here copies unknown fields.
 *
 * What is deliberately absent: diagnosis, any clinical text, the full patient
 * identifier, the doctor's identity or performance, internal comments, claims and
 * payments. The patient fee appears only as a settled/outstanding indicator — never
 * a doctor's remuneration, which patients have no business seeing.
 */
import type { Handle } from '../db/database.ts';
import { loadCalendar } from '../domain/calendar.ts';
import { deadlinePosition } from '../domain/deadlines.ts';
import { slaRule } from '../domain/rules.ts';
import { toBusinessDate, type BusinessDate, type Instant } from '../domain/time.ts';
import { PUBLIC_STAGE_OF, type InternalStatus, type PublicStage } from '../../shared/domain.ts';
import { COLLECTION_INSTRUCTIONS, DELAY_MESSAGE, ESTIMATE_DISCLAIMER, NEXT_ACTION,
  NEXT_ACTION_NONE, RECORDS_CONTACT_PLACEHOLDER, STAGE_EXPLANATION, STAGE_LABEL,
  TARGET_NOT_SET, type Language } from '../../shared/public-text.ts';
import { dataClassNotice, settings } from '../config/settings.ts';

/** The complete, closed set of fields a public caller may receive. */
export interface PublicStatusView {
  /** Echo of the reference the caller presented, formatted for reading aloud. */
  publicReference: string;
  stage: PublicStage;
  stageLabel: string;
  stageExplanation: string;
  receivedDate: BusinessDate;
  /** Original target date, or null while the application is still incomplete. */
  targetCompletionDate: BusinessDate | null;
  targetNotSetNotice: string | null;
  /** A revised estimate, shown separately and never replacing the original. */
  revisedEstimateDate: BusinessDate | null;
  estimateDisclaimer: string | null;
  lastUpdateDate: BusinessDate;
  nextActionCode: string | null;
  nextActionText: string;
  /** Present only when a verified session has been established. */
  outstandingItems: string[] | null;
  collectionInstructions: string;
  delayNotice: string | null;
  feeOutstanding: boolean;
  contact: {
    unitName: string;
    telephone: string | null;
    email: string | null;
    counterHours: string | null;
    unverifiedNotice: string | null;
  };
  dataClassNotice: string | null;
  /** True when this view required, and passed, step-up verification. */
  verified: boolean;
}

export interface ApplicationForPublic extends Record<string, unknown> {
  application_id: string;
  internal_status: InternalStatus;
  public_status: PublicStage;
  received_at: Instant;
  application_complete_at: Instant | null;
  original_service_due_at: Instant | null;
  revised_due_at: Instant | null;
  last_public_update_at: Instant;
  next_action_owner: string;
  cancellation_public_message: string | null;
  sla_rule_version: string;
  fee_status: string;
  ready_at: Instant | null;
  collection_or_delivery_at: Instant | null;
}

/** Loads exactly the columns the public view needs, and no others. */
export function loadForPublic(handle: Handle, applicationId: string): ApplicationForPublic | null {
  return handle.get<ApplicationForPublic>(
    `SELECT a.application_id, a.internal_status, a.public_status, a.received_at,
            a.application_complete_at, a.original_service_due_at, a.revised_due_at,
            a.last_public_update_at, a.next_action_owner, a.cancellation_public_message,
            a.sla_rule_version, f.fee_status, r.ready_at, r.collection_or_delivery_at
     FROM applications a
     LEFT JOIN patient_fees f ON f.application_id = a.application_id
     LEFT JOIN releases r ON r.application_id = a.application_id
     WHERE a.application_id = ?`, applicationId) ?? null;
}

export interface BuildOptions {
  language: Language;
  presentedReference: string;
  /** True when the caller cleared a one-time code for this application. */
  verified: boolean;
  /** Outstanding requirements, supplied only for a verified caller. */
  outstandingItems?: string[];
  asOf?: Instant;
}

export function buildPublicStatus(
  handle: Handle, application: ApplicationForPublic, opts: BuildOptions,
): PublicStatusView {
  const lang = opts.language;
  const asOf = opts.asOf ?? new Date().toISOString();
  const stage = PUBLIC_STAGE_OF[application.internal_status];
  const receivedDate = toBusinessDate(application.received_at);
  const targetDate = application.original_service_due_at
    ? toBusinessDate(application.original_service_due_at) : null;
  const revisedDate = application.revised_due_at
    ? toBusinessDate(application.revised_due_at) : null;

  // A delayed case keeps its true stage. The delay notice is additive.
  const sla = slaRule(handle, application.sla_rule_version);
  const closed = application.collection_or_delivery_at ?? application.ready_at;
  const position = deadlinePosition(
    handle, sla.calendarVersion, targetDate, toBusinessDate(asOf), closed);
  const delayed = position.state === 'OVERDUE';

  const feeOutstanding = application.fee_status === 'AWAITING_PAYMENT';
  const nextActionCode = resolveNextAction(application, feeOutstanding);

  return {
    publicReference: formatForReading(opts.presentedReference),
    stage,
    stageLabel: STAGE_LABEL[lang][stage],
    stageExplanation: application.cancellation_public_message && stage === 'DIBATALKAN'
      ? application.cancellation_public_message
      : STAGE_EXPLANATION[lang][stage],
    receivedDate,
    targetCompletionDate: targetDate,
    targetNotSetNotice: targetDate ? null : TARGET_NOT_SET[lang],
    revisedEstimateDate: revisedDate,
    estimateDisclaimer: revisedDate ? ESTIMATE_DISCLAIMER[lang] : null,
    lastUpdateDate: toBusinessDate(application.last_public_update_at),
    nextActionCode,
    nextActionText: nextActionCode
      ? (NEXT_ACTION[lang][nextActionCode] ?? NEXT_ACTION[lang].CONTACT_RECORDS!)
      : NEXT_ACTION_NONE[lang],
    // Personalised missing-document detail requires verification, so an
    // unverified caller gets null rather than a partial list.
    outstandingItems: opts.verified ? (opts.outstandingItems ?? []) : null,
    collectionInstructions: COLLECTION_INSTRUCTIONS[lang][collectionKey(stage)]!,
    delayNotice: delayed ? DELAY_MESSAGE[lang] : null,
    feeOutstanding,
    contact: {
      unitName: RECORDS_CONTACT_PLACEHOLDER.unitName[lang],
      telephone: RECORDS_CONTACT_PLACEHOLDER.telephone,
      email: RECORDS_CONTACT_PLACEHOLDER.email,
      counterHours: RECORDS_CONTACT_PLACEHOLDER.counterHours,
      unverifiedNotice: RECORDS_CONTACT_PLACEHOLDER.telephone
        ? null : RECORDS_CONTACT_PLACEHOLDER.unverifiedNotice[lang],
    },
    dataClassNotice: dataClassNotice(settings().dataClass) ?? null,
    verified: opts.verified,
  };
}

function resolveNextAction(app: ApplicationForPublic, feeOutstanding: boolean): string | null {
  if (app.internal_status === 'AWAITING_DOCUMENTS') return 'SUBMIT_OUTSTANDING_DOCUMENTS';
  if (app.internal_status === 'READY_FOR_RELEASE') {
    return feeOutstanding ? 'SETTLE_FEE' : 'COLLECT_REPORT';
  }
  if (feeOutstanding) return 'SETTLE_FEE';
  if (app.next_action_owner === 'APPLICANT') return 'CONTACT_RECORDS';
  return null;
}

function collectionKey(stage: PublicStage): string {
  if (stage === 'SEDIA_UNTUK_DIAMBIL') return 'READY_COUNTER';
  if (stage === 'SELESAI') return 'COMPLETED';
  if (stage === 'DIBATALKAN') return 'CANCELLED';
  return 'NOT_READY';
}

/** Groups a reference in fours so it can be read back over the telephone. */
function formatForReading(reference: string): string {
  const clean = reference.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (clean.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The outstanding requirements for a verified caller.
 *
 * Built from workflow metadata only. It names *categories* of document, never a
 * clinical detail, and it is only ever called after a one-time code has been
 * cleared for this application.
 */
export function outstandingItemsFor(
  handle: Handle, applicationId: string, language: Language,
): string[] {
  const row = handle.get<{ internal_status: string; fee_status: string; authority_verified_at: string | null;
    applicant_role: string }>(
    `SELECT a.internal_status, a.authority_verified_at, a.applicant_role, f.fee_status
     FROM applications a LEFT JOIN patient_fees f ON f.application_id = a.application_id
     WHERE a.application_id = ?`, applicationId);
  if (!row) return [];

  const items: string[] = [];
  const ms = language === 'ms';
  if (row.internal_status === 'AWAITING_DOCUMENTS') {
    items.push(ms
      ? 'Salinan dokumen permohonan yang lengkap dan bertandatangan.'
      : 'A complete, signed copy of the application form.');
  }
  if (row.applicant_role !== 'PATIENT' && !row.authority_verified_at) {
    items.push(ms
      ? 'Surat kebenaran daripada pesakit dan salinan kad pengenalan wakil.'
      : 'A letter of authority from the patient and a copy of the representative’s identity card.');
  }
  if (row.fee_status === 'AWAITING_PAYMENT') {
    items.push(ms
      ? 'Bayaran laporan di kaunter Unit Rekod Perubatan.'
      : 'Payment of the report fee at the Medical Records Unit counter.');
  }
  return items;
}
