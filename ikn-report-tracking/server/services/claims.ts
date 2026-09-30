/**
 * Doctor claims and payment reconciliation.
 *
 * Three rules this module exists to enforce:
 *
 *  1. **Completing a report does not create a payable entitlement.** Eligibility is
 *     a separate, recorded decision under a named rule version, taken by Records or
 *     Finance — never a side effect of `ACCEPT_COMPLETION`.
 *  2. **"Paid" requires reconciled evidence of actual payment**: a reference, an
 *     amount and a payment date, with a reconciliation timestamp. An approval, a
 *     payment instruction or a voucher moves an item no further than
 *     `PAYMENT_PROCESSING`, which the interface shows as "Awaiting payment
 *     confirmation".
 *  3. **No duplicate active claim item** for the same eligible service, on first
 *     submission, on resubmission after a return, or on spreadsheet import.
 *
 * The system records payments. It never instructs a bank.
 */
import type { Handle } from '../db/database.ts';
import { appendStatusEvent } from '../domain/events.ts';
import { newId } from '../domain/ids.ts';
import { activeEligibilityRule } from '../domain/rules.ts';
import { nowInstant, type Instant } from '../domain/time.ts';
import { CLAIM_SLOT_HELD_BY, type ClaimStatus } from '../../shared/domain.ts';
import { conflict, forbidden, unprocessable } from '../http/errors.ts';
import type { Principal } from '../auth/session.ts';

export interface ClaimItemRow extends Record<string, unknown> {
  claim_item_id: string;
  claim_id: string | null;
  application_id: string;
  task_id: string;
  doctor_id: string;
  department_id: string;
  eligibility_status: string;
  eligibility_rule_version: string | null;
  eligible_at: Instant | null;
  status: ClaimStatus;
  claimed_amount_sen: number;
  approved_amount_sen: number | null;
  submitted_by: string | null;
  submitted_at: Instant | null;
  finance_received_at: Instant | null;
  verified_at: Instant | null;
  approved_at: Instant | null;
  instructed_at: Instant | null;
}

export function loadClaimItem(handle: Handle, claimItemId: string): ClaimItemRow {
  const row = handle.get<ClaimItemRow>(
    'SELECT * FROM claim_items WHERE claim_item_id = ?', claimItemId);
  if (!row) throw unprocessable('UNKNOWN_CLAIM_ITEM', 'No such claim item.');
  return row;
}

/**
 * Records an eligibility decision for a completed report.
 *
 * Requires the report to have reached the endpoint the rule version names, so
 * eligibility cannot be asserted for work that is not finished.
 */
