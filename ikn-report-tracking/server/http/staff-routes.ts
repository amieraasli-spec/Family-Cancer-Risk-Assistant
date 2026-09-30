/**
 * The staff and finance API.
 *
 * Every route declares the permission it needs and calls `authorise` before it
 * touches data. The scope that comes back is threaded into the query, so the
 * matrix in `docs/03-permission-matrix.md` is enforced in SQL and not in the view.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db } from '../db/database.ts';
import { authorise, assertInScope, scopePredicate } from '../auth/authorise.ts';
import type { Permission } from '../auth/permissions.ts';
import type { Principal } from '../auth/session.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { formatInternalReportNumber, newPublicTrackingReference, normaliseTrackingReference,
  newId } from '../domain/ids.ts';
import { hashSecret } from '../auth/tokens.ts';
import { activeFeeRule, activeSlaRule, configValue } from '../domain/rules.ts';
import { nowInstant, toBusinessDate } from '../domain/time.ts';
import { ringgitString, senFromDecimalString } from '../domain/money.ts';
import { applyEvent, loadApplication, type WorkflowEvent } from '../services/workflow.ts';
import { applyFinanceAction, assessEligibility, loadClaimItem, netSettled, recordPaymentFailure,
  recordReversal, reconcilePayment, submitClaim, AWAITING_CONFIRMATION_LABEL } from '../services/claims.ts';
import { actionsPanel, departmentPanels, financePanels, forecastPanel, insightsPanels,
  overviewPanels, reportsPanels } from '../analytics/panels.ts';
import { METRIC_DICTIONARY } from '../analytics/dictionary.ts';
import { badRequest, forbidden, unauthorised, unprocessable } from './errors.ts';
import { clientHint, handler, principalOf } from './context.ts';
import { lookup as idempotencyLookup, store as idempotencyStore } from './idempotency.ts';
import { parseFilter } from './filters.ts';
import { PUBLIC_STAGE_OF, REPORT_TYPES } from '../../shared/domain.ts';
import { adminRouter } from './admin-routes.ts';

/** Resolves the caller and the scope for a permission, or throws. */
function gate(req: Request, permission: Permission, resourceId?: string) {
  const principal = principalOf(req);
  return authorise(db(), principal, permission, {
    requestMethod: req.method, requestPath: req.path, clientHint: clientHint(req),
    resourceId: resourceId ?? null,
  });
}

