/**
 * Monthly exports and frozen snapshots.
 *
 * Two commitments this module keeps:
 *
 *  - **Export counts reconcile with the dashboard under the same filters.** The
 *    export is built from the same panel functions the screen calls, not from a
 *    second set of queries that could drift.
 *  - **A frozen snapshot is never silently changed.** A correction creates a new
 *    revision that records what it supersedes and why; the earlier revision stays
 *    readable, so a figure quoted in last month's meeting can still be reproduced.
 *
 * The PDF is produced as a print-ready HTML document rather than through a PDF
 * library: it keeps both mandatory captions, the filter echo and the data-class
 * notice in the printed output, and it adds no dependency for the sake of a file
 * format. `docs/11-integration-notes.md` covers server-side rendering if IKN wants
 * an unattended monthly PDF.
 */
import type { Handle } from '../db/database.ts';
import { newId } from '../domain/ids.ts';
import { nowInstant, type Instant } from '../domain/time.ts';
import { ringgitString } from '../domain/money.ts';
import { conflict, forbidden } from '../http/errors.ts';
import { departmentPanels, financePanels, insightsPanels, overviewPanels, reportsPanels,
  type PanelRequest } from '../analytics/panels.ts';
import { FORMULA_VERSION } from '../analytics/dictionary.ts';
import { settings, SYNTHETIC_NOTICE } from '../config/settings.ts';
import { toCsv } from '../../scripts/lib/csv.ts';
import type { Principal } from '../auth/session.ts';
import type { Captions } from '../../shared/domain.ts';

export interface ExportSection {
  key: string;
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
  captions: Captions;
}

export interface ExportBundle {
  periodMonth: string;
  generatedAt: Instant;
  filterEcho: Record<string, unknown>;
  sections: ExportSection[];
}

/**
 * Builds every export section from the same panels the dashboard renders, so the
 * two cannot disagree.
 */
