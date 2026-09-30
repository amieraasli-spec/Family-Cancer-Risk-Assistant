/**
 * The patient fee workflow.
 *
 * A patient fee is what the applicant pays for a copy of a report. It is **not**
 * doctor remuneration, and the two never meet: nothing in this module reads or
 * writes a claim, and nothing in `services/claims.ts` reads a fee.
 *
 * "Paid" here means the same thing it means for a claim: evidence. A receipt
 * reference, a verified amount and a verification date, or the status does not move.
 */
import type { Handle } from '../db/database.ts';
import { appendStatusEvent } from '../domain/events.ts';
import { nowInstant, type Instant } from '../domain/time.ts';
import { conflict, unprocessable } from '../http/errors.ts';
import type { FeeStatus } from '../../shared/domain.ts';
import type { Principal } from '../auth/session.ts';

export interface FeeRow extends Record<string, unknown> {
  application_id: string;
  amount_due_sen: number;
  amount_received_sen: number;
  receipt_reference: string | null;
  fee_status: FeeStatus;
  refund_amount_sen: number;
  fee_rule_version: string;
}

export function loadFee(handle: Handle, applicationId: string): FeeRow {
  const row = handle.get<FeeRow>('SELECT * FROM patient_fees WHERE application_id = ?', applicationId);
  if (!row) throw unprocessable('NO_FEE_RECORD', 'No fee record for that application.');
  return row;
}

export type FeeAction = 'RECORD_PAYMENT' | 'GRANT_EXEMPTION' | 'RECORD_REFUND' | 'FLAG_EXCEPTION';

const FEE_TRANSITIONS: Record<FeeAction, { from: readonly FeeStatus[]; to: FeeStatus }> = {
  RECORD_PAYMENT: { from: ['AWAITING_PAYMENT'], to: 'PAID' },
  GRANT_EXEMPTION: { from: ['AWAITING_PAYMENT', 'NOT_REQUIRED'], to: 'EXEMPT' },
  RECORD_REFUND: { from: ['PAID'], to: 'REFUNDED' },
  FLAG_EXCEPTION: { from: ['PAID', 'REFUNDED'], to: 'RECONCILIATION_EXCEPTION' },
};

export function applyFeeAction(
  handle: Handle, input: {
    applicationId: string; action: FeeAction; actor: Principal;
    receiptReference?: string; amountReceivedSen?: number; exemptionBasis?: string;
    refundAmountSen?: number; note?: string; occurredAt?: Instant; idempotencyKey?: string;
  },
): { applicationId: string; feeStatus: FeeStatus } {
  return handle.transaction(() => {
    const fee = loadFee(handle, input.applicationId);
    const rule = FEE_TRANSITIONS[input.action];
    if (!rule.from.includes(fee.fee_status)) {
      throw conflict('INVALID_FEE_TRANSITION',
        `${input.action} is not permitted from ${fee.fee_status}.`,
        { from: fee.fee_status, permittedFrom: rule.from });
    }
    const occurredAt = input.occurredAt ?? nowInstant();
    const now = nowInstant();

    switch (input.action) {
      case 'RECORD_PAYMENT': {
        if (!input.receiptReference?.trim()) {
          throw unprocessable('MISSING_RECEIPT',
            'A receipt reference is required before a fee can be recorded as paid.');
        }
        const amount = input.amountReceivedSen;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
          throw unprocessable('INVALID_AMOUNT', 'A positive whole-sen amount is required.');
        }
        // An underpayment is surfaced rather than rounded away.
        if (amount < fee.amount_due_sen) {
          throw unprocessable('AMOUNT_BELOW_DUE',
            `The amount received (${amount} sen) is below the amount due `
            + `(${fee.amount_due_sen} sen). Record the balance or flag an exception.`);
        }
        handle.run(
          `UPDATE patient_fees SET amount_received_sen = ?, receipt_reference = ?, verified_at = ?,
             verified_by = ?, fee_status = 'PAID', updated_at = ? WHERE application_id = ?`,
          amount, input.receiptReference.trim(), occurredAt, input.actor.userId, now,
          input.applicationId);
        break;
      }
      case 'GRANT_EXEMPTION': {
        if (!input.exemptionBasis?.trim()) {
          throw unprocessable('MISSING_EXEMPTION_BASIS',
            'An exemption needs a recorded basis.');
        }
        handle.run(
          `UPDATE patient_fees SET fee_status = 'EXEMPT', exemption_basis = ?, verified_at = ?,
             verified_by = ?, updated_at = ? WHERE application_id = ?`,
          input.exemptionBasis.trim(), occurredAt, input.actor.userId, now, input.applicationId);
        break;
      }
      case 'RECORD_REFUND': {
        const refund = input.refundAmountSen;
        if (typeof refund !== 'number' || !Number.isInteger(refund) || refund <= 0) {
          throw unprocessable('INVALID_REFUND', 'A positive whole-sen refund amount is required.');
        }
        if (refund > fee.amount_received_sen) {
          throw unprocessable('REFUND_EXCEEDS_RECEIPT',
            'A refund cannot exceed the amount received.');
        }
        handle.run(
          `UPDATE patient_fees SET fee_status = 'REFUNDED', refund_amount_sen = ?, updated_at = ?
           WHERE application_id = ?`, refund, now, input.applicationId);
        break;
      }
      case 'FLAG_EXCEPTION':
        handle.run(
          `UPDATE patient_fees SET fee_status = 'RECONCILIATION_EXCEPTION', updated_at = ?
           WHERE application_id = ?`, now, input.applicationId);
        break;
      default: {
        const exhaustive: never = input.action;
        throw new Error(`unhandled fee action: ${String(exhaustive)}`);
      }
    }

    appendStatusEvent(handle, {
      entityType: 'PATIENT_FEE', entityId: input.applicationId,
      applicationId: input.applicationId, eventType: input.action,
      fromStatus: fee.fee_status, toStatus: rule.to, occurredAt, recordedAt: now,
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      note: input.note ?? null, idempotencyKey: input.idempotencyKey ?? null,
      payload: {
        receiptReference: input.receiptReference ?? null,
        amountReceivedSen: input.amountReceivedSen ?? null,
        refundAmountSen: input.refundAmountSen ?? null,
      },
    });
    return { applicationId: input.applicationId, feeStatus: rule.to };
  });
}