function idempotencyKey(req: Request): string | undefined {
  const header = req.headers['idempotency-key'];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

/**
 * Runs a mutating handler under an idempotency key.
 *
 * A retried request with the same key and body replays the stored response instead
 * of performing the action again, so a double tap on a tablet cannot create two
 * claims or two payments.
 */
function mutate<T>(req: Request, route: string, fn: (principal: Principal) => T):
{ statusCode: number; body: unknown } {
  const key = idempotencyKey(req);
  const replay = idempotencyLookup(db(), key, route, req.body);
  if (replay) return replay;
  const principal = principalOf(req);
  if (!principal) throw unauthorised();
  const body = fn(principal);
  idempotencyStore(db(), key, route, req.body, principal.userId, 200, body);
  return { statusCode: 200, body };
}

export function staffRouter(): Router {
  const router = Router();

  // Nothing on the staff API is cacheable or indexable.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // ------------------------------------------------------------ reference data
  router.get('/reference', handler(async (req, res) => {
    const { principal } = gate(req, 'application.read');
    const handle = db();
    const departments = handle.all<{ department_id: string; name: string }>(
      'SELECT department_id, name FROM departments WHERE active = 1 ORDER BY name');
    res.json({
      departments: principal.role === 'hod'
        ? departments.filter((d) => principal.departmentIds.includes(d.department_id))
        : departments,
      reportTypes: REPORT_TYPES,
      metricDictionary: METRIC_DICTIONARY,
      assumptions: handle.all<{ config_key: string; value_json: string; verification_state: string;
        basis: string | null; owner_to_confirm: string | null }>(
        `SELECT config_key, value_json, verification_state, basis, owner_to_confirm
         FROM config_settings WHERE superseded_at IS NULL ORDER BY config_key`),
      slaRule: activeSlaRule(handle, nowInstant()),
      feeRule: activeFeeRule(handle, nowInstant()),
      minSampleSize: configValue<number>(handle, 'analytics.min_sample_size', 5).value,
    });
  }));

  // -------------------------------------------------------------- applications
  router.get('/applications', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'application.read');
    const { request, page, pageSize } = parseFilter(db(), req, principal, scope);
    res.json(reportsPanels(db(), request, page, pageSize));
  }));

  router.get('/applications/:id', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'application.read', req.params.id);
    const handle = db();
    const id = req.params.id!;
    const row = handle.get<Record<string, unknown>>(
      `SELECT a.*, t.task_id, t.doctor_id, t.assigned_at, t.acknowledged_at,
              t.original_doctor_due_at, t.current_doctor_due_at, t.signed_submitted_at,
              t.accepted_completed_at, t.returned_at, t.return_count, t.reassignment_events,
              t.delay_reason_code,
              r.report_completed_at, r.ready_at, r.notified_at, r.collection_or_delivery_at,
              r.release_method, r.receipt_of_delivery_reference,
              f.fee_status, f.amount_due_sen, f.amount_received_sen, f.receipt_reference,
              f.exemption_basis
       FROM applications a
       LEFT JOIN doctor_tasks t ON t.application_id = a.application_id AND t.active = 1
       LEFT JOIN releases r ON r.application_id = a.application_id
       LEFT JOIN patient_fees f ON f.application_id = a.application_id
       WHERE a.application_id = ?`, id);
    if (!row) throw unprocessable('UNKNOWN_APPLICATION', 'No such application.');

    assertInScope(handle, scope, principal, 'application.read', {
      departmentId: row.department_id as string, doctorId: row.doctor_id as string | null,
    }, { requestPath: req.path, resourceId: id });

    // A doctor sees the workflow metadata for their own task and nothing financial.
    const financialVisible = principal.role !== 'doctor';
    const history = handle.all<Record<string, unknown>>(
      `SELECT event_type, from_status, to_status, occurred_at, recorded_at, actor_role,
              reason_code, note
       FROM status_events WHERE application_id = ? AND entity_type IN ('APPLICATION','DOCTOR_TASK')
       ORDER BY occurred_at, sequence_no`, id);
    const delays = handle.all<Record<string, unknown>>(
      'SELECT stage, attributed_to, reason_code, started_at, ended_at FROM delay_events WHERE application_id = ?',
      id);
    const extensions = handle.all<Record<string, unknown>>(
      `SELECT original_due_at, revised_due_at, reason, approved_by, approved_at
       FROM deadline_extensions WHERE application_id = ? ORDER BY approved_at`, id);

    const { fee_status, amount_due_sen, amount_received_sen, receipt_reference,
      exemption_basis, ...rest } = row;

    res.json({
      application: rest,
      publicStage: PUBLIC_STAGE_OF[row.internal_status as keyof typeof PUBLIC_STAGE_OF],
      fee: financialVisible
        ? {
          status: fee_status, amountDueRm: ringgitString((amount_due_sen as number) ?? 0),
          amountReceivedRm: ringgitString((amount_received_sen as number) ?? 0),
          receiptReference: receipt_reference, exemptionBasis: exemption_basis,
        }
        : null,
      feeVisibilityNotice: financialVisible ? null
        : 'Patient fees are not shown to doctors. A patient fee is not doctor remuneration.',
      history,
      delays,
      extensions,
      releaseIndependenceNotice: 'Release to the applicant is not conditional on any doctor '
        + 'claim or reimbursement.',
    });
  }));

  const registerSchema = z.object({
    applicantRole: z.enum(['PATIENT', 'GUARDIAN', 'AUTHORISED_REPRESENTATIVE']),
    protectedPatientReference: z.string().min(1).max(80),
    verifiedContactReference: z.string().min(1).max(120).optional(),
    reportType: z.string().min(1).max(120),
    requestPurpose: z.string().min(1).max(120),
    departmentId: z.string().min(1).max(40),
    receivedAt: z.string().datetime().optional(),
    priorityReason: z.string().max(200).optional(),
  });

  router.post('/applications', handler(async (req, res) => {
    gate(req, 'application.register');
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('INVALID_REQUEST', 'Registration details are incomplete.',
        parsed.error.flatten().fieldErrors);
    }
    const out = mutate(req, 'POST /applications', (principal) => {
      const handle = db();
      return handle.transaction(() => {
        const now = nowInstant();
        const receivedAt = parsed.data.receivedAt ?? now;
        if (receivedAt > now) {
          throw unprocessable('FUTURE_RECEIPT', 'An application cannot be received in the future.');
        }
        const sla = activeSlaRule(handle, receivedAt);
        const fee = activeFeeRule(handle, receivedAt);
        const year = Number(toBusinessDate(receivedAt).slice(0, 4));
        const sequence = (handle.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM applications')?.n ?? 0) + 1;
        const applicationId = newId('app');
        const reference = newPublicTrackingReference();

        handle.run(
          `INSERT INTO applications (application_id, internal_report_number, applicant_role,
             protected_patient_reference, verified_contact_reference, report_type, request_purpose,
             department_id, received_at, sla_rule_version, fee_rule_version, internal_status,
             public_status, next_action_owner, priority_reason, responsible_officer_id,
             last_public_update_at, is_synthetic, source_system, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?, 'RECEIVED','PERMOHONAN_DITERIMA','RECORDS',?,?,?,0,'MANUAL',?,?)`,
          applicationId, formatInternalReportNumber(year, sequence), parsed.data.applicantRole,
          parsed.data.protectedPatientReference, parsed.data.verifiedContactReference ?? null,
          parsed.data.reportType, parsed.data.requestPurpose, parsed.data.departmentId,
          receivedAt, sla.slaRuleVersion, fee.feeRuleVersion,
          parsed.data.priorityReason ?? null, principal.userId, receivedAt, now, now);

        // The public reference is a credential: only its HMAC is stored, and the
        // plaintext is returned exactly once, for printing on the receipt.
        handle.run(
          'INSERT INTO public_tracking_tokens (token_hash, application_id, issued_at) VALUES (?,?,?)',
          hashSecret(normaliseTrackingReference(reference), 'tracking'), applicationId, now);

        const amountSen = fee.amountsSen[parsed.data.reportType] ?? 0;
        handle.run(
          `INSERT INTO patient_fees (application_id, amount_due_sen, amount_received_sen, currency,
             fee_status, fee_rule_version, created_at, updated_at)
           VALUES (?,?,0,?,?,?,?,?)`,
          applicationId, amountSen, fee.currency,
          amountSen > 0 ? 'AWAITING_PAYMENT' : 'NOT_REQUIRED', fee.feeRuleVersion, now, now);

        return {
          applicationId,
          internalReportNumber: formatInternalReportNumber(year, sequence),
          publicTrackingReference: reference,
          referenceNotice: 'Print this reference on the applicant’s receipt. It is shown once '
            + 'and is stored only as a hash; it can be revoked and replaced but not recovered.',
          feeDueRm: ringgitString(amountSen),
        };
      });
    });
    res.status(out.statusCode).json(out.body);
  }));

  // --------------------------------------------------------- workflow events
  const eventPermission: Record<WorkflowEvent, Permission> = {
    MARK_INCOMPLETE: 'application.completeness.set',
    MARK_COMPLETE: 'application.completeness.set',
    ASSIGN: 'application.assign',
    REASSIGN: 'application.reassign',
    ACKNOWLEDGE: 'task.acknowledge',
    START_PREPARATION: 'task.progress.update',
    SUBMIT_SIGNED: 'task.submit.signed',
    BEGIN_RECORDS_CHECK: 'task.completion.accept',
    RETURN_FOR_CORRECTION: 'task.return',
    ACCEPT_COMPLETION: 'task.completion.accept',
    NOTIFY_APPLICANT: 'release.authorise',
    RECORD_COLLECTION: 'release.record.collection',
    CANCEL: 'application.cancel',
    REOPEN: 'application.reopen',
    GRANT_EXTENSION: 'application.extension.grant',
  };

  const eventSchema = z.object({
    event: z.enum(Object.keys(eventPermission) as [WorkflowEvent, ...WorkflowEvent[]]),
    occurredAt: z.string().datetime().optional(),
    payload: z.record(z.unknown()).optional(),
  });

  router.post('/applications/:id/events', handler(async (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('INVALID_REQUEST', 'A recognised workflow event is required.',
        parsed.error.flatten().fieldErrors);
    }
    const id = req.params.id!;
    const permission = eventPermission[parsed.data.event];
    const { principal, scope } = gate(req, permission, id);

    const handle = db();
    const app = loadApplication(handle, id);
    const task = handle.get<{ doctor_id: string; department_id: string }>(
      'SELECT doctor_id, department_id FROM doctor_tasks WHERE application_id = ? AND active = 1', id);
    assertInScope(handle, scope, principal, permission, {
      departmentId: app.department_id, doctorId: task?.doctor_id ?? null,
    }, { requestPath: req.path, resourceId: id });

    const out = mutate(req, `POST /applications/:id/events:${parsed.data.event}`, (p) => applyEvent(handle, {
      applicationId: id, event: parsed.data.event, actor: p,
      ...(parsed.data.occurredAt ? { occurredAt: parsed.data.occurredAt } : {}),
      ...(idempotencyKey(req) ? { idempotencyKey: idempotencyKey(req)! } : {}),
      ...(parsed.data.payload ? { payload: parsed.data.payload } : {}),
    }));
    res.status(out.statusCode).json(out.body);
  }));

  // ------------------------------------------------------------------ my work
  router.get('/my-tasks', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'task.read');
    if (principal.role !== 'doctor') {
      throw forbidden('This view is for the assigned doctor.');
    }
    const handle = db();
    const predicate = scopePredicate(scope, principal, { doctor: 't.doctor_id' });
    // A doctor sees their own assignments, with deadlines, and no financial figures
    // and no other doctor's work.
    const rows = handle.all<Record<string, unknown>>(
      `SELECT t.task_id, t.application_id, a.report_type, a.department_id,
              t.assigned_at, t.acknowledged_at, t.original_doctor_due_at, t.current_doctor_due_at,
              t.signed_submitted_at, t.accepted_completed_at, t.returned_at, t.return_count,
              t.delay_reason_code, a.internal_status, a.original_service_due_at
       FROM doctor_tasks t JOIN applications a ON a.application_id = t.application_id
       WHERE t.active = 1 AND a.internal_status NOT IN ('CANCELLED','COLLECTED_OR_DELIVERED')
         AND ${predicate.sql}
       ORDER BY t.current_doctor_due_at`, ...predicate.params);
    res.json({
      tasks: rows,
      notice: 'Your own assignments only. Patient fees, other doctors’ work and hospital '
        + 'performance figures are not available to this role.',
    });
  }));

  router.get('/my-claims', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'claim.read');
    if (principal.role !== 'doctor') throw forbidden('This view is for the claiming doctor.');
    const handle = db();
    const predicate = scopePredicate(scope, principal, { doctor: 'ci.doctor_id' });
    const rows = handle.all<Record<string, unknown>>(
      `SELECT ci.claim_item_id, ci.application_id, ci.eligibility_status, ci.eligible_at,
              ci.status, ci.claimed_amount_sen, ci.approved_amount_sen, ci.submitted_at,
              ci.approved_at, ci.return_reason
       FROM claim_items ci WHERE ${predicate.sql} ORDER BY ci.eligible_at DESC`, ...predicate.params);
    res.json({
      items: rows.map((r) => ({
        ...r,
        claimedAmountRm: ringgitString((r.claimed_amount_sen as number) ?? 0),
        approvedAmountRm: r.approved_amount_sen === null
          ? null : ringgitString(r.approved_amount_sen as number),
        netPaidRm: ringgitString(netSettled(handle, r.claim_item_id as string)),
        // A settled-looking status is never asserted without evidence.
        paymentDisplay: displayPaymentStatus(handle, r.claim_item_id as string, r.status as string),
      })),
      notice: 'Your own claims and payment status only. Submitting a claim never affects when '
        + 'the patient receives their report.',
    });
  }));

  // -------------------------------------------------------------------- claims
  router.get('/claims', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'claim.read');
    // The finance dashboard aggregates across doctors. A doctor's own items are at
    // /my-claims, which is scoped to them; sending a doctor here would show a
    // department-wide view they hold no permission for.
    if (principal.role === 'doctor') {
      throw forbidden('Doctors see their own claims at /api/staff/my-claims.');
    }
    const { request, page, pageSize } = parseFilter(db(), req, principal, scope);
    res.json(financePanels(db(), request, page, pageSize));
  }));

  const eligibilitySchema = z.object({
    applicationId: z.string().min(1),
    eligible: z.boolean(),
    notEligibleReason: z.string().max(200).optional(),
    claimedAmountRm: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  });

  router.post('/claims/eligibility', handler(async (req, res) => {
    gate(req, 'claim.eligibility.assess');
    const parsed = eligibilitySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'An eligibility decision is required.');
    const out = mutate(req, 'POST /claims/eligibility', (principal) => assessEligibility(db(), {
      applicationId: parsed.data.applicationId, eligible: parsed.data.eligible, actor: principal,
      ...(parsed.data.notEligibleReason ? { notEligibleReason: parsed.data.notEligibleReason } : {}),
      ...(parsed.data.claimedAmountRm
        ? { claimedAmountSen: senFromDecimalString(parsed.data.claimedAmountRm) } : {}),
    }));
    res.status(out.statusCode).json(out.body);
  }));

  const submitSchema = z.object({
    claimItemIds: z.array(z.string().min(1)).min(1).max(50),
    formReference: z.string().min(1).max(120),
    amountsRm: z.record(z.string().regex(/^\d+(\.\d{1,2})?$/)),
  });

  router.post('/claims/submit', handler(async (req, res) => {
    gate(req, 'claim.submit');
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('INVALID_REQUEST', 'Claim items, a form reference and amounts are required.');
    }
    const amountsSen: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.data.amountsRm)) {
      amountsSen[k] = senFromDecimalString(v);
    }
    const out = mutate(req, 'POST /claims/submit', (principal) => submitClaim(db(), {
      claimItemIds: parsed.data.claimItemIds, actor: principal,
      formReference: parsed.data.formReference, amountsSen,
    }));
    res.status(out.statusCode).json(out.body);
  }));

  const financeActionSchema = z.object({
    action: z.enum(['FINANCE_RECEIVE', 'VERIFY_CLAIM', 'RETURN_CLAIM', 'REJECT_CLAIM',
      'APPROVE_CLAIM', 'INSTRUCT_PAYMENT', 'WITHDRAW_CLAIM']),
    approvedAmountRm: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    returnReason: z.string().max(200).optional(),
    voucherReference: z.string().max(120).optional(),
  });

  const FINANCE_PERMISSION = {
    FINANCE_RECEIVE: 'claim.verify', VERIFY_CLAIM: 'claim.verify', RETURN_CLAIM: 'claim.return',
    REJECT_CLAIM: 'claim.return', APPROVE_CLAIM: 'claim.approve',
    INSTRUCT_PAYMENT: 'payment.instruct', WITHDRAW_CLAIM: 'claim.withdraw',
  } as const satisfies Record<string, Permission>;

  router.post('/claims/:id/actions', handler(async (req, res) => {
    const parsed = financeActionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A recognised claim action is required.');
    const id = req.params.id!;
    const permission = FINANCE_PERMISSION[parsed.data.action];
    const { principal, scope } = gate(req, permission, id);

    const handle = db();
    const item = loadClaimItem(handle, id);
    assertInScope(handle, scope, principal, permission,
      { departmentId: item.department_id, doctorId: item.doctor_id },
      { requestPath: req.path, resourceId: id });

    const out = mutate(req, `POST /claims/:id/actions:${parsed.data.action}`,
      (p) => applyFinanceAction(handle, {
        claimItemId: id, action: parsed.data.action, actor: p,
        ...(parsed.data.approvedAmountRm
          ? { approvedAmountSen: senFromDecimalString(parsed.data.approvedAmountRm) } : {}),
        ...(parsed.data.returnReason ? { returnReason: parsed.data.returnReason } : {}),
        ...(parsed.data.voucherReference ? { voucherReference: parsed.data.voucherReference } : {}),
        ...(idempotencyKey(req) ? { idempotencyKey: idempotencyKey(req)! } : {}),
      }));
    res.status(out.statusCode).json(out.body);
  }));

  const reconcileSchema = z.object({
    paymentReference: z.string().min(1).max(120),
    amountPaidRm: z.string().regex(/^\d+(\.\d{1,2})?$/),
    paidAt: z.string().datetime(),
    voucherReference: z.string().max(120).optional(),
  });

  router.post('/claims/:id/reconcile', handler(async (req, res) => {
    const id = req.params.id!;
    gate(req, 'payment.reconcile', id);
    const parsed = reconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('INVALID_REQUEST',
        'A payment reference, amount and payment date are all required: an approval alone is '
        + 'not evidence of settlement.', parsed.error.flatten().fieldErrors);
    }
    const out = mutate(req, 'POST /claims/:id/reconcile', (principal) => reconcilePayment(db(), {
      claimItemId: id, actor: principal, paymentReference: parsed.data.paymentReference,
      amountPaidSen: senFromDecimalString(parsed.data.amountPaidRm), paidAt: parsed.data.paidAt,
      ...(parsed.data.voucherReference ? { voucherReference: parsed.data.voucherReference } : {}),
      ...(idempotencyKey(req) ? { idempotencyKey: idempotencyKey(req)! } : {}),
    }));
    res.status(out.statusCode).json(out.body);
  }));

  router.post('/claims/:id/payment-failure', handler(async (req, res) => {
    const id = req.params.id!;
    gate(req, 'payment.reconcile', id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    if (!reason) throw badRequest('INVALID_REQUEST', 'A failure reason is required.');
    const out = mutate(req, 'POST /claims/:id/payment-failure',
      (principal) => recordPaymentFailure(db(), { claimItemId: id, actor: principal, reason }));
    res.status(out.statusCode).json(out.body);
  }));

  router.post('/claims/:id/reversal', handler(async (req, res) => {
    const id = req.params.id!;
    gate(req, 'payment.reconcile', id);
    const schema = z.object({
      reversalReference: z.string().min(1).max(120),
      reversesPaymentId: z.string().min(1).max(80),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A reversal reference and the '
      + 'original payment id are required.');
    const out = mutate(req, 'POST /claims/:id/reversal', (principal) => recordReversal(db(), {
      claimItemId: id, actor: principal, reversalReference: parsed.data.reversalReference,
      reversesPaymentId: parsed.data.reversesPaymentId,
    }));
    res.status(out.statusCode).json(out.body);
  }));

  // ------------------------------------------------------------------ metrics
  router.get('/metrics/overview', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'metrics.read.hospital');
    const { request } = parseFilter(db(), req, principal, scope);
    const { cards, queueHealth } = overviewPanels(db(), request);
    res.json({ cards, queueHealth });
  }));

  router.get('/metrics/departments', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'metrics.read.hospital');
    const { request } = parseFilter(db(), req, principal, scope);
    res.json(departmentPanels(db(), request));
  }));

  router.get('/metrics/insights', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'metrics.read.hospital');
    const { request } = parseFilter(db(), req, principal, scope);
    res.json(insightsPanels(db(), request));
  }));

  router.get('/metrics/forecast', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'forecast.read');
    const { request } = parseFilter(db(), req, principal, scope);
    res.json(forecastPanel(db(), request));
  }));

  router.get('/metrics/actions', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'recommendations.read');
    const { request } = parseFilter(db(), req, principal, scope);
    res.json(actionsPanel(db(), request));
  }));

  const acceptanceSchema = z.object({
    recommendationKey: z.string().min(1).max(80),
    periodKey: z.string().min(1).max(20),
    decision: z.enum(['ACCEPTED', 'DECLINED', 'DEFERRED']),
    actionOwner: z.string().max(120).optional(),
    reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().max(500).optional(),
  });

  router.post('/metrics/actions/decisions', handler(async (req, res) => {
    gate(req, 'recommendations.accept');
    const parsed = acceptanceSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A decision is required.');
    const out = mutate(req, 'POST /metrics/actions/decisions', (principal) => {
      const handle = db();
      const id = newId('acc');
      handle.run(
        `INSERT INTO recommendation_acceptances (acceptance_id, recommendation_key, period_key,
           decision, action_owner, review_date, note, decided_by, decided_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, parsed.data.recommendationKey, parsed.data.periodKey, parsed.data.decision,
        parsed.data.actionOwner ?? null, parsed.data.reviewDate ?? null,
        parsed.data.note ?? null, principal.userId, nowInstant());
      appendAuditEvent(handle, {
        actorUserId: principal.userId, actorRole: principal.role,
        action: 'RECOMMENDATION_DECISION', outcome: 'ALLOWED', resourceType: 'RECOMMENDATION',
        resourceId: parsed.data.recommendationKey, detail: { decision: parsed.data.decision },
      });
      return { acceptanceId: id, recorded: true };
    });
    res.status(out.statusCode).json(out.body);
  }));

  // Fees, exports, snapshots, configuration, imports and the audit log.
  router.use('/', adminRouter());

  return router;
}

/**
 * How a payment position is described to a user.
 *
 * "Paid" is only ever shown when reconciled evidence exists; approval or a payment
 * instruction reads "Awaiting payment confirmation".
 */
function displayPaymentStatus(
  handle: ReturnType<typeof db>, claimItemId: string, status: string,
): string {
  if (status === 'PAID' || status === 'PARTIALLY_PAID') {
    const evidence = handle.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM payment_allocations
       WHERE claim_item_id = ? AND payment_status = 'RECONCILED'
         AND payment_reference IS NOT NULL AND paid_at IS NOT NULL AND reconciled_at IS NOT NULL`,
      claimItemId);
    if ((evidence?.n ?? 0) === 0) return AWAITING_CONFIRMATION_LABEL;
    return status === 'PAID' ? 'Paid' : 'Partially paid';
  }
  if (status === 'APPROVED' || status === 'PAYMENT_PROCESSING') return AWAITING_CONFIRMATION_LABEL;
  if (status === 'PAYMENT_FAILED') return 'Payment failed — awaiting re-instruction';
  if (status === 'REVERSED') return 'Payment reversed';
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}