export function assessEligibility(
  handle: Handle, input: {
    applicationId: string; eligible: boolean; actor: Principal;
    notEligibleReason?: string; claimedAmountSen?: number; occurredAt?: Instant;
  },
): { claimItemId: string; eligibilityStatus: string } {
  return handle.transaction(() => {
    const occurredAt = input.occurredAt ?? nowInstant();
    const rule = activeEligibilityRule(handle, occurredAt);

    const task = handle.get<{ task_id: string; doctor_id: string; department_id: string;
      accepted_completed_at: Instant | null }>(
      `SELECT task_id, doctor_id, department_id, accepted_completed_at FROM doctor_tasks
       WHERE application_id = ? AND active = 1`, input.applicationId);
    if (!task) throw conflict('NO_ACTIVE_TASK', 'This application has no active doctor task.');

    const report = handle.get<{ report_type: string }>(
      'SELECT report_type FROM applications WHERE application_id = ?', input.applicationId);
    if (!report) throw unprocessable('UNKNOWN_APPLICATION', 'No such application.');

    if (input.eligible) {
      if (!task.accepted_completed_at) {
        throw conflict('REPORT_NOT_COMPLETE',
          'Eligibility requires the report completion to have been accepted by Records.');
      }
      if (!rule.criteria.chargeableReportTypes.includes(report.report_type)) {
        throw unprocessable('REPORT_TYPE_NOT_CHARGEABLE',
          `Rule ${rule.eligibilityRuleVersion} does not make ${report.report_type} chargeable.`);
      }
      // The duplicate guard, checked before the insert so the caller gets a clear
      // 409 rather than a constraint error. The partial unique index is the
      // backstop that also catches a concurrent request and an import.
      const existing = handle.get<{ claim_item_id: string; status: string }>(
        `SELECT claim_item_id, status FROM claim_items
         WHERE application_id = ? AND task_id = ? AND eligibility_rule_version = ?
           AND eligibility_status = 'ELIGIBLE'
           AND status NOT IN ('REJECTED','WITHDRAWN','REVERSED')`,
        input.applicationId, task.task_id, rule.eligibilityRuleVersion);
      if (existing) {
        throw conflict('DUPLICATE_CLAIM_ITEM',
          'An active claim item already exists for this report under this eligibility rule.',
          { existingClaimItemId: existing.claim_item_id, existingStatus: existing.status });
      }
    }

    const claimItemId = newId('ci');
    handle.run(
      `INSERT INTO claim_items (claim_item_id, claim_id, application_id, task_id, doctor_id,
         department_id, eligibility_status, eligibility_rule_version, eligibility_assessed_by,
         eligible_at, not_eligible_reason, status, claimed_amount_sen, is_synthetic,
         source_system, created_at, updated_at)
       VALUES (?,NULL,?,?,?,?,?,?,?,?,?,'NOT_SUBMITTED',?,0,'MANUAL',?,?)`,
      claimItemId, input.applicationId, task.task_id, task.doctor_id, task.department_id,
      input.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE', rule.eligibilityRuleVersion,
      input.actor.userId, input.eligible ? occurredAt : null,
      input.eligible ? null : (input.notEligibleReason ?? 'NOT_ELIGIBLE_UNDER_ACTIVE_RULE'),
      input.claimedAmountSen ?? 0, nowInstant(), nowInstant());

    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: claimItemId, applicationId: input.applicationId,
      eventType: 'ASSESS_ELIGIBILITY', toStatus: input.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
      occurredAt, actorUserId: input.actor.userId, actorRole: input.actor.role,
      payload: { eligibilityRuleVersion: rule.eligibilityRuleVersion },
    });

    return { claimItemId, eligibilityStatus: input.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE' };
  });
}

/**
 * A doctor submits one or more eligible items as a claim.
 *
 * A claim may hold several items; each keeps its own report, doctor, amount,
 * eligibility rule and status, and the money is always aggregated over items.
 */
export function submitClaim(
  handle: Handle, input: {
    claimItemIds: readonly string[]; actor: Principal; formReference: string;
    amountsSen: Readonly<Record<string, number>>; occurredAt?: Instant;
  },
): { claimId: string; items: string[] } {
  return handle.transaction(() => {
    const occurredAt = input.occurredAt ?? nowInstant();
    if (input.claimItemIds.length === 0) {
      throw unprocessable('NO_ITEMS', 'A claim must contain at least one eligible item.');
    }
    if (!input.actor.doctorId) throw forbidden('Only a doctor can submit a claim.');

    const items = input.claimItemIds.map((id) => loadClaimItem(handle, id));
    for (const item of items) {
      if (item.doctor_id !== input.actor.doctorId) {
        throw forbidden('A doctor may only submit claims for their own reports.');
      }
      if (item.eligibility_status !== 'ELIGIBLE') {
        throw conflict('NOT_ELIGIBLE', `${item.claim_item_id} is not an eligible item.`);
      }
      if (item.status !== 'NOT_SUBMITTED' && item.status !== 'RETURNED') {
        throw conflict('ALREADY_SUBMITTED',
          `${item.claim_item_id} is already at ${item.status}.`, { status: item.status });
      }
      // Re-check the duplicate guard on resubmission: a returned item may have been
      // superseded by another active item in the meantime.
      const rival = handle.get<{ claim_item_id: string }>(
        `SELECT claim_item_id FROM claim_items
         WHERE application_id = ? AND task_id = ? AND eligibility_rule_version = ?
           AND claim_item_id <> ? AND eligibility_status = 'ELIGIBLE'
           AND status NOT IN ('REJECTED','WITHDRAWN','REVERSED','NOT_SUBMITTED')`,
        item.application_id, item.task_id, item.eligibility_rule_version, item.claim_item_id);
      if (rival) {
        throw conflict('DUPLICATE_CLAIM_ITEM',
          'Another active claim item already covers this report.',
          { existingClaimItemId: rival.claim_item_id });
      }
    }

    const claimId = newId('clm');
    handle.run(
      `INSERT INTO claims (claim_id, doctor_id, submitted_by, submitted_at, created_at, is_synthetic)
       VALUES (?,?,?,?,?,0)`,
      claimId, input.actor.doctorId, input.actor.userId, occurredAt, nowInstant());

    for (const item of items) {
      const amount = input.amountsSen[item.claim_item_id];
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        throw unprocessable('INVALID_AMOUNT',
          `A positive whole-sen amount is required for ${item.claim_item_id}. `
          + 'The system does not compute remuneration: no rate table was supplied.');
      }
      handle.run(
        `UPDATE claim_items SET claim_id = ?, status = 'SUBMITTED', submitted_at = ?,
           submitted_by = ?, form_attachment_reference = ?, claimed_amount_sen = ?,
           return_reason = NULL, updated_at = ? WHERE claim_item_id = ?`,
        claimId, occurredAt, input.actor.userId, input.formReference, amount,
        nowInstant(), item.claim_item_id);
      appendStatusEvent(handle, {
        entityType: 'CLAIM_ITEM', entityId: item.claim_item_id, applicationId: item.application_id,
        eventType: 'SUBMIT_CLAIM', fromStatus: item.status, toStatus: 'SUBMITTED',
        occurredAt, actorUserId: input.actor.userId, actorRole: input.actor.role,
        payload: { claimId, claimedAmountSen: amount },
      });
    }

    return { claimId, items: items.map((i) => i.claim_item_id) };
  });
}