export function buildExportBundle(handle: Handle, request: PanelRequest): ExportBundle {
  const overview = overviewPanels(handle, request);
  const reports = reportsPanels(handle, request, 1, 1000);
  const departments = departmentPanels(handle, request);
  const finance = financePanels(handle, request, 1, 1000);
  const insights = insightsPanels(handle, request);

  const cards = overview.cards.data;
  const sections: ExportSection[] = [
    {
      key: 'activity',
      title: 'Activity',
      columns: ['metric', 'value', 'unit'],
      rows: [
        { metric: 'Received', value: cards.page1.received.value, unit: 'applications' },
        { metric: 'Completed', value: cards.page1.completed.value, unit: 'applications' },
        { metric: 'Open at cutoff', value: cards.page1.openBacklog.value, unit: 'applications' },
        { metric: 'Overdue open', value: cards.page1.overdueOpen.value, unit: 'applications' },
        { metric: 'Received but not yet complete',
          value: overview.queueHealth.data.incomplete.value, unit: 'applications' },
      ],
      captions: cards.captions.received!,
    },
    {
      key: 'timeliness',
      title: 'Timeliness',
      columns: ['metric', 'numerator', 'denominator', 'percent', 'note'],
      rows: [rateRow('Due-cohort on-time rate', cards.page2.dueCohortOnTime),
        ...(insights.kpis.data.values.completedCohortOnTime
          ? [rateRow('Completed-cohort on-time rate (supplementary)',
            insights.kpis.data.values.completedCohortOnTime)] : []),
        ...(insights.kpis.data.values.doctorCompliance
          ? [rateRow('Doctor deadline compliance', insights.kpis.data.values.doctorCompliance)] : []),
      ],
      captions: cards.captions.dueCohortOnTime!,
    },
    {
      key: 'turnaround',
      title: 'Turnaround',
      columns: ['band', 'completed_reports'],
      rows: insights.turnaround.data.bins.map((b) => ({ band: b.label, completed_reports: b.count })),
      captions: insights.turnaround.captions,
    },
    {
      key: 'open_queue',
      title: 'Open and overdue queue',
      columns: ['application_id', 'department_id', 'report_type', 'stage', 'current_owner',
        'original_due_date', 'revised_due_date', 'working_days_remaining',
        'working_days_overdue', 'delay_reason', 'next_action'],
      rows: reports.worklist.data.rows.map((r) => ({
        application_id: r.applicationId, department_id: r.departmentId, report_type: r.reportType,
        stage: r.stage, current_owner: r.currentOwner, original_due_date: r.originalDueDate,
        revised_due_date: r.revisedDueDate, working_days_remaining: r.workingDaysRemaining,
        working_days_overdue: r.workingDaysOverdue, delay_reason: r.delayReasonCode,
        next_action: r.nextAction,
      })),
      captions: reports.worklist.captions,
    },
    {
      key: 'stage_delays',
      title: 'Stage delays',
      columns: ['stage', 'attributed_to', 'reason_code', 'applications'],
      rows: stageDelays(handle, request),
      captions: {
        howToRead: 'delays grouped by the stage that owned them and the party the delay was '
          + 'attributed to.',
        whatThisShows: describeStageDelays(stageDelays(handle, request), request.month),
        ...(settings().dataClass === 'SYNTHETIC' ? { dataClassNotice: SYNTHETIC_NOTICE } : {}),
      },
    },
    {
      key: 'departments',
      title: 'Departmental results',
      columns: ['department', 'open', 'overdue_open', 'on_time_numerator',
        'on_time_denominator', 'on_time_percent'],
      rows: departments.overdue.data.map((d) => ({
        department: d.departmentName, open: d.open, overdue_open: d.overdueOpen,
        on_time_numerator: d.onTime.applicable ? d.onTime.numerator : '',
        on_time_denominator: d.onTime.applicable ? d.onTime.denominator : '',
        on_time_percent: d.onTime.applicable ? d.onTime.percent.toFixed(1)
          : 'Not applicable — no eligible cases',
      })),
      captions: departments.onTime.captions,
    },
    {
      key: 'claims',
      title: 'Claims',
      columns: ['claim_stage', 'claim_items'],
      rows: finance.pipeline.data.map((s) => ({ claim_stage: s.status, claim_items: s.count })),
      captions: finance.pipeline.captions,
    },
    {
      key: 'payment_ageing',
      title: 'Payment ageing — approved but unpaid',
      columns: ['band', 'claim_items', 'amount_rm', 'action_owner'],
      rows: finance.ageingApprovedUnpaid.data.rows.map((r) => ({
        band: r.bucket, claim_items: r.count, amount_rm: r.amountRm, action_owner: r.actionOwner,
      })),
      captions: finance.ageingApprovedUnpaid.captions,
    },
    {
      key: 'data_quality',
      title: 'Data-quality exceptions',
      columns: ['code', 'description', 'count', 'examples'],
      rows: reports.exceptions.data.map((e) => ({
        code: e.code, description: e.label, count: e.count, examples: e.examples.join(' '),
      })),
      captions: reports.exceptions.captions,
    },
    {
      key: 'excluded_cases',
      title: 'Excluded and unclassifiable cases',
      columns: ['code', 'reason', 'count'],
      rows: insights.kpis.data.excludedCases.map((e) => ({
        code: e.code, reason: e.reason, count: e.count,
      })),
      captions: {
        howToRead: 'cases left out of the timeliness denominators, and why.',
        whatThisShows: insights.kpis.data.excludedCases.length === 0
          ? `No cases were excluded from the timeliness denominators for ${request.month}.`
          : `${insights.kpis.data.excludedCases.reduce((s, e) => s + e.count, 0)} cases were `
            + `excluded from the timeliness denominators for ${request.month}, across `
            + `${insights.kpis.data.excludedCases.length} reasons.`,
        ...(settings().dataClass === 'SYNTHETIC' ? { dataClassNotice: SYNTHETIC_NOTICE } : {}),
      },
    },
    {
      key: 'metric_dictionary',
      title: 'Metric dictionary',
      columns: ['key', 'label', 'unit', 'definition', 'numerator', 'denominator',
        'inclusions', 'exclusions', 'authority', 'notes'],
      rows: insights.kpis.data.dictionary.map((d) => ({
        key: d.key, label: d.label, unit: d.unit, definition: d.definition,
        numerator: d.numerator ?? '', denominator: d.denominator ?? '',
        inclusions: d.inclusions.join(' | '), exclusions: d.exclusions.join(' | '),
        authority: d.authority, notes: d.notes ?? '',
      })),
      captions: insights.kpis.captions,
    },
  ];

  return {
    periodMonth: request.month,
    generatedAt: nowInstant(),
    filterEcho: { ...overview.cards.filter },
    sections,
  };
}

