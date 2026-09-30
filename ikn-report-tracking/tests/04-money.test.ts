/**
 * Acceptance checks 5 and 6:
 *   - report completion does not imply collection, claim eligibility or payment, and
 *     release to the applicant is independent of doctor reimbursement;
 *   - duplicate claim items are blocked; partial, failed and reversed payments
 *     reconcile correctly; and "Paid" requires actual payment evidence.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent } from '../server/services/workflow.ts';
import { applyFinanceAction, assessEligibility, hasSettlementEvidence, netSettled,
  recordPaymentFailure, recordReversal, reconcilePayment, submitClaim } from '../server/services/claims.ts';
import { applyFeeAction } from '../server/services/fees.ts';
import { createDoctor, createFixture, principalFor, registerApplication, type Fixture } from './harness.ts';
import type { Principal } from '../server/auth/session.ts';
import type { Handle } from '../server/db/database.ts';

function completeReport(handle: Handle, records: Principal, doctorId: string,
  doctorUsername: string): string {
  const { applicationId } = registerApplication(handle, { departmentId: 'DEPT-RTO' });
  const doctor = principalFor(handle, doctorUsername);
  applyEvent(handle, {
    applicationId, event: 'MARK_COMPLETE', actor: records,
    payload: { completeAt: new Date().toISOString() },
  });
  applyEvent(handle, { applicationId, event: 'ASSIGN', actor: records, payload: { doctorId } });
  applyEvent(handle, { applicationId, event: 'ACKNOWLEDGE', actor: doctor });
  applyEvent(handle, { applicationId, event: 'SUBMIT_SIGNED', actor: doctor });
  applyEvent(handle, { applicationId, event: 'BEGIN_RECORDS_CHECK', actor: records });
  applyEvent(handle, { applicationId, event: 'ACCEPT_COMPLETION', actor: records });
  return applicationId;
}

describe('completion, release and reimbursement are independent', () => {
  let fixture: Fixture;
  let records: Principal;

  before(() => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
    records = principalFor(fixture.handle, 'records1');
  });
  after(() => fixture.close());

  it('creates no claim entitlement when a report is completed', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    const items = fixture.handle.all<{ claim_item_id: string }>(
      'SELECT claim_item_id FROM claim_items WHERE application_id = ?', applicationId);
    assert.equal(items.length, 0,
      'completing a report must not, by itself, create a payable entitlement');
  });

  it('marks a completed report ready without marking it collected', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    const row = fixture.handle.get<{ internal_status: string; report_completed_at: string | null;
      ready_at: string | null; collection_or_delivery_at: string | null }>(
      `SELECT a.internal_status, r.report_completed_at, r.ready_at, r.collection_or_delivery_at
       FROM applications a JOIN releases r ON r.application_id = a.application_id
       WHERE a.application_id = ?`, applicationId)!;
    assert.equal(row.internal_status, 'READY_FOR_RELEASE');
    assert.ok(row.report_completed_at, 'completion is recorded');
    assert.equal(row.collection_or_delivery_at, null,
      'completion is not collection; the two are measured separately');
  });

  it('releases the report to the applicant while the doctor claim is unpaid', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    const doctor = principalFor(fixture.handle, 't-d1');
    const { claimItemId } = assessEligibility(fixture.handle,
      { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 });
    submitClaim(fixture.handle, {
      claimItemIds: [claimItemId], actor: doctor, formReference: 'F-1',
      amountsSen: { [claimItemId]: 6000 },
    });

    // The claim is nowhere near settled, and the report is released regardless.
    applyEvent(fixture.handle, {
      applicationId, event: 'RECORD_COLLECTION', actor: records,
      payload: { receiptReference: 'R-1' },
    });
    const status = fixture.handle.get<{ internal_status: string }>(
      'SELECT internal_status FROM applications WHERE application_id = ?', applicationId)!;
    assert.equal(status.internal_status, 'COLLECTED_OR_DELIVERED');
    const claim = fixture.handle.get<{ status: string }>(
      'SELECT status FROM claim_items WHERE claim_item_id = ?', claimItemId)!;
    assert.equal(claim.status, 'SUBMITTED', 'the claim is still outstanding, as intended');
  });

  it('releases the report with the patient fee unpaid, because release is not fee-gated', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    const fee = fixture.handle.get<{ fee_status: string }>(
      'SELECT fee_status FROM patient_fees WHERE application_id = ?', applicationId)!;
    assert.equal(fee.fee_status, 'AWAITING_PAYMENT');

    applyEvent(fixture.handle, {
      applicationId, event: 'RECORD_COLLECTION', actor: records,
      payload: { receiptReference: 'R-2' },
    });
    assert.equal(fixture.handle.get<{ internal_status: string }>(
      'SELECT internal_status FROM applications WHERE application_id = ?',
      applicationId)!.internal_status, 'COLLECTED_OR_DELIVERED',
    'the fee gate ships off, because no policy permitting a fee-gated release was supplied');
  });

  it('applies the fee gate only when the active fee rule turns it on', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    fixture.handle.run('UPDATE fee_rules SET release_requires_settled = 1');
    try {
      assert.throws(
        () => applyEvent(fixture.handle, {
          applicationId, event: 'RECORD_COLLECTION', actor: records,
          payload: { receiptReference: 'R-3' },
        }),
        (err: unknown) => (err as { code?: string }).code === 'FEE_OUTSTANDING');

      // Settling the fee clears the gate. Nothing about a claim is ever consulted.
      applyFeeAction(fixture.handle, {
        applicationId, action: 'RECORD_PAYMENT', actor: records,
        receiptReference: 'RCPT-1', amountReceivedSen: 10000,
      });
      applyEvent(fixture.handle, {
        applicationId, event: 'RECORD_COLLECTION', actor: records,
        payload: { receiptReference: 'R-3' },
      });
      assert.equal(fixture.handle.get<{ internal_status: string }>(
        'SELECT internal_status FROM applications WHERE application_id = ?',
        applicationId)!.internal_status, 'COLLECTED_OR_DELIVERED');
    } finally {
      fixture.handle.run('UPDATE fee_rules SET release_requires_settled = 0');
    }
  });

  it('refuses a fee marked paid without a receipt, an amount and a verification', () => {
    const applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    assert.throws(
      () => applyFeeAction(fixture.handle, {
        applicationId, action: 'RECORD_PAYMENT', actor: records, amountReceivedSen: 10000,
      }),
      (err: unknown) => (err as { code?: string }).code === 'MISSING_RECEIPT');
    assert.throws(
      () => applyFeeAction(fixture.handle, {
        applicationId, action: 'RECORD_PAYMENT', actor: records, receiptReference: 'X',
        amountReceivedSen: 100,
      }),
      (err: unknown) => (err as { code?: string }).code === 'AMOUNT_BELOW_DUE');
  });
});

describe('claim duplication and payment evidence', () => {
  let fixture: Fixture;
  let records: Principal;
  let doctor: Principal;
  let finance1: Principal;
  let finance2: Principal;
  let applicationId: string;
  let claimItemId: string;

  before(() => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
  });
  after(() => fixture.close());

  beforeEach(() => {
    records = principalFor(fixture.handle, 'records1');
    doctor = principalFor(fixture.handle, 't-d1');
    finance1 = principalFor(fixture.handle, 'finance1');
    finance2 = principalFor(fixture.handle, 'finance2');
    applicationId = completeReport(fixture.handle, records, 'T-D1', 't-d1');
    ({ claimItemId } = assessEligibility(fixture.handle,
      { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 }));
  });

  const toApproved = () => {
    submitClaim(fixture.handle, {
      claimItemIds: [claimItemId], actor: doctor, formReference: 'F-1',
      amountsSen: { [claimItemId]: 6000 },
    });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'FINANCE_RECEIVE', actor: finance1 });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'VERIFY_CLAIM', actor: finance1 });
    applyFinanceAction(fixture.handle, {
      claimItemId, action: 'APPROVE_CLAIM', actor: finance2, approvedAmountSen: 6000,
    });
    applyFinanceAction(fixture.handle, {
      claimItemId, action: 'INSTRUCT_PAYMENT', actor: finance1, voucherReference: 'V-1',
    });
  };

  it('blocks a second eligible item for the same report', () => {
    assert.throws(
      () => assessEligibility(fixture.handle,
        { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 }),
      (err: unknown) => (err as { code?: string }).code === 'DUPLICATE_CLAIM_ITEM');
  });

  it('blocks a duplicate at the database level too, not only in the service', () => {
    assert.throws(() => fixture.handle.run(
      `INSERT INTO claim_items (claim_item_id, application_id, task_id, doctor_id, department_id,
         eligibility_status, eligibility_rule_version, eligible_at, status, claimed_amount_sen,
         created_at, updated_at)
       SELECT 'sneaky', application_id, task_id, doctor_id, department_id, 'ELIGIBLE',
         eligibility_rule_version, eligible_at, 'NOT_SUBMITTED', 0, created_at, updated_at
       FROM claim_items WHERE claim_item_id = ?`, claimItemId),
    /UNIQUE|constraint/i,
    'the partial unique index is the backstop for a concurrent request or an import');
  });

  it('frees the slot when an item is rejected, so a corrected claim can be raised', () => {
    submitClaim(fixture.handle, {
      claimItemIds: [claimItemId], actor: doctor, formReference: 'F-1',
      amountsSen: { [claimItemId]: 6000 },
    });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'FINANCE_RECEIVE', actor: finance1 });
    applyFinanceAction(fixture.handle, {
      claimItemId, action: 'REJECT_CLAIM', actor: finance1, returnReason: 'DEMO_NOT_ELIGIBLE',
    });
    const second = assessEligibility(fixture.handle,
      { applicationId, eligible: true, actor: records, claimedAmountSen: 6000 });
    assert.ok(second.claimItemId, 'a rejected item releases the slot');
  });

  it('refuses an approval by the person who submitted the claim', () => {
    // A finance officer who also raised the submission cannot approve it.
    fixture.handle.run('UPDATE claim_items SET submitted_by = ? WHERE claim_item_id = ?',
      finance2.userId, claimItemId);
    fixture.handle.run("UPDATE claim_items SET status = 'VERIFIED', submitted_at = ? WHERE claim_item_id = ?",
      new Date().toISOString(), claimItemId);
    assert.throws(
      () => applyFinanceAction(fixture.handle, {
        claimItemId, action: 'APPROVE_CLAIM', actor: finance2, approvedAmountSen: 6000,
      }),
      (err: unknown) => (err as { code?: string }).code === 'FORBIDDEN');
  });

  it('refuses an approved amount above the amount claimed', () => {
    submitClaim(fixture.handle, {
      claimItemIds: [claimItemId], actor: doctor, formReference: 'F-1',
      amountsSen: { [claimItemId]: 6000 },
    });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'FINANCE_RECEIVE', actor: finance1 });
    applyFinanceAction(fixture.handle, { claimItemId, action: 'VERIFY_CLAIM', actor: finance1 });
    assert.throws(
      () => applyFinanceAction(fixture.handle, {
        claimItemId, action: 'APPROVE_CLAIM', actor: finance2, approvedAmountSen: 9900,
      }),
      (err: unknown) => (err as { code?: string }).code === 'APPROVED_EXCEEDS_CLAIMED');
  });

  it('does not reach Paid on approval or on a payment instruction alone', () => {
    toApproved();
    const status = fixture.handle.get<{ status: string }>(
      'SELECT status FROM claim_items WHERE claim_item_id = ?', claimItemId)!.status;
    assert.equal(status, 'PAYMENT_PROCESSING',
      'an approval, a voucher and an instruction are not evidence that money moved');
    assert.equal(hasSettlementEvidence(fixture.handle, claimItemId), false);
    assert.equal(netSettled(fixture.handle, claimItemId), 0);
  });

  it('refuses a reconciliation with no reference, amount or date', () => {
    toApproved();
    for (const broken of [
      { paymentReference: '', amountPaidSen: 6000, paidAt: new Date().toISOString() },
      { paymentReference: 'P-1', amountPaidSen: 0, paidAt: new Date().toISOString() },
      { paymentReference: 'P-1', amountPaidSen: 6000, paidAt: 'not a date' },
    ]) {
      assert.throws(() => reconcilePayment(fixture.handle, {
        claimItemId, actor: finance1, ...broken,
      }), 'a payment without complete evidence must be refused');
    }
  });

  it('settles a part payment as PARTIALLY_PAID and the remainder as PAID', () => {
    toApproved();
    const part = reconcilePayment(fixture.handle, {
      claimItemId, actor: finance1, paymentReference: 'P-A', amountPaidSen: 2000,
      paidAt: '2026-09-01T02:00:00.000Z',
    });
    assert.equal(part.status, 'PARTIALLY_PAID');
    assert.equal(part.netPaidSen, 2000);

    const rest = reconcilePayment(fixture.handle, {
      claimItemId, actor: finance1, paymentReference: 'P-B', amountPaidSen: 4000,
      paidAt: '2026-09-08T02:00:00.000Z',
    });
    assert.equal(rest.status, 'PAID');
    assert.equal(rest.netPaidSen, 6000);
    assert.equal(hasSettlementEvidence(fixture.handle, claimItemId), true);
  });

  it('records a payment failure without pretending anything was paid', () => {
    toApproved();
    const failed = recordPaymentFailure(fixture.handle, {
      claimItemId, actor: finance1, reason: 'BANK_REJECTED_INVALID_ACCOUNT',
    });
    assert.equal(failed.status, 'PAYMENT_FAILED');
    assert.equal(netSettled(fixture.handle, claimItemId), 0,
      'a failed payment contributes nothing to the settled total');
    assert.equal(hasSettlementEvidence(fixture.handle, claimItemId), false);
  });

  it('reverses a settled payment and restores the outstanding balance', () => {
    toApproved();
    reconcilePayment(fixture.handle, {
      claimItemId, actor: finance1, paymentReference: 'P-C', amountPaidSen: 6000,
      paidAt: '2026-09-01T02:00:00.000Z',
    });
    const payment = fixture.handle.get<{ payment_id: string }>(
      `SELECT payment_id FROM payment_allocations
       WHERE claim_item_id = ? AND payment_status = 'RECONCILED'`, claimItemId)!;

    const reversed = recordReversal(fixture.handle, {
      claimItemId, actor: finance1, reversalReference: 'REV-1',
      reversesPaymentId: payment.payment_id,
    });
    assert.equal(reversed.status, 'REVERSED');
    assert.equal(reversed.netPaidSen, 0, 'the reversal nets the settlement back to zero');

    // Both rows survive: history stays intact and the net position stays derivable.
    const rows = fixture.handle.all<{ payment_status: string; amount_paid_sen: number }>(
      'SELECT payment_status, amount_paid_sen FROM payment_allocations WHERE claim_item_id = ?',
      claimItemId);
    assert.equal(rows.filter((r) => r.payment_status === 'RECONCILED').length, 1);
    assert.equal(rows.filter((r) => r.payment_status === 'REVERSED').length, 1);
  });

  it('rejects a reversal of a payment that was never reconciled', () => {
    toApproved();
    const instructed = fixture.handle.get<{ payment_id: string }>(
      `SELECT payment_id FROM payment_allocations
       WHERE claim_item_id = ? AND payment_status = 'INSTRUCTED'`, claimItemId)!;
    assert.throws(
      () => recordReversal(fixture.handle, {
        claimItemId, actor: finance1, reversalReference: 'REV-2',
        reversesPaymentId: instructed.payment_id,
      }),
      (err: unknown) => (err as { code?: string }).code === 'NOT_SETTLED');
  });

  it('never lets a database row claim RECONCILED without complete evidence', () => {
    assert.throws(() => fixture.handle.run(
      `INSERT INTO payment_allocations (payment_id, claim_item_id, amount_paid_sen,
         payment_status, created_at) VALUES ('forged', ?, 6000, 'RECONCILED', ?)`,
      claimItemId, new Date().toISOString()),
    /CHECK|constraint/i,
    'the schema itself refuses a settlement with no reference, date or reconciliation');
  });
});
