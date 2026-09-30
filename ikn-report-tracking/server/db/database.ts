/**
 * Database access layer.
 *
 * The prototype runs on `node:sqlite`, which ships with Node 22 and needs no
 * native build step. The production target is PostgreSQL; every statement in
 * this codebase is written to the portability contract documented at the top of
 * `server/db/migrations/001_initial.sql`, and placeholders are `?` so a
 * PostgreSQL adapter only has to renumber them to `$1..$n`.
 *
 * Two handles are exported deliberately:
 *   - `db()`      read/write, used by staff and finance services
 *   - `readOnly()` a handle opened read-only, used by every public route, so a
 *                  patient viewing a status physically cannot mutate a case
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;
export type Param = string | number | null | bigint | Uint8Array;

export interface Handle {
  all<T extends Row = Row>(sql: string, ...params: Param[]): T[];
  get<T extends Row = Row>(sql: string, ...params: Param[]): T | undefined;
  run(sql: string, ...params: Param[]): { changes: number };
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

class SqliteHandle implements Handle {
  constructor(private readonly raw: DatabaseSync, private readonly writable: boolean) {}

  all<T extends Row = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T extends Row = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Param[]) {
    if (!this.writable) throw new Error('read-only handle: refusing to run a mutating statement');
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  exec(sql: string) {
    if (!this.writable) throw new Error('read-only handle: refusing to exec');
    this.raw.exec(sql);
  }

  /**
   * Wraps `fn` in a real database transaction. Nested calls join the outer
   * transaction rather than opening a second one, so a service composed of
   * other services still commits or rolls back as one unit.
   */
  transaction<T>(fn: () => T): T {
    if (!this.writable) throw new Error('read-only handle: refusing to open a transaction');
    if (depth > 0) return fn();
    depth += 1;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      try { this.raw.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
      throw err;
    } finally {
      depth -= 1;
    }
  }
}

let depth = 0;
let writeHandle: SqliteHandle | undefined;
let readHandle: SqliteHandle | undefined;
let openedPath: string | undefined;

function dbPath(): string {
  return resolve(process.env.IKN_DB_FILE ?? 'var/ikn.sqlite');
}

function open(): void {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  writeHandle = new SqliteHandle(raw, true);

  const ro = new DatabaseSync(path, { readOnly: true });
  ro.exec('PRAGMA foreign_keys = ON');
  readHandle = new SqliteHandle(ro, false);
  openedPath = path;
}

export function db(): Handle {
  if (!writeHandle || openedPath !== dbPath()) open();
  return writeHandle!;
}

/** Read-only handle. Public routes use this and nothing else. */
export function readOnly(): Handle {
  if (!readHandle || openedPath !== dbPath()) open();
  return readHandle!;
}

export function closeDatabase(): void {
  writeHandle = undefined;
  readHandle = undefined;
  openedPath = undefined;
}

/** Applies any migration files not yet recorded in `schema_migrations`. */
export function migrate(handle: Handle = db()): string[] {
  const dir = join(HERE, 'migrations');
  handle.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set(
    handle.all<{ migration_id: string }>('SELECT migration_id FROM schema_migrations')
      .map((r) => r.migration_id),
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    handle.exec(readFileSync(join(dir, file), 'utf8'));
    handle.run('INSERT OR REPLACE INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)',
      file, new Date().toISOString());
    applied.push(file);
  }
  return applied;
}
