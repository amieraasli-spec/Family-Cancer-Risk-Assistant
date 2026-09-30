/**
 * Loads the committed synthetic dataset into the relational schema.
 *
 * The source is the supplied dummy workbook, extracted to CSV by
 * `scripts/extract_workbook.py`. Its own Guide sheet states SYNTHETIC ONLY, seed
 * 27092026, snapshot 2026-09-27 (Asia/Kuala_Lumpur).
 *
 * Three things this seeder does **not** do, deliberately:
 *   - it does not import the workbook's derived columns (deadlines, flags,
 *     turnaround, balances). Those are recomputed here from the versioned
 *     calendar, which includes public holidays the workbook omits.
 *   - it does not invent doctor remuneration rates or eligibility criteria. The
 *     amounts come from the workbook and are recorded as fictional.
 *   - it does not fabricate a payment. Where the workbook records an approval
 *     without settlement evidence, the item stays at PAYMENT_PROCESSING and the
 *     dashboard reads "Awaiting payment confirmation".
 *
 * Four documented augmentations exist so that code paths the workbook's Guide
 * lists as out of scope can be demonstrated and tested. Each is deterministic and
 * is reported in the seed summary: payment failures, payment reversals, late
 * completeness recording, and missing completeness dates.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Handle } from '../database.ts';
import { parseCsv } from '../../../scripts/lib/csv.ts';
import { hashPassword } from '../../auth/passwords.ts';
import { hashSecret } from '../../auth/tokens.ts';
import { appendDelayEvent, appendStatusEvent } from '../../domain/events.ts';
import { formatInternalReportNumber, newId, newPublicTrackingReference,
  normaliseTrackingReference } from '../../domain/ids.ts';
import { computeDoctorDeadline, computeServiceDeadline } from '../../domain/deadlines.ts';
import { slaRule, feeRule } from '../../domain/rules.ts';
import { senFromDecimalString } from '../../domain/money.ts';
import { startOfBusinessDay, type BusinessDate, type Instant } from '../../domain/time.ts';
import { PUBLIC_STAGE_OF, type InternalStatus } from '../../../shared/domain.ts';
import { CALENDAR_VERSION, DEPARTMENTS, DEMO_PASSWORD, ELIGIBILITY_RULE_VERSION,
  FEE_RULE_VERSION, SLA_RULE_VERSION } from './reference.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = join(ROOT, 'data', 'synthetic');

/** The workbook's snapshot date. All seeded activity stops here. */
export const SNAPSHOT_DATE: BusinessDate = '2026-09-27';

/**
 * Times of day attached to each event kind.
 *
 * The workbook records dates only. Business-date arithmetic is unaffected by the
 * time of day, but a deterministic ordering within a day is needed so the event
 * trail reads correctly, so each event kind gets a fixed KL clock time.
 */
const EVENT_TIME = {
  received: '08:30', complete: '09:00', assigned: '10:00', acknowledged: '11:00',
  preparation: '11:30', signed: '14:00', verification: '14:30', completed: '15:00',
  ready: '15:30', notified: '16:00', collected: '10:00', cancelled: '12:00',
  fee: '09:15', claim: '16:30', finance: '09:45', approval: '11:15', payment: '15:45',
} as const;

function at(date: string, clock: string): Instant {
  // The KL offset is fixed at +08:00 (see server/domain/time.ts).
  return new Date(`${date}T${clock}:00+08:00`).toISOString();
}

