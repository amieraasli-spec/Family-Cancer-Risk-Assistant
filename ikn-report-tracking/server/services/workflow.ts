/**
 * The medical report workflow.
 *
 * One function — `applyEvent` — is the only way an application's status changes.
 * It validates the transition against the table below, writes the projection and
 * appends the event, all inside one transaction. There is no second path, so a
 * status can never move without an event explaining it.
 *
 * Deadline invariants enforced here:
 *  - `original_service_due_at` is written exactly once, when completeness is
 *    recorded, and is never rewritten by any later event.
 *  - reassignment, return for correction, reopening and claim activity leave it
 *    untouched; only `GRANT_EXTENSION` writes `revised_due_at`, and it keeps the
 *    original alongside.
 */
import type { Handle } from '../db/database.ts';
import { appendDelayEvent, appendStatusEvent } from '../domain/events.ts';
import { computeDoctorDeadline, computeServiceDeadline } from '../domain/deadlines.ts';
import { newId } from '../domain/ids.ts';
import { slaRule } from '../domain/rules.ts';
import { nowInstant, startOfBusinessDay, toBusinessDate, type Instant } from '../domain/time.ts';
import { PUBLIC_STAGE_OF, type InternalStatus } from '../../shared/domain.ts';
import { conflict, unprocessable } from '../http/errors.ts';
import type { Principal } from '../auth/session.ts';

export type WorkflowEvent =
  | 'MARK_INCOMPLETE' | 'MARK_COMPLETE' | 'ASSIGN' | 'REASSIGN' | 'ACKNOWLEDGE'
  | 'START_PREPARATION' | 'SUBMIT_SIGNED' | 'BEGIN_RECORDS_CHECK' | 'RETURN_FOR_CORRECTION'
  | 'ACCEPT_COMPLETION' | 'NOTIFY_APPLICANT' | 'RECORD_COLLECTION' | 'CANCEL' | 'REOPEN'
  | 'GRANT_EXTENSION';

/** Permitted `from` statuses for each event, and the status it moves to. */
const TRANSITIONS: Record<WorkflowEvent, { from: readonly InternalStatus[]; to: InternalStatus | 'UNCHANGED' }> = {
  MARK_INCOMPLETE: { from: ['RECEIVED', 'COMPLETE_UNASSIGNED'], to: 'AWAITING_DOCUMENTS' },
  MARK_COMPLETE: { from: ['RECEIVED', 'AWAITING_DOCUMENTS'], to: 'COMPLETE_UNASSIGNED' },
  ASSIGN: { from: ['COMPLETE_UNASSIGNED'], to: 'ASSIGNED' },
  REASSIGN: {
    from: ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PREPARATION', 'SIGNED_SUBMITTED'], to: 'ASSIGNED',
  },
  ACKNOWLEDGE: { from: ['ASSIGNED'], to: 'ACKNOWLEDGED' },
  START_PREPARATION: { from: ['ACKNOWLEDGED'], to: 'IN_PREPARATION' },
  SUBMIT_SIGNED: { from: ['ACKNOWLEDGED', 'IN_PREPARATION'], to: 'SIGNED_SUBMITTED' },
  BEGIN_RECORDS_CHECK: { from: ['SIGNED_SUBMITTED'], to: 'RECORDS_VERIFICATION' },
  RETURN_FOR_CORRECTION: { from: ['RECORDS_VERIFICATION'], to: 'IN_PREPARATION' },
  ACCEPT_COMPLETION: { from: ['RECORDS_VERIFICATION'], to: 'READY_FOR_RELEASE' },
  NOTIFY_APPLICANT: { from: ['READY_FOR_RELEASE'], to: 'UNCHANGED' },
  RECORD_COLLECTION: { from: ['READY_FOR_RELEASE'], to: 'COLLECTED_OR_DELIVERED' },
  CANCEL: {
    from: ['RECEIVED', 'AWAITING_DOCUMENTS', 'COMPLETE_UNASSIGNED', 'ASSIGNED', 'ACKNOWLEDGED',
      'IN_PREPARATION', 'SIGNED_SUBMITTED', 'RECORDS_VERIFICATION', 'READY_FOR_RELEASE'],
    to: 'CANCELLED',
  },
  REOPEN: { from: ['CANCELLED', 'COLLECTED_OR_DELIVERED'], to: 'UNCHANGED' },
  GRANT_EXTENSION: {
    from: ['RECEIVED', 'AWAITING_DOCUMENTS', 'COMPLETE_UNASSIGNED', 'ASSIGNED', 'ACKNOWLEDGED',
      'IN_PREPARATION', 'SIGNED_SUBMITTED', 'RECORDS_VERIFICATION'],
    to: 'UNCHANGED',
  },
};