function rateRow(label: string, metric: { applicable: boolean } & Record<string, unknown>) {
  if (!metric.applicable) {
    return {
      metric: label, numerator: '', denominator: '', percent: '',
      note: 'Not applicable — no eligible cases',
    };
  }
  return {
    metric: label, numerator: metric.numerator, denominator: metric.denominator,
    percent: (metric.percent as number).toFixed(1),
    note: (metric.partialPeriodNotice as string | undefined) ?? '',
  };
}

function stageDelays(handle: Handle, request: PanelRequest) {
  const where = ['d.started_at <= ?'];
  const params: (string | number)[] = [request.cutoff];
  if (request.departmentIds && request.departmentIds.length > 0) {
    where.push(`a.department_id IN (${request.departmentIds.map(() => '?').join(',')})`);
    params.push(...request.departmentIds);
  }
  return handle.all<Record<string, unknown>>(
    `SELECT d.stage, d.attributed_to, d.reason_code, COUNT(*) AS applications
     FROM delay_events d JOIN applications a ON a.application_id = d.application_id
     WHERE ${where.join(' AND ')}
     GROUP BY d.stage, d.attributed_to, d.reason_code
     ORDER BY applications DESC`, ...params);
}

function describeStageDelays(rows: readonly Record<string, unknown>[], month: string): string {
  if (rows.length === 0) return `No delays were recorded for the selected filters at ${month}.`;
  const total = rows.reduce((s, r) => s + Number(r.applications), 0);
  const top = rows[0]!;
  return `${total} recorded delays across ${rows.length} stage-and-reason combinations; the `
    + `largest is ${String(top.reason_code)} at the ${String(top.stage)} stage, attributed to `
    + `${String(top.attributed_to)}, with ${Number(top.applications)}.`;
}

/** Renders the bundle as a set of CSV files, one per section. */
export function exportAsCsv(bundle: ExportBundle): { filename: string; content: string }[] {
  const header = [
    `# IKN Medical Report Tracking — monthly export`,
    `# Period: ${bundle.periodMonth}`,
    `# Generated at: ${bundle.generatedAt}`,
    ...Object.entries(bundle.filterEcho).map(([k, v]) => `# ${k}: ${String(v)}`),
  ];
  return bundle.sections.map((s) => ({
    filename: `${bundle.periodMonth}_${s.key}.csv`,
    content: [
      ...header,
      `# Section: ${s.title}`,
      `# How to read this: ${s.captions.howToRead}`,
      `# What this shows: ${s.captions.whatThisShows}`,
      ...(s.captions.dataClassNotice ? [`# ${s.captions.dataClassNotice}`] : []),
      '',
      toCsv(s.columns, s.rows).trimEnd(),
    ].join('\n') + '\n',
  }));
}