function orNull(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

export interface SeedSummary {
  departments: number;
  doctors: number;
  doctorUsers: number;
  applications: number;
  tasks: number;
  fees: number;
  claimItems: number;
  claims: number;
  payments: number;
  statusEvents: number;
  delayEvents: number;
  notifications: number;
  contactEnquiries: number;
  /** Cases where the derived status disagreed with the workbook's own column. */
  statusMismatches: { applicationId: string; workbook: string; derived: string }[];
  augmentations: { paymentFailures: number; paymentReversals: number };
  /**
   * The plaintext tracking references issued during seeding, returned so the
   * demonstration is usable. Only the HMAC of each one reaches the database.
   * The caller writes these to a gitignored file; the equivalent file must never
   * be produced for real applicants.
   */
  trackingReferences: { applicationId: string; internalReportNumber: string; reference: string }[];
  dataQualityExceptions: { lateCompletenessRecording: number; missingCompletenessDate: number };
}

export function seedSynthetic(handle: Handle): SeedSummary {
  const deptByName = new Map(DEPARTMENTS.map((d) => [d.name, d.id]));
  const sla = slaRule(handle, SLA_RULE_VERSION);
  const fees = feeRule(handle, FEE_RULE_VERSION);

  const summary: SeedSummary = {
    departments: DEPARTMENTS.length, doctors: 0, doctorUsers: 0, applications: 0, tasks: 0,
    fees: 0, claimItems: 0, claims: 0, payments: 0, statusEvents: 0, delayEvents: 0,
    notifications: 0, contactEnquiries: 0, statusMismatches: [],
    augmentations: { paymentFailures: 0, paymentReversals: 0 },
    trackingReferences: [],
    dataQualityExceptions: { lateCompletenessRecording: 0, missingCompletenessDate: 0 },
  };

  // ------------------------------------------------------------------ doctors
  const doctorRows = parseCsv(readFileSync(join(DATA, 'doctors.csv'), 'utf8'));
  for (const r of doctorRows) {
    const deptId = deptByName.get(r.department ?? '');
    if (!deptId) throw new Error(`unknown department for doctor ${r.doctor_id}: ${r.department}`);
    handle.run(
      'INSERT INTO doctors (doctor_id, display_name, department_id, active, is_synthetic) VALUES (?,?,?,1,1)',
      r.doctor_id!, r.doctor_name!, deptId);
    summary.doctors += 1;

    // One login per doctor, so the doctor scope rules can actually be exercised.
    const { hash, salt } = hashPassword(DEMO_PASSWORD);
    handle.run(
      `INSERT INTO users (user_id, username, display_name, role, is_supervisor, doctor_id,
         password_hash, password_salt, mfa_required, policy_clearance, active, created_at)
       VALUES (?,?,?,'doctor',0,?,?,?,0,'STANDARD',1,?)`,
      `usr_${r.doctor_id!.toLowerCase()}`, r.doctor_id!.toLowerCase(), r.doctor_name!,
      r.doctor_id!, hash, salt, at(SNAPSHOT_DATE, '08:00'));
    handle.run('INSERT INTO user_departments (user_id, department_id) VALUES (?,?)',
      `usr_${r.doctor_id!.toLowerCase()}`, deptId);
    summary.doctorUsers += 1;
  }

  // ------------------------------------------------------------- applications
  const appRows = parseCsv(readFileSync(join(DATA, 'applications.csv'), 'utf8'));
  const taskByApplication = new Map<string, string>();
  let eventCount = 0;

  appRows.forEach((r, index) => {
    const applicationId = r.application_id!;
    const deptId = deptByName.get(r.department ?? '');
    if (!deptId) throw new Error(`unknown department for ${applicationId}: ${r.department}`);

    const receivedDate = r.received_at!;
    const receivedAt = at(receivedDate, EVENT_TIME.received);

    // Data-quality exceptions, introduced deterministically so the exception
    // reporting has something real to report. Both are documented in the summary.
    const dropCompletenessDate = orNull(r.application_complete_at) !== null
      && orNull(r.report_completed_at) !== null && index % 311 === 7;
    const lateRecording = !dropCompletenessDate && orNull(r.application_complete_at) !== null
      && index % 137 === 11;

    const completeDate = dropCompletenessDate ? null : orNull(r.application_complete_at);
    const completeAt = completeDate ? at(completeDate, EVENT_TIME.complete) : null;
    const recordedAt = completeDate
      ? (lateRecording
        ? at(addCalendarDays(completeDate, 4), EVENT_TIME.complete)
        : at(completeDate, EVENT_TIME.complete))
      : null;
    if (dropCompletenessDate) summary.dataQualityExceptions.missingCompletenessDate += 1;
    if (lateRecording) summary.dataQualityExceptions.lateCompletenessRecording += 1;

    const service = completeAt
      ? computeServiceDeadline(handle, sla, r.report_type!, completeAt)
      : null;

    const assignedDate = orNull(r.assigned_at);
    const acknowledgedDate = orNull(r.acknowledged_at);
    const signedDate = orNull(r.signed_submitted_at);
    const completedDate = orNull(r.report_completed_at);
    const readyDate = orNull(r.ready_at);
    const notifiedDate = orNull(r.notified_at);
    const collectedDate = orNull(r.collected_at);
    const cancelledDate = orNull(r.cancelled_at);

    const internalStatus = deriveStatus({
      cancelledDate, collectedDate, readyDate, completedDate, signedDate,
      acknowledgedDate, assignedDate, completeDate,
      workbookStatus: r.internal_status!, nextActionOwner: r.next_action_owner!,
    });
    if (mapWorkbookStatus(r.internal_status!) !== internalStatus) {
      summary.statusMismatches.push({
        applicationId, workbook: r.internal_status!, derived: internalStatus,
      });
    }

    const lastUpdate = collectedDate ?? cancelledDate ?? notifiedDate ?? readyDate
      ?? completedDate ?? signedDate ?? acknowledgedDate ?? assignedDate
      ?? completeDate ?? receivedDate;

    handle.run(
      `INSERT INTO applications (application_id, internal_report_number, applicant_role,
         protected_patient_reference, verified_contact_reference, authority_verified_at,
         authority_verified_by, report_type, request_purpose, department_id, received_at,
         application_complete_at, completeness_recorded_at, sla_rule_version, fee_rule_version,
         original_service_due_at, revised_due_at, internal_status, public_status,
         next_action_owner, priority_reason, responsible_officer_id, cancellation_reason,
         cancellation_public_message, cancelled_at, last_public_update_at, is_synthetic,
         source_system, imported_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'SYNTHETIC_SEED',?,?,?)`,
      applicationId,
      formatInternalReportNumber(Number(receivedDate.slice(0, 4)), index + 1),
      r.applicant_type!,
      // Pseudonymous handle only. No name, no NRIC, no contact detail is stored.
      `PSEUDO-${applicationId}`,
      // A reference to a contact record held in the existing approved system, not
      // the contact itself. The prototype has no real destination to reach.
      `CONTACT-REF-${applicationId}`,
      r.applicant_type === 'PATIENT' ? null : at(receivedDate, EVENT_TIME.received),
      r.applicant_type === 'PATIENT' ? null : 'usr_records_1',
      r.report_type!, r.request_purpose!, deptId, receivedAt,
      completeAt, recordedAt, SLA_RULE_VERSION, FEE_RULE_VERSION,
      service ? startOfBusinessDay(service.dueDate) : null, null,
      internalStatus, PUBLIC_STAGE_OF[internalStatus],
      normaliseNextActionOwner(r.next_action_owner!, internalStatus),
      null, 'usr_records_1',
      cancelledDate ? 'DEMO_CANCELLED_BY_APPLICANT_REQUEST' : null,
      cancelledDate
        ? 'Permohonan tidak diteruskan atas permintaan pemohon. Sila hubungi Unit Rekod '
          + 'Perubatan jika anda ingin memohon semula.'
        : null,
      cancelledDate ? at(cancelledDate, EVENT_TIME.cancelled) : null,
      at(lastUpdate, EVENT_TIME.notified), null,
      at(receivedDate, EVENT_TIME.received), at(lastUpdate, EVENT_TIME.notified),
    );
    summary.applications += 1;

    // ------------------------------------------------- public tracking token
    const reference = newPublicTrackingReference();
    summary.trackingReferences.push({
      applicationId,
      internalReportNumber: formatInternalReportNumber(Number(receivedDate.slice(0, 4)), index + 1),
      reference,
    });
    handle.run(
      `INSERT INTO public_tracking_tokens (token_hash, application_id, issued_at) VALUES (?,?,?)`,
      hashSecret(normaliseTrackingReference(reference), 'tracking'), applicationId, receivedAt);

    // ------------------------------------------------------------ event trail
    eventCount += writeApplicationEvents(handle, {
      applicationId, internalStatus, receivedDate, completeDate, recordedAt,
      assignedDate, acknowledgedDate, signedDate, completedDate, readyDate,
      notifiedDate, collectedDate, cancelledDate,
    });

    // -------------------------------------------------------------- fee record
    const amountDue = senFromDecimalString(r.fee_due_rm || '0');
    const amountReceived = senFromDecimalString(r.fee_received_rm || '0');
    const feeStatus = r.fee_status!;
    handle.run(
      `INSERT INTO patient_fees (application_id, amount_due_sen, amount_received_sen, currency,
         receipt_reference, fee_status, exemption_basis, verified_at, verified_by,
         refund_amount_sen, fee_rule_version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      applicationId, amountDue, amountReceived, fees.currency,
      feeStatus === 'PAID' ? orNull(r.fee_receipt_demo) : null,
      feeStatus,
      feeStatus === 'EXEMPT' ? 'DEMO_EXEMPTION_APPROVED_BY_RECORDS' : null,
      feeStatus === 'PAID' ? at(r.fee_received_at || receivedDate, EVENT_TIME.fee) : null,
      feeStatus === 'PAID' ? 'usr_records_1' : null,
      FEE_RULE_VERSION, receivedAt, receivedAt);
    summary.fees += 1;
    appendStatusEvent(handle, {
      entityType: 'PATIENT_FEE', entityId: applicationId, applicationId,
      eventType: 'SET_FEE', toStatus: feeStatus, occurredAt: at(receivedDate, EVENT_TIME.fee),
      recordedAt: at(receivedDate, EVENT_TIME.fee), actorUserId: 'usr_records_1',
      actorRole: 'records_officer',
    });
    eventCount += 1;

    // ------------------------------------------------------------ doctor task
    if (assignedDate && r.doctor_id) {
      const taskId = newId('task');
      taskByApplication.set(applicationId, taskId);
      const assignedAt = at(assignedDate, EVENT_TIME.assigned);
      const doctorDue = computeDoctorDeadline(handle, sla, assignedAt, service?.dueDate ?? null);
      handle.run(
        `INSERT INTO doctor_tasks (task_id, application_id, doctor_id, department_id, sequence_no,
           active, assigned_at, assigned_by, acknowledged_at, original_doctor_due_at,
           current_doctor_due_at, signed_submitted_at, accepted_completed_at, returned_at,
           return_count, reassignment_events, superseded_at, delay_reason_code, created_at, updated_at)
         VALUES (?,?,?,?,1,1,?,?,?,?,?,?,?,?,?,0,NULL,?,?,?)`,
        taskId, applicationId, r.doctor_id, deptId, assignedAt, 'usr_records_1',
        acknowledgedDate ? at(acknowledgedDate, EVENT_TIME.acknowledged) : null,
        startOfBusinessDay(doctorDue.dueDate), startOfBusinessDay(doctorDue.dueDate),
        signedDate ? at(signedDate, EVENT_TIME.signed) : null,
        completedDate ? at(completedDate, EVENT_TIME.completed) : null,
        r.delay_reason === 'REVISION_REQUIRED' && signedDate
          ? at(signedDate, EVENT_TIME.verification) : null,
        r.delay_reason === 'REVISION_REQUIRED' ? 1 : 0,
        orNull(r.delay_reason) === 'NONE' ? null : orNull(r.delay_reason),
        assignedAt, at(lastUpdate, EVENT_TIME.notified));
      summary.tasks += 1;
      eventCount += writeTaskEvents(handle, {
        taskId, applicationId, doctorId: r.doctor_id,
        assignedDate, acknowledgedDate, signedDate, completedDate,
      });
    }

    // ---------------------------------------------------------------- release
    if (completedDate || readyDate || collectedDate) {
      handle.run(
        `INSERT INTO releases (application_id, report_completed_at, ready_at, notified_at,
           collection_or_delivery_at, release_method, release_authorised_by,
           receipt_of_delivery_reference, collected_by_description, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        applicationId,
        completedDate ? at(completedDate, EVENT_TIME.completed) : null,
        readyDate ? at(readyDate, EVENT_TIME.ready) : null,
        notifiedDate ? at(notifiedDate, EVENT_TIME.notified) : null,
        collectedDate ? at(collectedDate, EVENT_TIME.collected) : null,
        collectedDate ? 'COUNTER_COLLECTION' : null,
        readyDate ? 'usr_records_1' : null,
        collectedDate ? `DEMO-COLLECT-${index + 1}` : null,
        collectedDate ? `Diambil oleh ${r.applicant_type === 'PATIENT' ? 'pesakit' : 'wakil yang disahkan'}` : null,
        receivedAt, at(lastUpdate, EVENT_TIME.notified));
    }

    // ------------------------------------------------------------ delay events
    const delay = orNull(r.delay_reason);
    if (delay && delay !== 'NONE') {
      const { stage, attributedTo } = DELAY_ATTRIBUTION[delay]
        ?? { stage: 'RECORDS_VERIFICATION', attributedTo: 'UNATTRIBUTED' as const };
      appendDelayEvent(handle, {
        applicationId, taskId: taskByApplication.get(applicationId) ?? null, stage, attributedTo,
        reasonCode: delay,
        note: 'Seeded from the synthetic dataset. Attribution follows the stage that owned the delay.',
        startedAt: at(assignedDate ?? completeDate ?? receivedDate, EVENT_TIME.preparation),
        endedAt: completedDate ? at(completedDate, EVENT_TIME.completed) : null,
        recordedBy: 'usr_records_1',
      });
      summary.delayEvents += 1;
    }

    // ------------------------------------------------------- notification log
    if (notifiedDate) {
      // Every seeded notification is simulated and addressed to a contact
      // reference, never to a real destination.
      const failed = index % 97 === 3;
      handle.run(
        `INSERT INTO notifications (notification_id, application_id, recipient_kind,
           recipient_reference, channel, template_key, body_preview, provider, simulated,
           status, failure_reason, attempt_count, dedupe_key, scheduled_for, sent_at,
           delivered_at, created_at)
         VALUES (?,?,'APPLICANT',?,'SMS','REPORT_READY',?,'SIMULATION',1,?,?,?,?,?,?,?,?)`,
        newId('ntf'), applicationId, `CONTACT-REF-${applicationId}`,
        'Laporan perubatan anda sedia untuk diambil. Sila bawa kad pengenalan.',
        failed ? 'FAILED' : 'DELIVERED',
        failed ? 'SIMULATED_DELIVERY_FAILURE' : null,
        failed ? 3 : 1,
        `READY:${applicationId}`,
        at(notifiedDate, EVENT_TIME.notified), at(notifiedDate, EVENT_TIME.notified),
        failed ? null : at(notifiedDate, EVENT_TIME.notified),
        at(notifiedDate, EVENT_TIME.notified));
      summary.notifications += 1;
    }
  });

  summary.statusEvents = eventCount;

  // ------------------------------------------------------------- claim items
  const claimRows = parseCsv(readFileSync(join(DATA, 'claim_items.csv'), 'utf8'));
  const seenClaims = new Set<string>();

  claimRows.forEach((r, index) => {
    const applicationId = r.application_id!;
    const taskId = taskByApplication.get(applicationId);
    if (!taskId) return; // No doctor task: nothing to claim against.
    const deptId = deptByName.get(r.department ?? '');
    if (!deptId) throw new Error(`unknown department for claim ${r.claim_item_id}`);

    let status = r.claim_status!;
    const claimId = orNull(r.claim_id);
    const claimedSen = senFromDecimalString(r.claimed_amount_rm || '0');
    const approvedSen = orNull(r.approved_amount_rm) ? senFromDecimalString(r.approved_amount_rm!) : null;
    const netPaidSen = senFromDecimalString(r.net_paid_rm || '0');

    // Augmentations #1 and #2: the workbook's Guide lists payment failures and
    // reversals as out of scope, but acceptance check 6 needs them to exist.
    let augmented: 'FAILED' | 'REVERSED' | null = null;
    if (status === 'PAYMENT_PROCESSING' && index % 5 === 1) {
      status = 'PAYMENT_FAILED'; augmented = 'FAILED'; summary.augmentations.paymentFailures += 1;
    } else if (status === 'PAID' && index % 241 === 13) {
      status = 'REVERSED'; augmented = 'REVERSED'; summary.augmentations.paymentReversals += 1;
    }

    if (claimId && !seenClaims.has(claimId)) {
      seenClaims.add(claimId);
      handle.run(
        `INSERT INTO claims (claim_id, doctor_id, submitted_by, submitted_at, created_at, is_synthetic)
         VALUES (?,?,?,?,?,1)`,
        claimId, r.doctor_id!, `usr_${r.doctor_id!.toLowerCase()}`,
        at(r.claim_submitted_at || r.eligible_at!, EVENT_TIME.claim),
        at(r.eligible_at!, EVENT_TIME.claim));
      summary.claims += 1;
    }

    const claimItemId = r.claim_item_id!;
    handle.run(
      `INSERT INTO claim_items (claim_item_id, claim_id, application_id, task_id, doctor_id,
         department_id, eligibility_status, eligibility_rule_version, eligibility_assessed_by,
         eligible_at, not_eligible_reason, form_attachment_reference, submitted_at, submitted_by,
         finance_received_at, verified_at, verified_by, approved_at, approved_by, instructed_at,
         status, claimed_amount_sen, approved_amount_sen, return_reason, is_synthetic,
         source_system, imported_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'ELIGIBLE',?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'SYNTHETIC_SEED',?,?,?)`,
      claimItemId, claimId, applicationId, taskId, r.doctor_id!, deptId,
      ELIGIBILITY_RULE_VERSION, 'usr_records_1', at(r.eligible_at!, EVENT_TIME.claim),
      orNull(r.claim_form_reference_demo),
      orNull(r.claim_submitted_at) ? at(r.claim_submitted_at!, EVENT_TIME.claim) : null,
      orNull(r.claim_submitted_at) ? `usr_${r.doctor_id!.toLowerCase()}` : null,
      orNull(r.finance_received_at) ? at(r.finance_received_at!, EVENT_TIME.finance) : null,
      orNull(r.verified_at) ? at(r.verified_at!, EVENT_TIME.finance) : null,
      orNull(r.verified_at) ? 'usr_finance_1' : null,
      orNull(r.approved_at) ? at(r.approved_at!, EVENT_TIME.approval) : null,
      // Approval is performed by a different finance officer from the one who
      // handled verification, and never by the submitting doctor.
      orNull(r.approved_at) ? 'usr_finance_2' : null,
      orNull(r.approved_at) ? at(r.approved_at!, EVENT_TIME.approval) : null,
      status, claimedSen, approvedSen, orNull(r.return_or_rejection_reason),
      null, at(r.eligible_at!, EVENT_TIME.claim), at(r.eligible_at!, EVENT_TIME.claim));
    summary.claimItems += 1;

    // --------------------------------------------------- payment allocations
    const paymentDate = orNull(r.last_payment_at);
    const reference = orNull(r.payment_reference_demo);

    if (status === 'PAID' || status === 'PARTIALLY_PAID') {
      // Settlement evidence is complete, so the item may claim to be paid.
      handle.run(
        `INSERT INTO payment_allocations (payment_id, claim_item_id, payment_reference,
           voucher_reference, instructed_at, paid_at, reconciled_at, reconciled_by,
           amount_paid_sen, payment_status, is_synthetic, source_system, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'RECONCILED',1,'SYNTHETIC_SEED',?)`,
        newId('pay'), claimItemId, reference ?? `DEMO-PAY-${index + 1}`,
        `DEMO-VOUCHER-${index + 1}`,
        orNull(r.approved_at) ? at(r.approved_at!, EVENT_TIME.approval) : null,
        at(paymentDate ?? r.approved_at ?? r.eligible_at!, EVENT_TIME.payment),
        at(paymentDate ?? r.approved_at ?? r.eligible_at!, EVENT_TIME.payment),
        'usr_finance_1', netPaidSen, at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment));
      summary.payments += 1;
    } else if (status === 'PAYMENT_PROCESSING' || augmented === 'FAILED') {
      // Instructed only. No reference, no paid date: not evidence of settlement,
      // so the dashboard reads "Awaiting payment confirmation".
      handle.run(
        `INSERT INTO payment_allocations (payment_id, claim_item_id, voucher_reference,
           instructed_at, amount_paid_sen, payment_status, failure_reason, is_synthetic,
           source_system, created_at)
         VALUES (?,?,?,?,0,?,?,1,'SYNTHETIC_SEED',?)`,
        newId('pay'), claimItemId, `DEMO-VOUCHER-${index + 1}`,
        orNull(r.approved_at) ? at(r.approved_at!, EVENT_TIME.approval) : null,
        augmented === 'FAILED' ? 'FAILED' : 'INSTRUCTED',
        augmented === 'FAILED' ? 'SIMULATED_BANK_REJECTION_INVALID_ACCOUNT' : null,
        at(r.approved_at ?? r.eligible_at!, EVENT_TIME.payment));
      summary.payments += 1;
    } else if (augmented === 'REVERSED') {
      // The original settlement, then the reversal that cancels it. Both rows are
      // kept so the net position is derivable and the history is intact.
      const original = newId('pay');
      handle.run(
        `INSERT INTO payment_allocations (payment_id, claim_item_id, payment_reference,
           instructed_at, paid_at, reconciled_at, reconciled_by, amount_paid_sen,
           payment_status, is_synthetic, source_system, created_at)
         VALUES (?,?,?,?,?,?,'usr_finance_1',?,'RECONCILED',1,'SYNTHETIC_SEED',?)`,
        original, claimItemId, reference ?? `DEMO-PAY-${index + 1}`,
        orNull(r.approved_at) ? at(r.approved_at!, EVENT_TIME.approval) : null,
        at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment),
        at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment),
        netPaidSen, at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment));
      handle.run(
        `INSERT INTO payment_allocations (payment_id, claim_item_id, payment_reference,
           paid_at, reconciled_at, reconciled_by, amount_paid_sen, payment_status,
           reversal_reference, reverses_payment_id, is_synthetic, source_system, created_at)
         VALUES (?,?,?,?,?,'usr_finance_1',?,'REVERSED',?,?,1,'SYNTHETIC_SEED',?)`,
        newId('pay'), claimItemId, `DEMO-REV-${index + 1}`,
        at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment),
        at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment),
        -netPaidSen, `DEMO-REVERSAL-${index + 1}`, original,
        at(paymentDate ?? r.eligible_at!, EVENT_TIME.payment));
      summary.payments += 2;
    }

    eventCount += writeClaimEvents(handle, { claimItemId, applicationId, row: r, finalStatus: status });
  });

  // -------------------------------------- claim eligibility decisions on file
  // Applications the workbook marks NOT_ELIGIBLE get a recorded decision with a
  // rule version, so "not eligible" is auditable rather than merely absent.
  for (const r of appRows) {
    if (r.claim_eligibility !== 'NOT_ELIGIBLE') continue;
    const taskId = taskByApplication.get(r.application_id!);
    if (!taskId) continue;
    const deptId = deptByName.get(r.department ?? '')!;
    handle.run(
      `INSERT INTO claim_items (claim_item_id, claim_id, application_id, task_id, doctor_id,
         department_id, eligibility_status, eligibility_rule_version, eligibility_assessed_by,
         eligible_at, not_eligible_reason, status, claimed_amount_sen, is_synthetic,
         source_system, created_at, updated_at)
       VALUES (?,NULL,?,?,?,?,'NOT_ELIGIBLE',?,?,NULL,?, 'NOT_SUBMITTED',0,1,'SYNTHETIC_SEED',?,?)`,
      newId('ci'), r.application_id!, taskId, r.doctor_id!, deptId,
      ELIGIBILITY_RULE_VERSION, 'usr_records_1',
      'DEMO_NOT_CHARGEABLE_UNDER_PROTOTYPE_RULE',
      at(r.report_completed_at || r.received_at!, EVENT_TIME.claim),
      at(r.report_completed_at || r.received_at!, EVENT_TIME.claim));
    summary.claimItems += 1;
  }

  summary.statusEvents = eventCount;
  summary.contactEnquiries = seedContactEnquiries(handle, appRows);
  return summary;
}

