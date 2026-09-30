/**
 * The append-only event trail.
 *
 * `status_events` is the record of what happened; the status column on an entity
 * is a cached projection of the newest event. Nothing in this codebase updates or
 * deletes a row here — `appendStatusEvent` is the only writer, and it only inserts.
 */
import type { Handle } from '../db/database.ts';
import { newId } from './ids.ts';
import { nowInstant, type Instant } from './time.ts';

export type EntityType = 'APPLICATION' | 'DOCTOR_TASK' | 'PATIENT_FEE' | 'CLAIM_ITEM'
  | 'PAYMENT' | 'RELEASE';

export interface StatusEventInput {
  entityType: EntityType;
  entityId: string;
  applicationId?: string | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  /** When the thing actually happened. */
  occurredAt: Instant;
  /** When the system was told. Defaults to now, and is deliberately separate. */
  recordedAt?: Instant;
  actorUserId?: string | null;
  actorRole?: string | null;
  reasonCode?: string | null;
  note?: string | null;
  payload?: unknown;
  idempotencyKey?: string | null;
}

export function appendStatusEvent(handle: Handle, input: StatusEventInput): string {
  const next = handle.get<{ n: number | null }>(
    'SELECT MAX(sequence_no) AS n FROM status_events WHERE entity_type = ? AND entity_id = ?',
    input.entityType, input.entityId);
  const sequenceNo = (next?.n ?? 0) + 1;
  const eventId = newId('evt');
  const recordedAt = input.recordedAt ?? nowInstant();

  handle.run(
    `INSERT INTO status_events (event_id, entity_type, entity_id, application_id, event_type,
       from_status, to_status, occurred_at, recorded_at, actor_user_id, actor_role,
       reason_code, note, payload_json, idempotency_key, sequence_no, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    eventId, input.entityType, input.entityId, input.applicationId ?? null, input.eventType,
    input.fromStatus ?? null, input.toStatus ?? null, input.occurredAt, recordedAt,
    input.actorUserId ?? null, input.actorRole ?? null, input.reasonCode ?? null,
    input.note ?? null, input.payload === undefined ? null : JSON.stringify(input.payload),
    input.idempotencyKey ?? null, sequenceNo, nowInstant(),
  );
  return eventId;
}

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  outcome: 'ALLOWED' | 'DENIED' | 'ERROR';
  resourceType?: string | null;
  resourceId?: string | null;
  permission?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  clientHint?: string | null;
  detail?: unknown;
}

/**
 * Records a privileged access or an authorisation decision.
 *
 * Denials are audited as well as grants: a run of DENIED rows against one
 * account is the signal that matters most.
 */
export function appendAuditEvent(handle: Handle, input: AuditInput): void {
  handle.run(
    `INSERT INTO audit_events (audit_id, occurred_at, actor_user_id, actor_role, action, outcome,
       resource_type, resource_id, permission, request_method, request_path, client_hint, detail_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newId('aud'), nowInstant(), input.actorUserId ?? null, input.actorRole ?? null,
    input.action, input.outcome, input.resourceType ?? null, input.resourceId ?? null,
    input.permission ?? null, input.requestMethod ?? null, input.requestPath ?? null,
    input.clientHint ?? null, input.detail === undefined ? null : JSON.stringify(input.detail),
  );
}

export interface DelayEventInput {
  applicationId: string;
  taskId?: string | null;
  stage: string;
  attributedTo: 'APPLICANT' | 'RECORDS' | 'DOCTOR' | 'FINANCE' | 'EXTERNAL' | 'UNATTRIBUTED';
  reasonCode: string;
  note?: string | null;
  startedAt: Instant;
  endedAt?: Instant | null;
  recordedBy?: string | null;
}

/**
 * Records a delay against the stage that owned it.
 *
 * `attributedTo` defaults to nothing: a caller has to decide. Delay is never
 * attributed to the doctor by virtue of a report being late.
 */
export function appendDelayEvent(handle: Handle, input: DelayEventInput): string {
  const id = newId('dly');
  handle.run(
    `INSERT INTO delay_events (delay_event_id, application_id, task_id, stage, attributed_to,
       reason_code, note, started_at, ended_at, recorded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.applicationId, input.taskId ?? null, input.stage, input.attributedTo,
    input.reasonCode, input.note ?? null, input.startedAt, input.endedAt ?? null,
    input.recordedBy ?? null, nowInstant(),
  );
  return id;
}
