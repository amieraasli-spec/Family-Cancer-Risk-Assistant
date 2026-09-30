/**
 * Administration, exports and snapshots.
 *
 * Kept in its own module because its permissions are different in kind: the
 * administrator manages the machinery and holds no patient content, while exports
 * and snapshots are operational but privileged and every use is audited.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db } from '../db/database.ts';
import { authorise } from '../auth/authorise.ts';
import type { Permission } from '../auth/permissions.ts';
import { invalidateCalendarCache } from '../domain/calendar.ts';
import { appendAuditEvent } from '../domain/events.ts';
import { newId } from '../domain/ids.ts';
import { nowInstant } from '../domain/time.ts';
import { buildExportBundle, exportAsCsv, exportAsPrintableHtml, freezeSnapshot, listSnapshots,
  readSnapshot } from '../services/exports.ts';
import { applyFeeAction, loadFee, type FeeAction } from '../services/fees.ts';
import { senFromDecimalString, ringgitString } from '../domain/money.ts';
import { badRequest, unauthorised, unprocessable } from './errors.ts';
import { clientHint, handler, principalOf } from './context.ts';
import { parseFilter } from './filters.ts';
import { parseCsv } from '../../scripts/lib/csv.ts';
import { settings } from '../config/settings.ts';

function gate(req: Request, permission: Permission, resourceId?: string) {
  return authorise(db(), principalOf(req), permission, {
    requestMethod: req.method, requestPath: req.path, clientHint: clientHint(req),
    resourceId: resourceId ?? null,
  });
}

export function adminRouter(): Router {
  const router = Router();

  // ---------------------------------------------------------------------- fees
  const feeActionSchema = z.object({
    action: z.enum(['RECORD_PAYMENT', 'GRANT_EXEMPTION', 'RECORD_REFUND', 'FLAG_EXCEPTION']),
    receiptReference: z.string().max(120).optional(),
    amountReceivedRm: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    exemptionBasis: z.string().max(200).optional(),
    refundAmountRm: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    note: z.string().max(500).optional(),
  });

  const FEE_PERMISSION: Record<FeeAction, Permission> = {
    RECORD_PAYMENT: 'fee.payment.record',
    GRANT_EXEMPTION: 'fee.exemption.grant',
    RECORD_REFUND: 'fee.payment.record',
    FLAG_EXCEPTION: 'fee.payment.record',
  };

  router.get('/applications/:id/fee', handler(async (req, res) => {
    gate(req, 'fee.read', req.params.id);
    const fee = loadFee(db(), req.params.id!);
    res.json({
      applicationId: fee.application_id,
      feeStatus: fee.fee_status,
      amountDueRm: ringgitString(fee.amount_due_sen),
      amountReceivedRm: ringgitString(fee.amount_received_sen),
      refundAmountRm: ringgitString(fee.refund_amount_sen),
      receiptReference: fee.receipt_reference,
      feeRuleVersion: fee.fee_rule_version,
      notice: 'A patient fee is the applicant’s charge for a copy of the report. It is not '
        + 'doctor remuneration, and it does not appear in any claim figure.',
    });
  }));

  router.post('/applications/:id/fee', handler(async (req, res) => {
    const parsed = feeActionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A recognised fee action is required.');
    const { principal } = gate(req, FEE_PERMISSION[parsed.data.action], req.params.id);
    res.json(applyFeeAction(db(), {
      applicationId: req.params.id!, action: parsed.data.action, actor: principal,
      ...(parsed.data.receiptReference ? { receiptReference: parsed.data.receiptReference } : {}),
      ...(parsed.data.amountReceivedRm
        ? { amountReceivedSen: senFromDecimalString(parsed.data.amountReceivedRm) } : {}),
      ...(parsed.data.exemptionBasis ? { exemptionBasis: parsed.data.exemptionBasis } : {}),
      ...(parsed.data.refundAmountRm
        ? { refundAmountSen: senFromDecimalString(parsed.data.refundAmountRm) } : {}),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    }));
  }));

  // ------------------------------------------------------------------- exports
  router.get('/exports/monthly', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'export.monthly');
    const { request } = parseFilter(db(), req, principal, scope);
    const format = String(req.query.format ?? 'json');
    const bundle = buildExportBundle(db(), request);

    if (format === 'csv') {
      // One request, several CSV files, concatenated with explicit file markers so a
      // single download stays reconcilable with the screen.
      const files = exportAsCsv(bundle);
      res.type('text/plain; charset=utf-8').send(files
        .map((f) => `===== FILE: ${f.filename} =====\n${f.content}`).join('\n'));
      return;
    }
    if (format === 'html' || format === 'pdf') {
      // Print-ready HTML: the browser's print-to-PDF produces the management PDF.
      res.type('text/html; charset=utf-8').send(exportAsPrintableHtml(bundle));
      return;
    }
    res.json(bundle);
  }));

  // ----------------------------------------------------------------- snapshots
  router.get('/snapshots', handler(async (req, res) => {
    gate(req, 'export.monthly');
    res.json({ snapshots: listSnapshots(db()) });
  }));

  router.get('/snapshots/:id', handler(async (req, res) => {
    gate(req, 'export.monthly', req.params.id);
    res.json(readSnapshot(db(), req.params.id!));
  }));

  router.post('/snapshots', handler(async (req, res) => {
    const { principal, scope } = gate(req, 'snapshot.freeze');
    const { request } = parseFilter(db(), req, principal, scope);
    const reason = typeof req.body?.revisionReason === 'string' ? req.body.revisionReason : undefined;
    res.json(freezeSnapshot(db(), request, principal, reason));
  }));

  // ------------------------------------------------------------------- calendar
  const calendarSchema = z.object({
    calendarVersion: z.string().min(1).max(60),
    csv: z.string().min(1).max(200_000),
  });

  router.post('/calendar/days', handler(async (req, res) => {
    const { principal } = gate(req, 'admin.calendar');
    const parsed = calendarSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('INVALID_REQUEST', 'A calendar version and CSV rows are required.');
    }
    const handle = db();
    const version = handle.get<{ calendar_version: string }>(
      'SELECT calendar_version FROM business_calendar_versions WHERE calendar_version = ?',
      parsed.data.calendarVersion);
    if (!version) throw unprocessable('UNKNOWN_CALENDAR', 'No such calendar version.');

    const rows = parseCsv(parsed.data.csv);
    let accepted = 0;
    const rejected: { row: number; reason: string }[] = [];
    handle.transaction(() => {
      rows.forEach((r, i) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.calendar_date ?? '')) {
          rejected.push({ row: i + 2, reason: 'calendar_date must be YYYY-MM-DD' }); return;
        }
        if (!['PUBLIC_HOLIDAY', 'REPLACEMENT_HOLIDAY', 'WORKING_OVERRIDE'].includes(r.day_kind ?? '')) {
          rejected.push({ row: i + 2, reason: 'day_kind is not recognised' }); return;
        }
        handle.run(
          `INSERT INTO business_calendar_days (calendar_version, calendar_date, day_kind, label)
           VALUES (?,?,?,?)
           ON CONFLICT(calendar_version, calendar_date) DO UPDATE SET day_kind = ?, label = ?`,
          parsed.data.calendarVersion, r.calendar_date!, r.day_kind!, r.label ?? '',
          r.day_kind!, r.label ?? '');
        accepted += 1;
      });
    });
    // Deadlines are derived from the calendar, so the cache must go or the next
    // request would answer from the old holiday set.
    invalidateCalendarCache(parsed.data.calendarVersion);
    appendAuditEvent(handle, {
      actorUserId: principal.userId, actorRole: principal.role, action: 'CALENDAR_UPDATE',
      outcome: 'ALLOWED', resourceType: 'BUSINESS_CALENDAR',
      resourceId: parsed.data.calendarVersion, detail: { accepted, rejected: rejected.length },
    });
    res.json({
      accepted, rejected,
      notice: 'Existing applications keep the deadlines already recorded against them. A calendar '
        + 'change affects deadlines computed after it, which is why the calendar is versioned.',
    });
  }));

  // -------------------------------------------------------------------- config
  const configSchema = z.object({
    configKey: z.string().min(1).max(80),
    value: z.unknown(),
    verificationState: z.enum(['UNVERIFIED', 'PENDING_IKN', 'CONFIRMED']),
    basis: z.string().max(500).optional(),
    ownerToConfirm: z.string().max(120).optional(),
  });

  router.get('/config', handler(async (req, res) => {
    gate(req, 'admin.rules');
    res.json({
      settings: db().all<Record<string, unknown>>(
        `SELECT config_key, version, value_json, verification_state, owner_to_confirm, basis,
                effective_from, superseded_at FROM config_settings ORDER BY config_key, version`),
      notice: 'Every value here is a prototype assumption until its verification state reads '
        + 'CONFIRMED. See docs/05-assumptions-register.md.',
    });
  }));

  router.post('/config', handler(async (req, res) => {
    const { principal } = gate(req, 'admin.rules');
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'A configuration change is required.');
    const handle = db();
    const result = handle.transaction(() => {
      const current = handle.get<{ version: number }>(
        `SELECT version FROM config_settings WHERE config_key = ? AND superseded_at IS NULL
         ORDER BY version DESC LIMIT 1`, parsed.data.configKey);
      const now = nowInstant();
      // A change supersedes rather than overwrites, so what a past figure was
      // computed under stays on record.
      if (current) {
        handle.run(
          `UPDATE config_settings SET superseded_at = ? WHERE config_key = ? AND version = ?`,
          now, parsed.data.configKey, current.version);
      }
      const version = (current?.version ?? 0) + 1;
      handle.run(
        `INSERT INTO config_settings (config_key, version, value_json, verification_state,
           owner_to_confirm, basis, effective_from, changed_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        parsed.data.configKey, version, JSON.stringify(parsed.data.value ?? null),
        parsed.data.verificationState, parsed.data.ownerToConfirm ?? null,
        parsed.data.basis ?? null, now, principal.userId, now);
      return { configKey: parsed.data.configKey, version };
    });
    appendAuditEvent(handle, {
      actorUserId: principal.userId, actorRole: principal.role, action: 'CONFIG_CHANGE',
      outcome: 'ALLOWED', resourceType: 'CONFIG', resourceId: parsed.data.configKey,
      detail: { version: result.version, verificationState: parsed.data.verificationState },
    });
    res.json(result);
  }));

  // -------------------------------------------------------------------- import
  const importSchema = z.object({
    targetEntity: z.enum(['APPLICATIONS', 'CLAIM_ITEMS', 'PAYMENTS']),
    source: z.string().min(1).max(120),
    filename: z.string().max(200).optional(),
    csv: z.string().min(1).max(4_000_000),
  });

  /**
   * Validated spreadsheet import with conflict tracking.
   *
   * This is a **manual reconciliation path**, and the response and the dashboard
   * both say so. It is never presented as a live integration. The prototype
   * validates and records every row's outcome without applying it, so the operator
   * sees exactly what a real import would do before anything changes.
   */
  router.post('/imports/dry-run', handler(async (req, res) => {
    const { principal } = gate(req, 'import.run');
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('INVALID_REQUEST', 'An import file is required.');

    const handle = db();
    const rows = parseCsv(parsed.data.csv);
    const batchId = newId('imp');
    const outcomes: { row: number; naturalKey: string; outcome: string; message: string }[] = [];

    for (const [i, r] of rows.entries()) {
      const key = r.application_id ?? r.claim_item_id ?? '';
      if (!key) {
        outcomes.push({ row: i + 2, naturalKey: '', outcome: 'REJECTED',
          message: 'No natural key (application_id or claim_item_id) in this row.' });
        continue;
      }
      if (parsed.data.targetEntity === 'CLAIM_ITEMS') {
        // The duplicate guard applies to imports exactly as it does to a doctor's
        // submission: an import cannot create a second live claim for one service.
        const clash = handle.get<{ claim_item_id: string; status: string }>(
          `SELECT claim_item_id, status FROM claim_items
           WHERE application_id = ? AND eligibility_status = 'ELIGIBLE'
             AND status NOT IN ('REJECTED','WITHDRAWN','REVERSED')`, key);
        if (clash) {
          outcomes.push({ row: i + 2, naturalKey: key, outcome: 'DUPLICATE',
            message: `An active claim item already exists for this report `
              + `(${clash.claim_item_id}, ${clash.status}).` });
          continue;
        }
      }
      const exists = handle.get<{ n: number }>(
        parsed.data.targetEntity === 'APPLICATIONS'
          ? 'SELECT COUNT(*) AS n FROM applications WHERE application_id = ?'
          : 'SELECT COUNT(*) AS n FROM claim_items WHERE claim_item_id = ?', key);
      outcomes.push({
        row: i + 2, naturalKey: key,
        outcome: (exists?.n ?? 0) > 0 ? 'CONFLICT' : 'ACCEPTED',
        message: (exists?.n ?? 0) > 0
          ? 'A record with this key already exists; a real import would need a reconciliation '
            + 'decision before changing it.'
          : 'Would be inserted.',
      });
    }

    const accepted = outcomes.filter((o) => o.outcome === 'ACCEPTED').length;
    const rejected = outcomes.filter((o) => o.outcome === 'REJECTED').length;
    const conflicts = outcomes.filter((o) => o.outcome !== 'ACCEPTED' && o.outcome !== 'REJECTED').length;

    handle.transaction(() => {
      handle.run(
        `INSERT INTO import_batches (batch_id, source, target_entity, filename, row_count,
           accepted_count, rejected_count, conflict_count, imported_at, imported_by,
           integration_mode, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'MANUAL_IMPORT', ?)`,
        batchId, parsed.data.source, parsed.data.targetEntity, parsed.data.filename ?? null,
        rows.length, accepted, rejected, conflicts, nowInstant(), principal.userId,
        'Dry run only: nothing was applied. This is a manual reconciliation path, not a live '
        + 'integration.');
      for (const o of outcomes) {
        handle.run(
          `INSERT INTO import_rows (batch_id, row_number, natural_key, outcome, message)
           VALUES (?,?,?,?,?)`, batchId, o.row, o.naturalKey, o.outcome, o.message);
      }
    });

    appendAuditEvent(handle, {
      actorUserId: principal.userId, actorRole: principal.role, action: 'IMPORT_DRY_RUN',
      outcome: 'ALLOWED', resourceType: 'IMPORT_BATCH', resourceId: batchId,
      detail: { rows: rows.length, accepted, rejected, conflicts },
    });

    res.json({
      batchId, rowCount: rows.length, accepted, rejected, conflicts,
      outcomes: outcomes.slice(0, 100),
      integrationMode: 'MANUAL_IMPORT',
      notice: 'Dry run: nothing was applied. This path is a validated spreadsheet import with '
        + 'manual reconciliation. It is not a live integration with any IKN system.',
    });
  }));

  // ------------------------------------------------------- notification adapter
  router.get('/notifications', handler(async (req, res) => {
    gate(req, 'admin.notification.adapter');
    const handle = db();
    res.json({
      provider: settings().notifyProvider,
      simulation: settings().notifyProvider === 'SIMULATION',
      testAllowlist: settings().notifyTestAllowlist,
      notice: settings().notifyProvider === 'SIMULATION'
        ? 'Simulation mode: notifications are written to the log and no message leaves this '
          + 'system. No test notification can reach a real applicant.'
        : 'An approved gateway is configured. Recipients are limited to verified contacts.',
      counts: handle.all<Record<string, unknown>>(
        'SELECT status, COUNT(*) AS n FROM notifications GROUP BY status ORDER BY n DESC'),
      // Failures are surfaced to the responsible staff member, not buried in a log.
      recentFailures: handle.all<Record<string, unknown>>(
        `SELECT notification_id, application_id, channel, template_key, failure_reason,
                attempt_count, created_at
         FROM notifications WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 20`),
    });
  }));

  // ------------------------------------------------------------------- audit log
  router.get('/audit', handler(async (req, res) => {
    gate(req, 'admin.users');
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    res.json({
      events: db().all<Record<string, unknown>>(
        `SELECT occurred_at, actor_user_id, actor_role, action, outcome, permission,
                resource_type, resource_id, request_path, detail_json
         FROM audit_events ORDER BY occurred_at DESC LIMIT ?`, limit),
    });
  }));

  // --------------------------------------------------------------------- users
  router.get('/users', handler(async (req, res) => {
    gate(req, 'admin.users');
    res.json({
      users: db().all<Record<string, unknown>>(
        `SELECT user_id, username, display_name, role, is_supervisor, doctor_id, mfa_required,
                policy_clearance, active, created_at FROM users ORDER BY role, username`),
      notice: 'This role manages accounts and configuration. It holds no permission over patient '
        + 'content, clinical approval or payment approval, and the server refuses those routes '
        + 'for it regardless of what the interface offers.',
    });
  }));

  /** Replaces an applicant's public tracking reference, e.g. after a suspected leak. */
  router.post('/applications/:id/tracking-reference', handler(async (req, res) => {
    const { principal } = gate(req, 'application.register', req.params.id);
    const handle = db();
    const { newPublicTrackingReference, normaliseTrackingReference } =
      await import('../domain/ids.ts');
    const { hashSecret } = await import('../auth/tokens.ts');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'REISSUED_ON_REQUEST';
    const reference = newPublicTrackingReference();
    handle.transaction(() => {
      handle.run(
        `UPDATE public_tracking_tokens SET revoked_at = ?, revoked_reason = ?
         WHERE application_id = ? AND revoked_at IS NULL`,
        nowInstant(), reason, req.params.id!);
      handle.run(
        'INSERT INTO public_tracking_tokens (token_hash, application_id, issued_at) VALUES (?,?,?)',
        hashSecret(normaliseTrackingReference(reference), 'tracking'), req.params.id!, nowInstant());
    });
    appendAuditEvent(handle, {
      actorUserId: principal.userId, actorRole: principal.role, action: 'TRACKING_REFERENCE_REISSUE',
      outcome: 'ALLOWED', resourceType: 'APPLICATION', resourceId: req.params.id!,
      detail: { reason },
    });
    res.json({
      publicTrackingReference: reference,
      notice: 'The previous reference is revoked and will no longer return a status. Give this '
        + 'one to the applicant; it is shown once.',
    });
  }));

  return router;
}