// --------------------------------------------------------------------- helpers

const DELAY_ATTRIBUTION: Record<string, { stage: string; attributedTo:
  'APPLICANT' | 'RECORDS' | 'DOCTOR' | 'FINANCE' | 'EXTERNAL' | 'UNATTRIBUTED' }> = {
  RECORDS_RETRIEVAL: { stage: 'COMPLETENESS', attributedTo: 'RECORDS' },
  REVISION_REQUIRED: { stage: 'RECORDS_VERIFICATION', attributedTo: 'RECORDS' },
  DOCTOR_WORKLOAD: { stage: 'DOCTOR_PREPARATION', attributedTo: 'DOCTOR' },
  AWAITING_SIGNATURE: { stage: 'DOCTOR_PREPARATION', attributedTo: 'DOCTOR' },
  AWAITING_CONSENT: { stage: 'COMPLETENESS', attributedTo: 'APPLICANT' },
  AWAITING_ASSIGNMENT: { stage: 'ASSIGNMENT', attributedTo: 'RECORDS' },
};

function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function mapWorkbookStatus(status: string): InternalStatus {
  switch (status) {
    case 'COLLECTED': return 'COLLECTED_OR_DELIVERED';
    case 'READY': return 'READY_FOR_RELEASE';
    case 'UNASSIGNED': return 'COMPLETE_UNASSIGNED';
    case 'RELEASE_CHECK': case 'FINAL_REVIEW': return 'RECORDS_VERIFICATION';
    default: return status as InternalStatus;
  }
}

