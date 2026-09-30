/**
 * Drops and recreates the prototype database. Refuses to run unless the data
 * class is SYNTHETIC, so it cannot be pointed at anything holding real records.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeDatabase, db, migrate } from '../server/db/database.ts';

const dataClass = process.env.IKN_DATA_CLASS ?? 'SYNTHETIC';
if (dataClass !== 'SYNTHETIC') {
  console.error(`refusing to reset: IKN_DATA_CLASS is ${dataClass}, not SYNTHETIC`);
  process.exit(1);
}

const path = resolve(process.env.IKN_DB_FILE ?? 'var/ikn.sqlite');
closeDatabase();
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  rmSync(`${path}${suffix}`, { force: true });
}
console.log(`removed ${path}`);
const applied = migrate(db());
console.log(`applied migrations: ${applied.join(', ') || '(none)'}`);
