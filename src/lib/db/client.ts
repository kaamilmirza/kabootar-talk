/**
 * One tagged-template query API over two drivers.
 *
 * Neon's HTTP driver is used when DATABASE_URL points at Neon, because it is
 * the right thing on serverless: no connection pool to exhaust, no cold-start
 * handshake. Anything else falls back to plain node-postgres, so a contributor
 * can run the whole app against a local Docker Postgres with no account
 * anywhere.
 *
 * Both paths are parameterised. There is no string interpolation of values in
 * this codebase, and no code path that builds SQL by concatenation.
 */

import 'server-only';

import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';

export type Row = Record<string, unknown>;

type Query = <T extends Row = Row>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres database.',
    );
  }
  return url;
}

function isNeon(url: string): boolean {
  return url.includes('neon.tech') || url.includes('neon.build');
}

let cached: Query | null = null;
let pool: Pool | null = null;

function build(): Query {
  const url = connectionString();

  if (isNeon(url)) {
    const client = neon(url);
    return (async (strings, ...values) => {
      return (await client(strings, ...values)) as never;
    }) as Query;
  }

  pool ??= new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  return (async (strings, ...values) => {
    // Rebuild the template as $1, $2, ... — values are never inlined.
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    const result = await pool!.query(text, values as unknown[]);
    return result.rows as never;
  }) as Query;
}

/**
 * Usage: `await sql`select * from users where id = ${id}``
 *
 * The interpolated value becomes a bound parameter, never SQL text.
 */
export const sql: Query = ((strings, ...values) => {
  cached ??= build();
  return cached(strings, ...values);
}) as Query;

/** First row, or null. Saves a `[0] ?? null` at every call site. */
export async function one<T extends Row = Row>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}