/**
 * Derives the internal status from the timestamps that exist, rather than trusting
 * the workbook's status column. Deriving from recorded events is what keeps the
 * status column and the event trail consistent; disagreements are reported.
 */
function deriveStatus(input: {
  cancelledDate: string | null; collectedDate: string | null; readyDate: string | null;
  completedDate: string | null; signedDate: string | null; acknowledgedDate: string | null;
  assignedDate: string | null; completeDate: string | null;
  workbookStatus: string; nextActionOwner: string;
}): InternalStatus {
  if (input.cancelledDate) return 'CANCELLED';
  if (input.collectedDate) return 'COLLECTED_OR_DELIVERED';
  if (input.readyDate || input.completedDate) return 'READY_FOR_RELEASE';
  if (input.signedDate) return 'RECORDS_VERIFICATION';
  if (input.acknowledgedDate) return 'IN_PREPARATION';
  if (input.assignedDate) return 'ASSIGNED';
  if (input.completeDate) return 'COMPLETE_UNASSIGNED';
  if (input.nextActionOwner === 'APPLICANT' || input.workbookStatus === 'AWAITING_DOCUMENTS') {
    return 'AWAITING_DOCUMENTS';
  }
  return 'RECEIVED';
}

function normaliseNextActionOwner(owner: string, status: InternalStatus): string {
  if (status === 'AWAITING_DOCUMENTS') return 'APPLICANT';
  if (owner === 'NONE' || !owner) return 'NONE';
  return owner;
}

