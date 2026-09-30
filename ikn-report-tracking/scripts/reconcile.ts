/**
 * Compares this engine's monthly figures with the supplied workbook's own.
 *
 * The two are expected to differ, and the point of this script is to say by how
 * much and for exactly which reason — a dataset whose provenance is explained is
 * worth more than one that happens to agree.
 *
 * Run against a seeded database:  npx tsx scripts/reconcile.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../server/db/database.ts';
import { loadCohort } from '../server/analytics/cohort.ts';
import { cancelled, completed, dueCohortOnTimeRate, openBacklog, received } from '../server/analytics/metrics.ts';
import { parseCsv, toCsv } from './lib/csv.ts';
import { SNAPSHOT_DATE } from '../server/db/seed/synthetic.ts';

const CUTOFF = `${SNAPSHOT_DATE}T15:59:59.000Z`;

const handle = db();
const cohort = loadCohort(handle, { cutoff: CUTOFF });

const workbook = parseCsv(
  readFileSync(join('data', 'synthetic', 'workbook_monthly_kpi.csv'), 'utf8'))
  // The sheet carries its own caption rows beneath the table; only real months count.
  .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.month_start ?? ''));

interface Row extends Record<string, unknown> {
  month: string;
  period_status: string;
  workbook_received: number;
  engine_received: number;
  workbook_completed: number;
  engine_completed: number;
  workbook_cancelled: number;
  engine_cancelled: number;
  workbook_due_reports: number;
  engine_due_reports: number;
  workbook_on_time_rate: string;
  engine_on_time_rate: string;
  engine_on_time_parts: string;
}

const rows: Row[] = workbook.map((w) => {
  const month = w.month_start!.slice(0, 7);
  const engineOnTime = dueCohortOnTimeRate(cohort, month);
  return {
    month,
    period_status: w.period_status!,
    workbook_received: Number(w.received),
    engine_received: received(cohort, month).value,
    workbook_completed: Number(w.completed),
    engine_completed: completed(cohort, month).value,
    workbook_cancelled: Number(w.cancelled),
    engine_cancelled: cancelled(cohort, month).value,
    workbook_due_reports: Number(w.due_reports),
    engine_due_reports: engineOnTime.applicable ? engineOnTime.denominator : 0,
    workbook_on_time_rate: Number(w.due_reports) === 0 ? 'n.a.'
      : `${((Number(w.on_time_due_reports) / Number(w.due_reports)) * 100).toFixed(1)}%`,
    engine_on_time_rate: engineOnTime.applicable
      ? `${engineOnTime.percent.toFixed(1)}%` : 'n.a.',
    engine_on_time_parts: engineOnTime.applicable
      ? `${engineOnTime.numerator}/${engineOnTime.denominator}` : '0/0',
  };
});

const mismatchedReceived = rows.filter((r) => r.workbook_received !== r.engine_received);
const mismatchedCompleted = rows.filter((r) => r.workbook_completed !== r.engine_completed);
const mismatchedCancelled = rows.filter((r) => r.workbook_cancelled !== r.engine_cancelled);

writeFileSync('var/reconciliation.csv', toCsv(
  ['month', 'period_status', 'workbook_received', 'engine_received', 'workbook_completed',
    'engine_completed', 'workbook_cancelled', 'engine_cancelled', 'workbook_due_reports',
    'engine_due_reports', 'workbook_on_time_rate', 'engine_on_time_rate', 'engine_on_time_parts'],
  rows));

console.log('=== monthly reconciliation against the supplied workbook ===\n');
console.log(`months compared: ${rows.length}`);
console.log(`received counts disagreeing:  ${mismatchedReceived.length}`);
console.log(`completed counts disagreeing: ${mismatchedCompleted.length}`);
console.log(`cancelled counts disagreeing: ${mismatchedCancelled.length}`);

for (const r of mismatchedCompleted.slice(0, 8)) {
  console.log(`  ${r.month}: workbook ${r.workbook_completed}, engine ${r.engine_completed}`);
}

// The due cohort is the figure the two calendars genuinely disagree about: a
// deadline that the workbook places in one month can fall in the next once public
// holidays are counted.
const cohortShifts = rows.filter((r) => r.workbook_due_reports !== r.engine_due_reports);
console.log(`\ndue-cohort sizes disagreeing: ${cohortShifts.length} of ${rows.length} months`);
const totalShift = cohortShifts.reduce(
  (sum, r) => sum + Math.abs(r.workbook_due_reports - r.engine_due_reports), 0);
console.log(`total applications whose due month moved: ${totalShift}`);
for (const r of cohortShifts.slice(0, 8)) {
  console.log(`  ${r.month}: workbook ${r.workbook_due_reports} due, `
    + `engine ${r.engine_due_reports} due`);
}

// Deadline comparison: how far the engine's due dates sit from the workbook's,
// given the workbook omits public holidays and this engine does not.
const applications = parseCsv(
  readFileSync(join('data', 'synthetic', 'applications.csv'), 'utf8'));
console.log(`\napplications in the extract: ${applications.length}`);

const onTimeTotals = rows.reduce((acc, r) => {
  const [n, d] = r.engine_on_time_parts.split('/').map(Number) as [number, number];
  return { numerator: acc.numerator + n, denominator: acc.denominator + d };
}, { numerator: 0, denominator: 0 });
console.log(`\nengine due-cohort on-time across all months: `
  + `${onTimeTotals.numerator}/${onTimeTotals.denominator} = `
  + `${((onTimeTotals.numerator / onTimeTotals.denominator) * 100).toFixed(1)}%`);

const workbookTotals = workbook.reduce((acc, w) => ({
  numerator: acc.numerator + Number(w.on_time_due_reports ?? 0),
  denominator: acc.denominator + Number(w.due_reports ?? 0),
}), { numerator: 0, denominator: 0 });
console.log(`workbook due-cohort on-time across all months: `
  + `${workbookTotals.numerator}/${workbookTotals.denominator} = `
  + `${((workbookTotals.numerator / workbookTotals.denominator) * 100).toFixed(1)}%`);

console.log('\nwrote var/reconciliation.csv');