export type FinanceAction = 'FINANCE_RECEIVE' | 'VERIFY_CLAIM' | 'RETURN_CLAIM' | 'REJECT_CLAIM'
  | 'APPROVE_CLAIM' | 'INSTRUCT_PAYMENT' | 'WITHDRAW_CLAIM';

const FINANCE_TRANSITIONS: Record<FinanceAction, { from: readonly ClaimStatus[]; to: ClaimStatus }> = {
  FINANCE_RECEIVE: { from: ['SUBMITTED'], to: 'UNDER_VERIFICATION' },
  VERIFY_CLAIM: { from: ['UNDER_VERIFICATION'], to: 'VERIFIED' },
  RETURN_CLAIM: { from: ['UNDER_VERIFICATION'], to: 'RETURNED' },
  REJECT_CLAIM: { from: ['UNDER_VERIFICATION', 'VERIFIED'], to: 'REJECTED' },
  APPROVE_CLAIM: { from: ['VERIFIED'], to: 'APPROVED' },
  INSTRUCT_PAYMENT: { from: ['APPROVED', 'PAYMENT_FAILED'], to: 'PAYMENT_PROCESSING' },
  WITHDRAW_CLAIM: { from: ['NOT_SUBMITTED', 'SUBMITTED', 'RETURNED'], to: 'WITHDRAWN' },
};