function writeApplicationEvents(handle: Handle, a: {
  applicationId: string; internalStatus: InternalStatus; receivedDate: string;
  completeDate: string | null; recordedAt: string | null; assignedDate: string | null;
  acknowledgedDate: string | null; signedDate: string | null; completedDate: string | null;
  readyDate: string | null; notifiedDate: string | null; collectedDate: string | null;
  cancelledDate: string | null;
}): number {
  const steps: [string, string | null, string, string][] = [
    ['REGISTER', a.receivedDate, EVENT_TIME.received, 'RECEIVED'],
    ['MARK_COMPLETE', a.completeDate, EVENT_TIME.complete, 'COMPLETE_UNASSIGNED'],
    ['ASSIGN', a.assignedDate, EVENT_TIME.assigned, 'ASSIGNED'],
    ['ACKNOWLEDGE', a.acknowledgedDate, EVENT_TIME.acknowledged, 'ACKNOWLEDGED'],
    ['START_PREPARATION', a.acknowledgedDate, EVENT_TIME.preparation, 'IN_PREPARATION'],
    ['SUBMIT_SIGNED', a.signedDate, EVENT_TIME.signed, 'SIGNED_SUBMITTED'],
    ['BEGIN_RECORDS_CHECK', a.signedDate, EVENT_TIME.verification, 'RECORDS_VERIFICATION'],
    ['ACCEPT_COMPLETION', a.completedDate, EVENT_TIME.completed, 'READY_FOR_RELEASE'],
    ['NOTIFY_APPLICANT', a.notifiedDate, EVENT_TIME.notified, 'READY_FOR_RELEASE'],
    ['RECORD_COLLECTION', a.collectedDate, EVENT_TIME.collected, 'COLLECTED_OR_DELIVERED'],
    ['CANCEL', a.cancelledDate, EVENT_TIME.cancelled, 'CANCELLED'],
  ];
  let previous: string | null = null;
  let written = 0;
  for (const [eventType, date, clock, toStatus] of steps) {
    if (!date) continue;
    appendStatusEvent(handle, {
      entityType: 'APPLICATION', entityId: a.applicationId, applicationId: a.applicationId,
      eventType, fromStatus: previous, toStatus,
      occurredAt: at(date, clock),
      // MARK_COMPLETE is the one event whose recorded time can legitimately
      // differ from when it happened; the rest are recorded as they occur.
      recordedAt: eventType === 'MARK_COMPLETE' && a.recordedAt ? a.recordedAt : at(date, clock),
      actorUserId: ['ACKNOWLEDGE', 'START_PREPARATION', 'SUBMIT_SIGNED'].includes(eventType)
        ? null : 'usr_records_1',
      actorRole: ['ACKNOWLEDGE', 'START_PREPARATION', 'SUBMIT_SIGNED'].includes(eventType)
        ? 'doctor' : 'records_officer',
    });
    previous = toStatus;
    written += 1;
  }
  return written;
}