export interface ApplicationRow extends Record<string, unknown> {
  application_id: string;
  internal_status: InternalStatus;
  department_id: string;
  report_type: string;
  received_at: Instant;
  application_complete_at: Instant | null;
  completeness_recorded_at: Instant | null;
  original_service_due_at: Instant | null;
  revised_due_at: Instant | null;
  sla_rule_version: string;
}

export interface EventInput {
  applicationId: string;
  event: WorkflowEvent;
  actor: Principal;
  /** When the thing happened. Defaults to now; a backdated entry is recorded as such. */
  occurredAt?: Instant;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}

export interface EventResult {
  applicationId: string;
  fromStatus: InternalStatus;
  toStatus: InternalStatus;
  originalServiceDueDate: string | null;
  revisedDueDate: string | null;
  taskId?: string;
  /** Set when this event completed a report; release is independent of any claim. */
  reportCompletedAt?: Instant;
}

export function loadApplication(handle: Handle, applicationId: string): ApplicationRow {
  const row = handle.get<ApplicationRow>(
    `SELECT application_id, internal_status, department_id, report_type, received_at,
            application_complete_at, completeness_recorded_at, original_service_due_at,
            revised_due_at, sla_rule_version
     FROM applications WHERE application_id = ?`, applicationId);
  if (!row) throw unprocessable('UNKNOWN_APPLICATION', 'No such application.');
  return row;
}

export function applyEvent(handle: Handle, input: EventInput): EventResult {
  return handle.transaction(() => applyEventInTransaction(handle, input));
}