export function applyFinanceAction(
  handle: Handle, input: {
    claimItemId: string; action: FinanceAction; actor: Principal;
    approvedAmountSen?: number; returnReason?: string; voucherReference?: string;
    occurredAt?: Instant; idempotencyKey?: string;
  },
): { claimItemId: string; status: ClaimStatus } {
  return handle.transaction(() => {
    const occurredAt = input.occurredAt ?? nowInstant();
    const item = loadClaimItem(handle, input.claimItemId);
    const rule = FINANCE_TRANSITIONS[input.action];
    if (!rule.from.includes(item.status)) {
      throw conflict('INVALID_CLAIM_TRANSITION',
        `${input.action} is not permitted from ${item.status}.`,
        { from: item.status, permittedFrom: rule.from });
    }

    switch (input.action) {
      case 'FINANCE_RECEIVE':
        handle.run('UPDATE claim_items SET finance_received_at = ?, updated_at = ? WHERE claim_item_id = ?',
          occurredAt, nowInstant(), item.claim_item_id);
        break;
      case 'VERIFY_CLAIM':
        handle.run(
          `UPDATE claim_items SET verified_at = ?, verified_by = ?, updated_at = ?
           WHERE claim_item_id = ?`, occurredAt, input.actor.userId, nowInstant(), item.claim_item_id);
        break;
      case 'RETURN_CLAIM':
        if (!input.returnReason) {
          throw unprocessable('MISSING_RETURN_REASON', 'A returned claim must carry a reason.');
        }
        handle.run(
          `UPDATE claim_items SET return_reason = ?, claim_id = NULL, updated_at = ?
           WHERE claim_item_id = ?`, input.returnReason, nowInstant(), item.claim_item_id);
        break;
      case 'REJECT_CLAIM':
        if (!input.returnReason) {
          throw unprocessable('MISSING_REJECTION_REASON', 'A rejected claim must carry a reason.');
        }
        handle.run('UPDATE claim_items SET return_reason = ?, updated_at = ? WHERE claim_item_id = ?',
          input.returnReason, nowInstant(), item.claim_item_id);
        break;
      case 'APPROVE_CLAIM': {
        // Separation of duty, enforced here as well as in the permission layer and
        // as a table constraint: three independent places, because this is the one
        // control that stops a single account from paying itself.
        if (item.submitted_by && item.submitted_by === input.actor.userId) {
          throw forbidden('A claim cannot be approved by the person who submitted it.');
        }
        const amount = input.approvedAmountSen;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
          throw unprocessable('INVALID_APPROVED_AMOUNT',
            'A whole-sen approved amount is required.');
        }
        if (amount > item.claimed_amount_sen) {
          throw unprocessable('APPROVED_EXCEEDS_CLAIMED',
            'The approved amount cannot exceed the amount claimed.');
        }
        handle.run(
          `UPDATE claim_items SET approved_at = ?, approved_by = ?, approved_amount_sen = ?,
             updated_at = ? WHERE claim_item_id = ?`,
          occurredAt, input.actor.userId, amount, nowInstant(), item.claim_item_id);
        break;
      }
      case 'INSTRUCT_PAYMENT': {
        // A payment instruction is recorded, not executed. Nothing here contacts a
        // bank, and the instruction alone is not evidence of settlement.
        handle.run(
          `INSERT INTO payment_allocations (payment_id, claim_item_id, voucher_reference,
             instructed_at, amount_paid_sen, payment_status, is_synthetic, source_system, created_at)
           VALUES (?,?,?,?,0,'INSTRUCTED',0,'MANUAL',?)`,
          newId('pay'), item.claim_item_id, input.voucherReference ?? null, occurredAt, nowInstant());
        handle.run('UPDATE claim_items SET instructed_at = ?, updated_at = ? WHERE claim_item_id = ?',
          occurredAt, nowInstant(), item.claim_item_id);
        break;
      }
      case 'WITHDRAW_CLAIM':
        if (input.actor.role === 'doctor' && item.doctor_id !== input.actor.doctorId) {
          throw forbidden('A doctor may only withdraw their own claim.');
        }
        break;
      default: {
        const exhaustive: never = input.action;
        throw new Error(`unhandled finance action: ${String(exhaustive)}`);
      }
    }

    handle.run('UPDATE claim_items SET status = ?, updated_at = ? WHERE claim_item_id = ?',
      rule.to, nowInstant(), item.claim_item_id);
    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: item.claim_item_id, applicationId: item.application_id,
      eventType: input.action, fromStatus: item.status, toStatus: rule.to, occurredAt,
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      reasonCode: input.returnReason ?? null, idempotencyKey: input.idempotencyKey ?? null,
      payload: input.approvedAmountSen !== undefined
        ? { approvedAmountSen: input.approvedAmountSen } : undefined,
    });

    return { claimItemId: item.claim_item_id, status: rule.to };
  });
}

export interface ReconcileInput {
  claimItemId: string;
  actor: Principal;
  paymentReference: string;
  amountPaidSen: number;
  paidAt: Instant;
  voucherReference?: string;
  occurredAt?: Instant;
  idempotencyKey?: string;
}

/**
 * Records actual, reconciled payment.
 *
 * All four pieces of evidence are mandatory. The resulting status is derived from
 * the **net settled amount against the approved amount**, so a part payment lands
 * on PARTIALLY_PAID and only a fully settled item reads PAID.
 */