function writeTaskEvents(handle: Handle, t: {
  taskId: string; applicationId: string; doctorId: string; assignedDate: string;
  acknowledgedDate: string | null; signedDate: string | null; completedDate: string | null;
}): number {
  const steps: [string, string | null, string, string][] = [
    ['ASSIGN', t.assignedDate, EVENT_TIME.assigned, 'ASSIGNED'],
    ['ACKNOWLEDGE', t.acknowledgedDate, EVENT_TIME.acknowledged, 'ACKNOWLEDGED'],
    ['SUBMIT_SIGNED', t.signedDate, EVENT_TIME.signed, 'SIGNED_SUBMITTED'],
    ['ACCEPT_COMPLETION', t.completedDate, EVENT_TIME.completed, 'ACCEPTED_COMPLETE'],
  ];
  let previous: string | null = null;
  let written = 0;
  for (const [eventType, date, clock, toStatus] of steps) {
    if (!date) continue;
    appendStatusEvent(handle, {
      entityType: 'DOCTOR_TASK', entityId: t.taskId, applicationId: t.applicationId,
      eventType, fromStatus: previous, toStatus, occurredAt: at(date, clock),
      recordedAt: at(date, clock),
      actorRole: eventType === 'ACKNOWLEDGE' || eventType === 'SUBMIT_SIGNED'
        ? 'doctor' : 'records_officer',
    });
    previous = toStatus;
    written += 1;
  }
  return written;
}

