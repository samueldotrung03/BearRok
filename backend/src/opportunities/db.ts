// The Postgres connection behind the shared opportunities table.
//
// With DATABASE_URL set, it is a hosted Postgres server that every copy of the backend shares.
// Without it, the same SQL runs in an embedded Postgres kept in a folder on this computer, so
// the table works in development and in tests with nothing to install.
import { mkdirSync } from 'node:fs';

/** The part of a Postgres client the opportunities table needs. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
  /** Where the data lives, in words for the start-up log. Never includes a password. */
  where: string;
}

/** A hosted Postgres server, reached with a connection string. */
export async function openServer(url: string): Promise<Sql> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  let host = 'a Postgres server';
  try {
    host = `Postgres at ${new URL(url).hostname}`;
  } catch {
    // An unusual connection string: the driver reports it on the first query.
  }
  return {
    query: async (text, params) => ({ rows: (await pool.query(text, params as unknown[])).rows }),
    close: () => pool.end(),
    where: host,
  };
}

/** Embedded Postgres. Pass null to keep it in memory only (tests). */
export async function openEmbedded(dir: string | null): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    query: async (text, params) => ({ rows: (await db.query(text, params as unknown[])).rows as never[] }),
    close: () => db.close(),
    where: dir ? `embedded Postgres in ${dir}` : 'embedded Postgres in memory',
  };
}