/** Print-ready HTML for the monthly management summary. */
export function exportAsPrintableHtml(bundle: ExportBundle): string {
  const esc = (v: unknown) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const notice = settings().dataClass === 'SYNTHETIC' ? SYNTHETIC_NOTICE : '';

  const sections = bundle.sections.map((s) => `
    <section>
      <h2>${esc(s.title)}</h2>
      <table>
        <thead><tr>${s.columns.map((c) => `<th>${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="caption"><strong>How to read this:</strong> ${esc(s.captions.howToRead)}</p>
      <p class="caption"><strong>What this shows:</strong> ${esc(s.captions.whatThisShows)}</p>
    </section>`).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>IKN medical report management summary — ${esc(bundle.periodMonth)}</title>
<style>
  @page { size: A4 portrait; margin: 16mm; }
  body { font: 11pt/1.45 "Noto Sans", system-ui, sans-serif; color: #15202b; }
  h1 { font-size: 17pt; margin: 0 0 4px; }
  h2 { font-size: 12pt; margin: 18px 0 6px; border-bottom: 1px solid #c8d2dc; padding-bottom: 3px; }
  section { break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { border: 1px solid #c8d2dc; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #eef3f7; }
  .caption { font-size: 9pt; color: #37474f; margin: 5px 0 0; }
  .notice { background: #fff4d6; border: 1px solid #d4a017; padding: 6px 9px; font-size: 10pt; }
  .echo { font-size: 9pt; color: #37474f; }
  .echo dt { font-weight: 600; float: left; width: 36%; clear: left; }
  .echo dd { margin: 0 0 2px 38%; }
</style></head>
<body>
  <h1>IKN Medical Report Tracking &amp; Performance System</h1>
  <p><strong>Monthly management summary — ${esc(bundle.periodMonth)}</strong></p>
  ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
  <dl class="echo">
    ${Object.entries(bundle.filterEcho)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    <dt>generatedAt</dt><dd>${esc(bundle.generatedAt)}</dd>
  </dl>
  ${sections}
  <section>
    <h2>Provenance</h2>
    <p class="caption">Figures were computed under formula version ${esc(FORMULA_VERSION)} against
    the SLA rule and business calendar named above. No metric in this document is labelled an
    official KKM KPI or an approved IKN target: the applicable specification has not been
    confirmed. See the assumptions register for every policy-dependent value.</p>
  </section>
</body></html>`;
}

// ---------------------------------------------------------------- snapshots

export interface SnapshotResult {
  snapshotId: string;
  periodMonth: string;
  revision: number;
  supersedes: string | null;
}

/**
 * Freezes the month.
 *
 * A first freeze creates revision 1. A later freeze of the same month requires a
 * `revisionReason` and creates the next revision, pointing at the one it
 * supersedes. Nothing overwrites an existing row, so a previously quoted figure
 * remains reproducible.
 */
export function freezeSnapshot(
  handle: Handle, request: PanelRequest, actor: Principal, revisionReason?: string,
): SnapshotResult {
  return handle.transaction(() => {
    const existing = handle.get<{ snapshot_id: string; revision: number }>(
      `SELECT snapshot_id, revision FROM monthly_snapshot_versions
       WHERE period_month = ? ORDER BY revision DESC LIMIT 1`, request.month);
    if (existing && !revisionReason?.trim()) {
      throw conflict('SNAPSHOT_EXISTS',
        `${request.month} is already frozen at revision ${existing.revision}. A correction needs `
        + 'a revision reason, and creates a new revision rather than changing the frozen one.');
    }

    const bundle = buildExportBundle(handle, request);
    const echo = bundle.filterEcho as Record<string, string>;
    const snapshotId = newId('snap');
    handle.run(
      `INSERT INTO monthly_snapshot_versions (snapshot_id, period_month, revision, data_as_of,
         sla_rule_version, calendar_version, formula_version, data_class, frozen_at, frozen_by,
         supersedes, revision_reason, metrics_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      snapshotId, request.month, (existing?.revision ?? 0) + 1, request.cutoff,
      echo.slaRuleVersion!, echo.calendarVersion!, FORMULA_VERSION, settings().dataClass,
      nowInstant(), actor.userId, existing?.snapshot_id ?? null, revisionReason ?? null,
      JSON.stringify(bundle));

    return {
      snapshotId, periodMonth: request.month, revision: (existing?.revision ?? 0) + 1,
      supersedes: existing?.snapshot_id ?? null,
    };
  });
}

export function listSnapshots(handle: Handle) {
  return handle.all<Record<string, unknown>>(
    `SELECT snapshot_id, period_month, revision, data_as_of, sla_rule_version, calendar_version,
            formula_version, data_class, frozen_at, frozen_by, supersedes, revision_reason
     FROM monthly_snapshot_versions ORDER BY period_month DESC, revision DESC`);
}

export function readSnapshot(handle: Handle, snapshotId: string): ExportBundle {
  const row = handle.get<{ metrics_json: string }>(
    'SELECT metrics_json FROM monthly_snapshot_versions WHERE snapshot_id = ?', snapshotId);
  if (!row) throw forbidden('No such snapshot.');
  return JSON.parse(row.metrics_json) as ExportBundle;
}

/** Convenience for the UI: RM formatting of a sen figure in an export row. */
export const rmFromSen = ringgitString;
