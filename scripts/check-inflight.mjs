#!/usr/bin/env node
/**
 * Is every letter still in the air still openable?
 *
 * Not "does the app work" — that is what the tests are for. This asks a
 * narrower and more paranoid question: for each letter nobody has read yet,
 * is everything it depends on still exactly as it was?
 *
 * A letter names three things: a version, a signed prekey, and a one-time
 * prekey. If the version changes, the reading path changes under it. If the
 * signed prekey row vanishes, the sender can no longer repair it. If an id
 * could ever be issued twice, a new secret would overwrite the old one and
 * the letter would decrypt to nothing. Each of those is checked here.
 *
 * Run it before a deploy and again after:
 *
 *   node scripts/check-inflight.mjs            # report
 *   node scripts/check-inflight.mjs --save      # record the current state
 *   node scripts/check-inflight.mjs --compare   # fail if anything drifted
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = neon(url);
const baselinePath = fileURLToPath(new URL('../.inflight-baseline.json', import.meta.url));

const save = process.argv.includes('--save');
const compare = process.argv.includes('--compare');

const letters = await sql`
  select l.id, l.sender_id, l.nest_id, l.header, l.arrives_at, l.opened_at,
         octet_length(l.body) as body_bytes,
         octet_length(l.manifest) as manifest_bytes
  from letters l
  where l.opened_at is null
  order by l.arrives_at
`;

const problems = [];
const state = [];

for (const letter of letters) {
  const header = typeof letter.header === 'string' ? JSON.parse(letter.header) : letter.header;
  const session = header.session;

  const [nest] = await sql`
    select low_user_id, high_user_id from nests where id = ${letter.nest_id}
  `;

  if (!nest) {
    problems.push(`${letter.id}: its nest is gone`);
    continue;
  }

  const recipient =
    nest.low_user_id === letter.sender_id ? nest.high_user_id : nest.low_user_id;

  const spk = await sql`
    select id from signed_prekeys
    where user_id = ${recipient} and id = ${session.signedPreKeyId}
  `;

  const [user] = await sql`
    select prekey_high_water from users where id = ${recipient}
  `;

  const [maxRow] = await sql`
    select coalesce(max(id), 0) as m from one_time_prekeys where user_id = ${recipient}
  `;

  const nextId = Math.max(user?.prekey_high_water ?? 0, Number(maxRow?.m ?? 0));

  // The three things that would make this letter unreadable.
  if (header.v !== 1) {
    problems.push(`${letter.id}: header version is ${header.v}, expected 1`);
  }
  if (spk.length === 0) {
    problems.push(
      `${letter.id}: the signed prekey it names (${session.signedPreKeyId}) is no longer published, so it cannot be repaired`,
    );
  }
  if (session.oneTimePreKeyId !== null && nextId < session.oneTimePreKeyId) {
    problems.push(
      `${letter.id}: prekey id ${session.oneTimePreKeyId} could be issued again (next id is ${nextId})`,
    );
  }

  state.push({
    id: letter.id,
    v: header.v,
    signedPreKeyId: session.signedPreKeyId,
    oneTimePreKeyId: session.oneTimePreKeyId,
    bodyBytes: letter.body_bytes,
    manifestBytes: letter.manifest_bytes,
    arrivesAt: letter.arrives_at.toISOString(),
  });
}

console.log(`Letters still in the air: ${letters.length}\n`);
for (const s of state) {
  console.log(
    `  ${s.id.slice(0, 8)}  v${s.v}  spk ${s.signedPreKeyId}  otp ${s.oneTimePreKeyId}  ` +
      `${s.bodyBytes}b body  lands ${s.arrivesAt.slice(11, 16)} UTC`,
  );
}

if (save) {
  writeFileSync(baselinePath, JSON.stringify(state, null, 1));
  console.log(`\nRecorded ${state.length} letters as the baseline.`);
}

if (compare) {
  if (!existsSync(baselinePath)) {
    console.error('\nNo baseline to compare against. Run with --save first.');
    process.exit(1);
  }

  const before = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const now = new Map(state.map((s) => [s.id, s]));

  for (const was of before) {
    const is = now.get(was.id);

    // Opened is fine — that is the letter doing its job. Changed is not.
    if (!is) {
      console.log(`\n  ${was.id.slice(0, 8)} is no longer in the air (opened, most likely).`);
      continue;
    }

    for (const key of ['v', 'signedPreKeyId', 'oneTimePreKeyId', 'bodyBytes', 'manifestBytes', 'arrivesAt']) {
      if (is[key] !== was[key]) {
        problems.push(`${was.id}: ${key} changed from ${was[key]} to ${is[key]}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\nPROBLEMS:\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('\nEvery letter in the air is intact.');