function applyEventInTransaction(handle: Handle, input: EventInput): EventResult {
  const app = loadApplication(handle, input.applicationId);
  const rule = TRANSITIONS[input.event];
  if (!rule.from.includes(app.internal_status)) {
    throw conflict('INVALID_TRANSITION',
      `${input.event} is not permitted from ${app.internal_status}.`,
      { from: app.internal_status, permittedFrom: rule.from });
  }

  const occurredAt = input.occurredAt ?? nowInstant();
  const recordedAt = nowInstant();
  const sla = slaRule(handle, app.sla_rule_version);
  const payload = input.payload ?? {};
  const result: EventResult = {
    applicationId: app.application_id,
    fromStatus: app.internal_status,
    toStatus: rule.to === 'UNCHANGED' ? app.internal_status : rule.to,
    originalServiceDueDate: app.original_service_due_at
      ? toBusinessDate(app.original_service_due_at) : null,
    revisedDueDate: app.revised_due_at ? toBusinessDate(app.revised_due_at) : null,
  };

  switch (input.event) {
    case 'MARK_COMPLETE': {
      // The true completeness time and the time staff recorded it are stored
      // separately, so a late entry cannot silently restart the service clock.
      const completeAt = typeof payload.completeAt === 'string' ? payload.completeAt : occurredAt;
      if (completeAt > recordedAt) {
        throw unprocessable('FUTURE_COMPLETENESS', 'Completeness cannot be dated in the future.');
      }
      if (completeAt < app.received_at) {
        throw unprocessable('COMPLETENESS_BEFORE_RECEIPT',
          'Completeness cannot precede the date the application was received.');
      }
      const deadline = computeServiceDeadline(handle, sla, app.report_type, completeAt);
      handle.run(
        `UPDATE applications SET application_complete_at = ?, completeness_recorded_at = ?,
           original_service_due_at = ?, next_action_owner = 'RECORDS', updated_at = ?
         WHERE application_id = ?`,
        completeAt, recordedAt, startOfBusinessDay(deadline.dueDate), recordedAt, app.application_id);
      result.originalServiceDueDate = deadline.dueDate;
      break;
    }

    case 'MARK_INCOMPLETE': {
      handle.run(
        `UPDATE applications SET next_action_owner = 'APPLICANT', updated_at = ?
         WHERE application_id = ?`, recordedAt, app.application_id);
      appendDelayEvent(handle, {
        applicationId: app.application_id, stage: 'COMPLETENESS', attributedTo: 'APPLICANT',
        reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode : 'AWAITING_DOCUMENTS',
        startedAt: occurredAt, recordedBy: input.actor.userId,
      });
      break;
    }

    case 'ASSIGN':
    case 'REASSIGN': {
      const doctorId = requireString(payload, 'doctorId');
      const doctor = handle.get<{ department_id: string; active: number }>(
        'SELECT department_id, active FROM doctors WHERE doctor_id = ?', doctorId);
      if (!doctor || doctor.active !== 1) {
        throw unprocessable('UNKNOWN_DOCTOR', 'No such active doctor.');
      }
      if (input.event === 'REASSIGN') {
        // The previous task is closed, not deleted, and the reassignment is counted.
        const previous = activeTask(handle, app.application_id);
        if (previous) {
          handle.run(
            `UPDATE doctor_tasks SET active = 0, superseded_at = ?, updated_at = ?
             WHERE task_id = ?`, occurredAt, recordedAt, previous.task_id);
          appendStatusEvent(handle, {
            entityType: 'DOCTOR_TASK', entityId: previous.task_id,
            applicationId: app.application_id, eventType: 'SUPERSEDED_BY_REASSIGNMENT',
            fromStatus: 'ACTIVE', toStatus: 'SUPERSEDED', occurredAt, recordedAt,
            actorUserId: input.actor.userId, actorRole: input.actor.role,
            reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode : null,
          });
        }
      }

      // The doctor deadline is recomputed from this assignment, but the service
      // deadline is not touched: reassignment does not buy the hospital more time.
      const serviceDue = app.original_service_due_at
        ? toBusinessDate(app.original_service_due_at) : null;
      const doctorDue = computeDoctorDeadline(handle, sla, occurredAt, serviceDue);
      const taskId = newId('task');
      const previousCount = handle.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM doctor_tasks WHERE application_id = ?', app.application_id);
      handle.run(
        `INSERT INTO doctor_tasks (task_id, application_id, doctor_id, department_id, sequence_no,
           active, assigned_at, assigned_by, original_doctor_due_at, current_doctor_due_at,
           return_count, reassignment_events, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?,?,?,?,0,?,?,?)`,
        taskId, app.application_id, doctorId, doctor.department_id, (previousCount?.n ?? 0) + 1,
        occurredAt, input.actor.userId, startOfBusinessDay(doctorDue.dueDate),
        startOfBusinessDay(doctorDue.dueDate), input.event === 'REASSIGN' ? 1 : 0,
        recordedAt, recordedAt);
      handle.run(
        `UPDATE applications SET department_id = ?, next_action_owner = 'DOCTOR', updated_at = ?
         WHERE application_id = ?`, doctor.department_id, recordedAt, app.application_id);
      appendStatusEvent(handle, {
        entityType: 'DOCTOR_TASK', entityId: taskId, applicationId: app.application_id,
        eventType: input.event, toStatus: 'ASSIGNED', occurredAt, recordedAt,
        actorUserId: input.actor.userId, actorRole: input.actor.role,
        payload: { doctorId, doctorDueDate: doctorDue.dueDate,
          cappedByReviewBuffer: doctorDue.cappedByReviewBuffer },
      });
      result.taskId = taskId;
      break;
    }

    case 'ACKNOWLEDGE': {
      const task = requireActiveTask(handle, app.application_id);
      handle.run('UPDATE doctor_tasks SET acknowledged_at = ?, updated_at = ? WHERE task_id = ?',
        occurredAt, recordedAt, task.task_id);
      taskEvent(handle, task.task_id, app.application_id, 'ACKNOWLEDGE', 'ACKNOWLEDGED',
        occurredAt, recordedAt, input.actor);
      result.taskId = task.task_id;
      break;
    }

    case 'START_PREPARATION': {
      const task = requireActiveTask(handle, app.application_id);
      taskEvent(handle, task.task_id, app.application_id, 'START_PREPARATION', 'IN_PREPARATION',
        occurredAt, recordedAt, input.actor);
      result.taskId = task.task_id;
      break;
    }

    case 'SUBMIT_SIGNED': {
      const task = requireActiveTask(handle, app.application_id);
      handle.run('UPDATE doctor_tasks SET signed_submitted_at = ?, updated_at = ? WHERE task_id = ?',
        occurredAt, recordedAt, task.task_id);
      handle.run(
        `UPDATE applications SET next_action_owner = 'RECORDS', updated_at = ?
         WHERE application_id = ?`, recordedAt, app.application_id);
      taskEvent(handle, task.task_id, app.application_id, 'SUBMIT_SIGNED', 'SIGNED_SUBMITTED',
        occurredAt, recordedAt, input.actor);
      result.taskId = task.task_id;
      break;
    }

    case 'BEGIN_RECORDS_CHECK':
      break;

    case 'RETURN_FOR_CORRECTION': {
      const task = requireActiveTask(handle, app.application_id);
      const reason = requireString(payload, 'reasonCode');
      handle.run(
        `UPDATE doctor_tasks SET returned_at = ?, return_count = return_count + 1,
           delay_reason_code = ?, signed_submitted_at = NULL, updated_at = ?
         WHERE task_id = ?`, occurredAt, reason, recordedAt, task.task_id);
      handle.run(
        `UPDATE applications SET next_action_owner = 'DOCTOR', updated_at = ?
         WHERE application_id = ?`, recordedAt, app.application_id);
      // The rework is recorded against the stage that caused it. The service
      // deadline is not extended, and the doctor deadline is not reset.
      appendDelayEvent(handle, {
        applicationId: app.application_id, taskId: task.task_id, stage: 'RECORDS_VERIFICATION',
        attributedTo: typeof payload.attributedTo === 'string'
          ? payload.attributedTo as 'RECORDS' : 'RECORDS',
        reasonCode: reason, startedAt: occurredAt, recordedBy: input.actor.userId,
      });
      taskEvent(handle, task.task_id, app.application_id, 'RETURN_FOR_CORRECTION', 'RETURNED',
        occurredAt, recordedAt, input.actor);
      result.taskId = task.task_id;
      break;
    }

    case 'ACCEPT_COMPLETION': {
      const task = requireActiveTask(handle, app.application_id);
      if (!task.signed_submitted_at) {
        throw conflict('NO_SIGNED_SUBMISSION',
          'A signed report must be submitted before completion can be accepted.');
      }
      handle.run('UPDATE doctor_tasks SET accepted_completed_at = ?, updated_at = ? WHERE task_id = ?',
        occurredAt, recordedAt, task.task_id);
      upsertRelease(handle, app.application_id, {
        report_completed_at: occurredAt, ready_at: occurredAt,
        release_authorised_by: input.actor.userId,
      }, recordedAt);
      handle.run(
        `UPDATE applications SET next_action_owner = 'RECORDS', updated_at = ?
         WHERE application_id = ?`, recordedAt, app.application_id);
      taskEvent(handle, task.task_id, app.application_id, 'ACCEPT_COMPLETION', 'ACCEPTED_COMPLETE',
        occurredAt, recordedAt, input.actor);
      result.taskId = task.task_id;
      result.reportCompletedAt = occurredAt;
      break;
    }

    case 'NOTIFY_APPLICANT':
      upsertRelease(handle, app.application_id, { notified_at: occurredAt }, recordedAt);
      break;

    case 'RECORD_COLLECTION': {
      // Release is never conditional on a doctor's claim or reimbursement. The only
      // gate that may apply is an unsettled patient fee, and only when the active
      // fee rule turns it on — which it does not, by default.
      assertFeeGateSatisfied(handle, app.application_id);
      upsertRelease(handle, app.application_id, {
        collection_or_delivery_at: occurredAt,
        release_method: typeof payload.releaseMethod === 'string'
          ? payload.releaseMethod : 'COUNTER_COLLECTION',
        receipt_of_delivery_reference: requireString(payload, 'receiptReference'),
        collected_by_description: typeof payload.collectedBy === 'string'
          ? payload.collectedBy : null,
      }, recordedAt);
      handle.run(
        `UPDATE applications SET next_action_owner = 'NONE', updated_at = ?
         WHERE application_id = ?`, recordedAt, app.application_id);
      break;
    }

    case 'CANCEL': {
      handle.run(
        `UPDATE applications SET cancellation_reason = ?, cancellation_public_message = ?,
           cancelled_at = ?, next_action_owner = 'NONE', updated_at = ?
         WHERE application_id = ?`,
        requireString(payload, 'reasonCode'), requireString(payload, 'publicMessage'),
        occurredAt, recordedAt, app.application_id);
      handle.run('UPDATE doctor_tasks SET active = 0, superseded_at = ? WHERE application_id = ? AND active = 1',
        occurredAt, app.application_id);
      break;
    }

    case 'REOPEN': {
      // Reopening restores the prior stage from the event trail rather than
      // guessing, and the original deadline is left exactly as it was.
      const previous = handle.get<{ from_status: string }>(
        `SELECT from_status FROM status_events
         WHERE entity_type = 'APPLICATION' AND entity_id = ?
           AND to_status IN ('CANCELLED','COLLECTED_OR_DELIVERED')
         ORDER BY sequence_no DESC LIMIT 1`, app.application_id);
      const restored = (previous?.from_status ?? 'RECEIVED') as InternalStatus;
      handle.run(
        `UPDATE applications SET cancelled_at = NULL, updated_at = ? WHERE application_id = ?`,
        recordedAt, app.application_id);
      result.toStatus = restored;
      break;
    }

    case 'GRANT_EXTENSION': {
      if (!app.original_service_due_at) {
        throw conflict('NO_ORIGINAL_DEADLINE',
          'An extension needs an original deadline, which exists only once the application is complete.');
      }
      const revised = requireString(payload, 'revisedDueDate');
      if (revised <= toBusinessDate(app.original_service_due_at)) {
        throw unprocessable('EXTENSION_NOT_LATER',
          'A revised deadline must fall after the original deadline.');
      }
      handle.run(
        `INSERT INTO deadline_extensions (extension_id, application_id, original_due_at,
           revised_due_at, reason, approved_by, requested_at, approved_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        newId('ext'), app.application_id, app.original_service_due_at,
        startOfBusinessDay(revised), requireString(payload, 'reason'), input.actor.userId,
        occurredAt, occurredAt, recordedAt);
      // The original stays; the revision is recorded alongside it.
      handle.run('UPDATE applications SET revised_due_at = ?, updated_at = ? WHERE application_id = ?',
        startOfBusinessDay(revised), recordedAt, app.application_id);
      result.revisedDueDate = revised;
      break;
    }

    default: {
      const exhaustive: never = input.event;
      throw new Error(`unhandled workflow event: ${String(exhaustive)}`);
    }
  }

  // Projection, then event. The event is the record; the columns are the cache.
  if (result.toStatus !== app.internal_status) {
    handle.run(
      `UPDATE applications SET internal_status = ?, public_status = ?, last_public_update_at = ?,
         updated_at = ? WHERE application_id = ?`,
      result.toStatus, PUBLIC_STAGE_OF[result.toStatus], occurredAt, recordedAt, app.application_id);
  } else {
    handle.run('UPDATE applications SET last_public_update_at = ?, updated_at = ? WHERE application_id = ?',
      occurredAt, recordedAt, app.application_id);
  }

  appendStatusEvent(handle, {
    entityType: 'APPLICATION', entityId: app.application_id, applicationId: app.application_id,
    eventType: input.event, fromStatus: app.internal_status, toStatus: result.toStatus,
    occurredAt, recordedAt, actorUserId: input.actor.userId, actorRole: input.actor.role,
    reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode : null,
    note: typeof payload.note === 'string' ? payload.note : null,
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  return result;
}

// ------------------------------------------------------------------- helpers

interface TaskRow extends Record<string, unknown> {
  task_id: string;
  doctor_id: string;
  department_id: string;
  signed_submitted_at: Instant | null;
}

export function activeTask(handle: Handle, applicationId: string): TaskRow | undefined {
  return handle.get<TaskRow>(
    `SELECT task_id, doctor_id, department_id, signed_submitted_at FROM doctor_tasks
     WHERE application_id = ? AND active = 1`, applicationId);
}

function requireActiveTask(handle: Handle, applicationId: string): TaskRow {
  const task = activeTask(handle, applicationId);
  if (!task) throw conflict('NO_ACTIVE_TASK', 'This application has no active doctor task.');
  return task;
}

function taskEvent(
  handle: Handle, taskId: string, applicationId: string, eventType: string, toStatus: string,
  occurredAt: Instant, recordedAt: Instant, actor: Principal,
): void {
  appendStatusEvent(handle, {
    entityType: 'DOCTOR_TASK', entityId: taskId, applicationId, eventType, toStatus,
    occurredAt, recordedAt, actorUserId: actor.userId, actorRole: actor.role,
  });
}

function upsertRelease(
  handle: Handle, applicationId: string, fields: Record<string, string | null>, recordedAt: Instant,
): void {
  const exists = handle.get<{ application_id: string }>(
    'SELECT application_id FROM releases WHERE application_id = ?', applicationId);
  if (!exists) {
    handle.run('INSERT INTO releases (application_id, created_at, updated_at) VALUES (?,?,?)',
      applicationId, recordedAt, recordedAt);
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  handle.run(
    `UPDATE releases SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?
     WHERE application_id = ?`,
    ...keys.map((k) => fields[k] ?? null), recordedAt, applicationId);
}

/**
 * The only release condition the system will apply, and only when the active fee
 * rule turns it on. It ships off, because no policy permitting a fee-gated release
 * was supplied. Nothing here consults a claim or a payment.
 */
function assertFeeGateSatisfied(handle: Handle, applicationId: string): void {
  const row = handle.get<{ release_requires_settled: number; fee_status: string }>(
    `SELECT r.release_requires_settled, f.fee_status
     FROM patient_fees f JOIN fee_rules r ON r.fee_rule_version = f.fee_rule_version
     WHERE f.application_id = ?`, applicationId);
  if (!row) return;
  if (row.release_requires_settled !== 1) return;
  if (row.fee_status === 'AWAITING_PAYMENT') {
    throw conflict('FEE_OUTSTANDING',
      'The active fee rule requires the patient fee to be settled before release.');
  }
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw unprocessable('MISSING_FIELD', `${key} is required for this event.`);
  }
  return value.trim();
}