function writeClaimEvents(handle: Handle, c: {
  claimItemId: string; applicationId: string; row: Record<string, string>; finalStatus: string;
}): number {
  const r = c.row;
  const steps: [string, string | null, string, string][] = [
    ['ASSESS_ELIGIBILITY', orNull(r.eligible_at), EVENT_TIME.claim, 'ELIGIBLE'],
    ['SUBMIT_CLAIM', orNull(r.claim_submitted_at), EVENT_TIME.claim, 'SUBMITTED'],
    ['FINANCE_RECEIVE', orNull(r.finance_received_at), EVENT_TIME.finance, 'UNDER_VERIFICATION'],
    ['VERIFY_CLAIM', orNull(r.verified_at), EVENT_TIME.finance, 'VERIFIED'],
    ['APPROVE_CLAIM', orNull(r.approved_at), EVENT_TIME.approval, 'APPROVED'],
    ['RECONCILE_PAYMENT', orNull(r.last_payment_at), EVENT_TIME.payment, c.finalStatus],
  ];
  let previous: string | null = null;
  let written = 0;
  for (const [eventType, date, clock, toStatus] of steps) {
    if (!date) continue;
    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: c.claimItemId, applicationId: c.applicationId,
      eventType, fromStatus: previous, toStatus, occurredAt: at(date, clock),
      recordedAt: at(date, clock),
      actorRole: eventType === 'SUBMIT_CLAIM' ? 'doctor' : 'finance_officer',
    });
    previous = toStatus;
    written += 1;
  }
  return written;
}