export function reconcilePayment(
  handle: Handle, input: ReconcileInput,
): { claimItemId: string; status: ClaimStatus; netPaidSen: number; approvedAmountSen: number } {
  return handle.transaction(() => {
    const item = loadClaimItem(handle, input.claimItemId);
    if (item.status !== 'PAYMENT_PROCESSING' && item.status !== 'PARTIALLY_PAID'
      && item.status !== 'PAYMENT_FAILED') {
      throw conflict('NOT_AWAITING_PAYMENT',
        `A payment can only be reconciled against an instructed item; this one is ${item.status}.`);
    }
    if (item.approved_amount_sen === null) {
      throw conflict('NOT_APPROVED', 'A payment cannot be reconciled before approval.');
    }
    if (!input.paymentReference.trim()) {
      throw unprocessable('MISSING_PAYMENT_REFERENCE',
        'A payment reference is required: approval alone is not proof of settlement.');
    }
    if (!Number.isInteger(input.amountPaidSen) || input.amountPaidSen <= 0) {
      throw unprocessable('INVALID_PAID_AMOUNT', 'A positive whole-sen paid amount is required.');
    }
    if (Number.isNaN(Date.parse(input.paidAt))) {
      throw unprocessable('INVALID_PAID_DATE', 'A payment date is required.');
    }

    const now = nowInstant();
    handle.run(
      `INSERT INTO payment_allocations (payment_id, claim_item_id, payment_reference,
         voucher_reference, instructed_at, paid_at, reconciled_at, reconciled_by,
         amount_paid_sen, payment_status, is_synthetic, source_system, created_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'RECONCILED',0,'MANUAL',?)`,
      newId('pay'), item.claim_item_id, input.paymentReference.trim(),
      input.voucherReference ?? null, item.instructed_at ?? null, input.paidAt, now,
      input.actor.userId, input.amountPaidSen, now);

    const net = netSettled(handle, item.claim_item_id);
    const status: ClaimStatus = net >= item.approved_amount_sen ? 'PAID' : 'PARTIALLY_PAID';
    handle.run('UPDATE claim_items SET status = ?, updated_at = ? WHERE claim_item_id = ?',
      status, now, item.claim_item_id);
    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: item.claim_item_id, applicationId: item.application_id,
      eventType: 'RECONCILE_PAYMENT', fromStatus: item.status, toStatus: status,
      occurredAt: input.occurredAt ?? input.paidAt, actorUserId: input.actor.userId,
      actorRole: input.actor.role, idempotencyKey: input.idempotencyKey ?? null,
      payload: { amountPaidSen: input.amountPaidSen, netSettledSen: net,
        approvedAmountSen: item.approved_amount_sen },
    });
    return {
      claimItemId: item.claim_item_id, status, netPaidSen: net,
      approvedAmountSen: item.approved_amount_sen,
    };
  });
}

export function recordPaymentFailure(
  handle: Handle, input: { claimItemId: string; actor: Principal; reason: string; occurredAt?: Instant },
): { claimItemId: string; status: ClaimStatus } {
  return handle.transaction(() => {
    const item = loadClaimItem(handle, input.claimItemId);
    if (item.status !== 'PAYMENT_PROCESSING') {
      throw conflict('NOT_AWAITING_PAYMENT', `Item is ${item.status}, not awaiting payment.`);
    }
    const now = nowInstant();
    handle.run(
      `INSERT INTO payment_allocations (payment_id, claim_item_id, instructed_at, amount_paid_sen,
         payment_status, failure_reason, is_synthetic, source_system, created_at)
       VALUES (?,?,?,0,'FAILED',?,0,'MANUAL',?)`,
      newId('pay'), item.claim_item_id, item.instructed_at ?? null, input.reason, now);
    handle.run("UPDATE claim_items SET status = 'PAYMENT_FAILED', updated_at = ? WHERE claim_item_id = ?",
      now, item.claim_item_id);
    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: item.claim_item_id, applicationId: item.application_id,
      eventType: 'RECORD_PAYMENT_FAILURE', fromStatus: item.status, toStatus: 'PAYMENT_FAILED',
      occurredAt: input.occurredAt ?? now, actorUserId: input.actor.userId,
      actorRole: input.actor.role, reasonCode: input.reason,
    });
    return { claimItemId: item.claim_item_id, status: 'PAYMENT_FAILED' };
  });
}

