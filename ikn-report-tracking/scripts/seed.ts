/**
 * Seeds the prototype database with the synthetic dataset and prints a summary.
 *
 * The summary is the point of this script as much as the data is: it reports the
 * augmentations, the derived-status disagreements and the data-quality exceptions,
 * so nobody has to take the numbers on trust.
 */
import { writeFileSync } from 'node:fs';
import { closeDatabase, db, migrate } from '../server/db/database.ts';
import { seedPolicyRegistry, seedReference, seedStaffUsers, DEMO_PASSWORD } from '../server/db/seed/reference.ts';
import { seedSynthetic } from '../server/db/seed/synthetic.ts';
import { setPepper } from '../server/auth/tokens.ts';
import { toCsv } from './lib/csv.ts';

const dataClass = process.env.IKN_DATA_CLASS ?? 'SYNTHETIC';
if (dataClass !== 'SYNTHETIC') {
  console.error(`refusing to seed: IKN_DATA_CLASS is ${dataClass}, not SYNTHETIC`);
  process.exit(1);
}

// A fixed pepper for the prototype, so the tracking references written to
// var/demo-tracking-references.csv keep working across restarts. Production reads
// IKN_TOKEN_PEPPER from managed secrets and never uses a literal.
setPepper(process.env.IKN_TOKEN_PEPPER
  && process.env.IKN_TOKEN_PEPPER !== 'replace-me-with-64-hex-characters'
  ? process.env.IKN_TOKEN_PEPPER
  : 'prototype-only-pepper-not-for-production-use-0000');

const handle = db();
migrate(handle);

const existing = handle.get<{ n: number }>('SELECT COUNT(*) AS n FROM applications');
if ((existing?.n ?? 0) > 0) {
  console.error('database already holds applications; run npm run db:reset first');
  process.exit(1);
}

const started = Date.now();
const summary = handle.transaction(() => {
  seedReference(handle);
  const staff = seedStaffUsers(handle);
  seedPolicyRegistry(handle);
  const s = seedSynthetic(handle);
  return { ...s, staffUsers: staff.length };
});

// Tracking references are bearer credentials, so only their HMAC reached the
// database. This file exists so the prototype is demonstrable; it is gitignored,
// and the equivalent file must never be produced for real applicants.
writeFileSync('var/demo-tracking-references.csv', toCsv(
  ['application_id', 'internal_report_number', 'public_tracking_reference'],
  summary.trackingReferences.map((t) => ({
    application_id: t.applicationId,
    internal_report_number: t.internalReportNumber,
    public_tracking_reference: t.reference,
  })),
));

console.log('\n=== IKN Medical Report Tracking — seed summary ===');
console.log('Data class: SYNTHETIC — demonstration data, not actual IKN performance.\n');
for (const [k, v] of Object.entries(summary)) {
  if (k === 'statusMismatches' || k === 'trackingReferences') continue;
  if (typeof v === 'object' && v !== null) {
    console.log(`${k}:`);
    for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2}: ${v2}`);
  } else console.log(`${k}: ${v}`);
}
console.log(`\nderived status disagreed with the workbook column: ${summary.statusMismatches.length}`);
for (const m of summary.statusMismatches.slice(0, 10)) {
  console.log(`  ${m.applicationId}: workbook=${m.workbook} derived=${m.derived}`);
}
if (summary.statusMismatches.length > 10) {
  console.log(`  ... and ${summary.statusMismatches.length - 10} more`);
}

const { trackingReferences, ...forFile } = summary;
writeFileSync('var/seed-summary.json', `${JSON.stringify(forFile, null, 2)}\n`);
console.log('\nwrote var/seed-summary.json and var/demo-tracking-references.csv');
console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}):`);
console.log('  records1, records.super, finance1, finance2, director, sysadmin,');
console.log('  hod.rto … hod.omf, and one login per doctor (demo-d001 … demo-d018).');
console.log('\nSample tracking references for the patient portal:');
for (const t of summary.trackingReferences.slice(0, 3)) {
  console.log(`  ${t.applicationId}  ${t.reference}`);
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
closeDatabase();
