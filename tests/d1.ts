// A small D1-compatible wrapper around Node's built-in SQLite, so tests run the app's real SQL
// and real migrations without Cloudflare. Implements the parts of the D1 API the app uses:
// prepare().bind().first()/all()/run(), and batch() as one transaction (like D1).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Result = { results: Record<string, unknown>[]; success: true; meta: { changes: number; last_row_id: number } };

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }

  /** @internal */
  execute(): Result {
    const stmt = this.db.prepare(this.sql);
    const params = this.params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)) as never[];
    if (stmt.columns().length > 0) {
      return { results: stmt.all(...params) as Record<string, unknown>[], success: true, meta: { changes: 0, last_row_id: 0 } };
    }
    const info = stmt.run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute().results[0];
    if (row === undefined) return null;
    return (column ? row[column] : row) as T;
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
}

export class TestD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON'); // D1 enforces foreign keys
  }

  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }

  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((s) => s.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql);
  }

  /** Synchronous helpers for test setup and assertions. */
  run(sql: string, ...params: unknown[]) {
    return this.sqlite.prepare(sql).run(...(params as never[]));
  }
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return this.sqlite.prepare(sql).get(...(params as never[])) as T;
  }
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return this.sqlite.prepare(sql).all(...(params as never[])) as T[];
  }

  /** Typed as D1Database for the app code under test. */
  get d1(): D1Database {
    return this as unknown as D1Database;
  }
}

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/** Fresh in-memory database with all migrations applied (including default criteria and tags). */
export function createTestDb(): TestD1 {
  const db = new TestD1();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

/** Adds an institution and returns its id. */
export function addInstitution(db: TestD1, name: string, regNumber: string): number {
  const slug = name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-');
  return Number(
    db.run(
      `INSERT INTO institutions (reg_number, name, name_search, slug, veids) VALUES (?, ?, ?, ?, 'Vispārējās izglītības iestāde')`,
      regNumber,
      name,
      name.toLowerCase(),
      slug,
    ).lastInsertRowid,
  );
}

export function addAdmin(db: TestD1, email = 'admin@example.com', role: 'admin' | 'moderator' = 'admin'): number {
  return Number(db.run(`INSERT INTO admin_users (email, role) VALUES (?, ?)`, email, role).lastInsertRowid);
}