/**
 * Seeds the status-enquiry log that the follow-up burden indicator counts.
 *
 * This is the one table with no source in the workbook, so it is generated
 * deterministically from the application index at roughly 18 enquiries per 100
 * applications. It is a **contact-volume indicator** only: it is not a
 * patient-level probability, and there is no measured baseline to claim an
 * improvement against.
 */
function seedContactEnquiries(handle: Handle, appRows: Record<string, string>[]): number {
  const kinds = ['STATUS_CHECK', 'STATUS_CHECK', 'STATUS_CHECK', 'DOCUMENT_QUERY',
    'COLLECTION_QUERY', 'FEE_QUERY'] as const;
  const channels = ['PHONE', 'PHONE', 'PHONE', 'COUNTER_VISIT'] as const;
  let count = 0;
  appRows.forEach((r, index) => {
    // Deterministic pseudo-random draw: no RNG, so a reseed reproduces exactly.
    const draws = (index * 7919) % 100 < 18 ? 1 : 0;
    const extra = (index * 104729) % 100 < 4 ? 1 : 0;
    for (let n = 0; n < draws + extra; n += 1) {
      const when = orNull(r.notified_at) ?? orNull(r.assigned_at) ?? r.received_at!;
      handle.run(
        `INSERT INTO contact_enquiries (enquiry_id, application_id, channel, enquiry_kind,
           occurred_at, logged_by, note, created_at)
         VALUES (?,?,?,?,?,'usr_records_1',?,?)`,
        newId('enq'), r.application_id!,
        channels[(index + n) % channels.length]!, kinds[(index + n * 3) % kinds.length]!,
        at(when, '10:30'), 'Seeded synthetic enquiry log — contact volume only.',
        at(when, '10:30'));
      count += 1;
    }
  });
  return count;
}