export function recordReversal(
  handle: Handle, input: {
    claimItemId: string; actor: Principal; reversalReference: string;
    reversesPaymentId: string; occurredAt?: Instant;
  },
): { claimItemId: string; status: ClaimStatus; netPaidSen: number } {
  return handle.transaction(() => {
    const item = loadClaimItem(handle, input.claimItemId);
    if (item.status !== 'PAID' && item.status !== 'PARTIALLY_PAID') {
      throw conflict('NOT_SETTLED', `Only a settled item can be reversed; this one is ${item.status}.`);
    }
    const original = handle.get<{ amount_paid_sen: number; payment_status: string }>(
      'SELECT amount_paid_sen, payment_status FROM payment_allocations WHERE payment_id = ? AND claim_item_id = ?',
      input.reversesPaymentId, item.claim_item_id);
    if (!original || original.payment_status !== 'RECONCILED') {
      throw unprocessable('UNKNOWN_PAYMENT', 'No reconciled payment with that id on this item.');
    }

    const now = nowInstant();
    // A reversal is a negative allocation, not an edit of the original row: the
    // history stays intact and the net position stays derivable.
    handle.run(
      `INSERT INTO payment_allocations (payment_id, claim_item_id, payment_reference, paid_at,
         reconciled_at, reconciled_by, amount_paid_sen, payment_status, reversal_reference,
         reverses_payment_id, is_synthetic, source_system, created_at)
       VALUES (?,?,?,?,?,?,?, 'REVERSED',?,?,0,'MANUAL',?)`,
      newId('pay'), item.claim_item_id, `REV-${input.reversalReference}`, now, now,
      input.actor.userId, -original.amount_paid_sen, input.reversalReference,
      input.reversesPaymentId, now);

    const net = netSettled(handle, item.claim_item_id);
    const status: ClaimStatus = net <= 0
      ? 'REVERSED'
      : (item.approved_amount_sen !== null && net >= item.approved_amount_sen ? 'PAID' : 'PARTIALLY_PAID');
    handle.run('UPDATE claim_items SET status = ?, updated_at = ? WHERE claim_item_id = ?',
      status, now, item.claim_item_id);
    appendStatusEvent(handle, {
      entityType: 'CLAIM_ITEM', entityId: item.claim_item_id, applicationId: item.application_id,
      eventType: 'RECORD_REVERSAL', fromStatus: item.status, toStatus: status,
      occurredAt: input.occurredAt ?? now, actorUserId: input.actor.userId,
      actorRole: input.actor.role, payload: { reversalReference: input.reversalReference, netSettledSen: net },
    });
    return { claimItemId: item.claim_item_id, status, netPaidSen: net };
  });
}

/**
 * Net settled amount for an item: reconciled payments less reversals.
 *
 * Failed and instructed allocations contribute nothing, because neither is
 * evidence that money moved.
 */
export function netSettled(handle: Handle, claimItemId: string): number {
  const row = handle.get<{ total: number | null }>(
    `SELECT SUM(amount_paid_sen) AS total FROM payment_allocations
     WHERE claim_item_id = ? AND payment_status IN ('RECONCILED','REVERSED')`, claimItemId);
  return row?.total ?? 0;
}

/** True when the item has complete evidence of actual payment. */
export function hasSettlementEvidence(handle: Handle, claimItemId: string): boolean {
  const row = handle.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM payment_allocations
     WHERE claim_item_id = ? AND payment_status = 'RECONCILED'
       AND payment_reference IS NOT NULL AND paid_at IS NOT NULL
       AND reconciled_at IS NOT NULL AND amount_paid_sen > 0`, claimItemId);
  return (row?.n ?? 0) > 0;
}

/** Statuses the interface renders as "Awaiting payment confirmation". */
export const AWAITING_CONFIRMATION_LABEL = 'Awaiting payment confirmation';

export function isSlotHeld(status: ClaimStatus): boolean {
  return CLAIM_SLOT_HELD_BY.includes(status);
}
