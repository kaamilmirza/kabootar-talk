#!/usr/bin/env node
/**
 * Applies src/lib/db/schema.sql.
 *
 * The schema is written to be idempotent (every statement is `if not exists`),
 * so this is safe to run repeatedly and on every deploy. Small project, no
 * migration framework — just one file that describes the whole database.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  console.error('Copy .env.example to .env.local and point it at a Postgres database.');
  process.exit(1);
}

const schemaPath = fileURLToPath(new URL('../src/lib/db/schema.sql', import.meta.url));
const schema = await readFile(schemaPath, 'utf8');

/*
 * `--reset` drops everything first.
 *
 * The schema is create-if-not-exists throughout, which is right for applying
 * it repeatedly but cannot reshape a table that already exists. Rather than
 * carry a migration framework for a two-person app, a reset is offered
 * explicitly — and it refuses to run unless you mean it, because it destroys
 * every letter in the database.
 */
const reset = process.argv.includes('--reset');

const DROP = `
  drop table if exists archive_entries, world_beacons, rate_limits, letters, pigeons, nests,
    invites, sessions, auth_challenges, one_time_prekeys, signed_prekeys, users cascade;
`;

if (reset && process.env.KABOOTAR_CONFIRM_RESET !== 'yes') {
  console.error('Refusing to reset without KABOOTAR_CONFIRM_RESET=yes.');
  console.error('This deletes every account and every letter in the database.');
  process.exit(1);
}

const isNeon = url.includes('neon.tech') || url.includes('neon.build');

try {
  if (isNeon) {
    // The HTTP driver runs one statement per request, so split on statement
    // boundaries. Comments are stripped first so a `;` inside one is ignored.
    const statements = schema
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    const client = neon(url);
    if (reset) await client.query(DROP);
    for (const statement of statements) {
      await client.query(statement);
    }
    console.log(`Applied ${statements.length} statements to Neon.`);
  } else {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    if (reset) await client.query(DROP);
    await client.query(schema);
    await client.end();
    console.log('Applied schema to Postgres.');
  }

  console.log('The coop is ready.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
