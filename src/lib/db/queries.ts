/**
 * Every database access in the app lives here.
 *
 * Keeping it in one file is a security decision as much as a tidiness one:
 * reviewing whether the server can read anything it should not means reading
 * this file, and only this file.
 */

import 'server-only';

import { LIFE, type PigeonPlace, type PigeonState } from '../pigeon/life';
import { LIMITS } from '../server/config';
import { one, sql, type Row } from './client';

// --- users and keys ---------------------------------------------------------

export interface UserRow extends Row {
  id: string;
  signing_key: string;
  identity_key: string;
}

export function findUser(id: string) {
  return one<UserRow>(sql`
    select id, signing_key, identity_key from users where id = ${id}
  `);
}

export async function createUser(input: {
  id: string;
  signingKey: string;
  identityKey: string;
}): Promise<void> {
  await sql`
    insert into users (id, signing_key, identity_key)
    values (${input.id}, ${input.signingKey}, ${input.identityKey})
    on conflict (id) do nothing
  `;
}

export async function upsertSignedPreKey(input: {
  userId: string;
  id: number;
  publicKey: string;
  signature: string;
}): Promise<void> {
  await sql`
    insert into signed_prekeys (user_id, id, public_key, signature)
    values (${input.userId}, ${input.id}, ${input.publicKey}, ${input.signature})
    on conflict (user_id, id) do update
      set public_key = excluded.public_key, signature = excluded.signature
  `;
}

export async function insertOneTimePreKeys(
  userId: string,
  keys: Array<{ id: number; publicKey: string }>,
): Promise<void> {
  if (keys.length === 0) return;

  // Unnest keeps this a single parameterised round trip regardless of batch size.
  await sql`
    insert into one_time_prekeys (user_id, id, public_key)
    select ${userId}, * from unnest(
      ${keys.map((k) => k.id)}::int[],
      ${keys.map((k) => k.publicKey)}::text[]
    )
    on conflict (user_id, id) do nothing
  `;

  // Move the high-water mark up, never down, so pruning used prekeys can never
  // cause an id to be issued twice.
  await sql`
    update users
    set prekey_high_water = greatest(prekey_high_water, ${Math.max(...keys.map((k) => k.id))})
    where id = ${userId}
  `;
}

/**
 * Forget prekeys that have already been used.
 *
 * Once a one-time prekey is claimed the server has no further use for it: the
 * secret half never left the recipient's device, and nothing here reads a
 * claimed row again. Keeping them meant the table grew for ever, one row per
 * letter ever sent, holding nothing anyone needs.
 *
 * A grace period rather than deleting on claim, so that a letter in the middle
 * of being sent is never tripped up by its own prekey vanishing mid-request.
 */
export async function pruneClaimedPreKeys(graceDays = 2): Promise<number> {
  const gone = await sql<{ id: number }>`
    delete from one_time_prekeys
    where claimed_at is not null
      and claimed_at < now() - make_interval(days => ${graceDays})
    returning id
  `;
  return gone.length;
}

export async function countAvailablePreKeys(userId: string): Promise<number> {
  const row = await one<{ n: string }>(sql`
    select count(*) as n from one_time_prekeys
    where user_id = ${userId} and claimed_at is null
  `);
  return Number(row?.n ?? 0);
}

/** The newest signed prekey's id and age, so the client knows when to rotate. */
export function currentSignedPreKey(userId: string) {
  return one<{ id: number; created_at: Date }>(sql`
    select id, created_at from signed_prekeys
    where user_id = ${userId}
    order by created_at desc
    limit 1
  `);
}

/**
 * The highest prekey id ever issued to this account.
 *
 * Reads the stored high-water mark, but also the largest id still present, so
 * an account created before that column existed still gets a safe answer.
 */
export async function highestPreKeyId(userId: string): Promise<number> {
  const row = await one<{ high: number | null }>(sql`
    select greatest(
      u.prekey_high_water,
      coalesce((select max(id) from one_time_prekeys where user_id = u.id), 0)
    ) as high
    from users u where u.id = ${userId}
  `);
  return row?.high ?? 0;
}

export interface BundleRow extends Row {
  user_id: string;
  signing_key: string;
  identity_key: string;
  spk_id: number;
  spk_public_key: string;
  spk_signature: string;
}

/** The newest signed prekey, plus the user's long-term public keys. */
export function findBundleBase(userId: string) {
  return one<BundleRow>(sql`
    select u.id as user_id, u.signing_key, u.identity_key,
           s.id as spk_id, s.public_key as spk_public_key, s.signature as spk_signature
    from users u
    join signed_prekeys s on s.user_id = u.id
    where u.id = ${userId}
    order by s.created_at desc
    limit 1
  `);
}

/**
 * Take one one-time prekey out of the pool.
 *
 * Returns null when the pool is empty, which is not an error — X3DH is still
 * secure without a one-time prekey, it just loses per-message forward secrecy
 * until the recipient's client tops the pool back up.
 *
 * The `claimed_at is null` in the outer predicate is what makes this safe
 * under concurrency: Postgres re-checks it after taking the row lock, so two
 * simultaneous senders can never be handed the same prekey.
 */
export function claimOneTimePreKey(userId: string) {
  return one<{ id: number; public_key: string }>(sql`
    update one_time_prekeys set claimed_at = now()
    where user_id = ${userId}
      and claimed_at is null
      and id = (
        select min(id) from one_time_prekeys
        where user_id = ${userId} and claimed_at is null
      )
    returning id, public_key
  `);
}

// --- sign-in ----------------------------------------------------------------

export async function createChallenge(
  nonce: Uint8Array,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  await sql`
    insert into auth_challenges (nonce, user_id, expires_at)
    values (${Buffer.from(nonce)}, ${userId}, now() + make_interval(secs => ${ttlSeconds}))
  `;
}

/** Single use: deleting and returning in one statement makes replay impossible. */
export function consumeChallenge(nonce: Uint8Array) {
  return one<{ user_id: string }>(sql`
    delete from auth_challenges
    where nonce = ${Buffer.from(nonce)} and expires_at > now()
    returning user_id
  `);
}

export async function createSession(
  tokenHash: Uint8Array,
  userId: string,
  days: number,
): Promise<void> {
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${Buffer.from(tokenHash)}, ${userId}, now() + make_interval(days => ${days}))
  `;
}

export function findSession(tokenHash: Uint8Array) {
  return one<{ user_id: string }>(sql`
    update sessions set last_seen_at = now()
    where token_hash = ${Buffer.from(tokenHash)} and expires_at > now()
    returning user_id
  `);
}

export async function deleteSession(tokenHash: Uint8Array): Promise<void> {
  await sql`delete from sessions where token_hash = ${Buffer.from(tokenHash)}`;
}

/** Housekeeping, run opportunistically rather than on a schedule. */
export async function purgeExpired(): Promise<void> {
  await sql`delete from auth_challenges where expires_at < now()`;
  await sql`delete from sessions where expires_at < now()`;
  await sql`delete from invites where expires_at < now() and redeemed_by is null`;
  await pruneClaimedPreKeys();
}

// --- pairing ----------------------------------------------------------------

export async function countOpenInvites(inviterId: string): Promise<number> {
  const row = await one<{ n: string }>(sql`
    select count(*) as n from invites
    where inviter_id = ${inviterId} and redeemed_by is null and expires_at > now()
  `);
  return Number(row?.n ?? 0);
}

export async function createInvite(
  codeHash: Uint8Array,
  inviterId: string,
  ttlMinutes: number,
): Promise<void> {
  await sql`
    insert into invites (code_hash, inviter_id, expires_at)
    values (${Buffer.from(codeHash)}, ${inviterId}, now() + make_interval(mins => ${ttlMinutes}))
  `;
}

/** Single use, like the challenge: claimed atomically or not at all. */
export function claimInvite(codeHash: Uint8Array, redeemerId: string) {
  return one<{ inviter_id: string }>(sql`
    update invites set redeemed_by = ${redeemerId}, redeemed_at = now()
    where code_hash = ${Buffer.from(codeHash)}
      and redeemed_by is null
      and expires_at > now()
      and inviter_id <> ${redeemerId}
    returning inviter_id
  `);
}

export async function revokeInvites(inviterId: string): Promise<void> {
  await sql`delete from invites where inviter_id = ${inviterId} and redeemed_by is null`;
}

// --- nests ------------------------------------------------------------------

export interface NestRow extends Row {
  id: string;
  low_user_id: string;
  high_user_id: string;
  status: 'pending' | 'active' | 'closed';
  requested_by: string;
  created_at: Date;
  confirmed_at: Date | null;
  partner_signing_key: string;
  partner_identity_key: string;
}

/** Pairs are stored in a fixed order so (a,b) and (b,a) are the same row. */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function createPendingNest(inviterId: string, redeemerId: string) {
  const [low, high] = orderPair(inviterId, redeemerId);
  return one<{ id: string; status: string }>(sql`
    insert into nests (low_user_id, high_user_id, status, requested_by)
    values (${low}, ${high}, 'pending', ${redeemerId})
    on conflict (low_user_id, high_user_id) do update set status = nests.status
    returning id, status
  `);
}

export async function countNests(userId: string): Promise<number> {
  const row = await one<{ n: string }>(sql`
    select count(*) as n from nests
    where (low_user_id = ${userId} or high_user_id = ${userId}) and status <> 'closed'
  `);
  return Number(row?.n ?? 0);
}

export function listNests(userId: string) {
  return sql<NestRow>`
    select n.id, n.low_user_id, n.high_user_id, n.status, n.requested_by,
           n.created_at, n.confirmed_at,
           p.signing_key  as partner_signing_key,
           p.identity_key as partner_identity_key
    from nests n
    join users p
      on p.id = case when n.low_user_id = ${userId} then n.high_user_id else n.low_user_id end
    where (n.low_user_id = ${userId} or n.high_user_id = ${userId})
      and n.status <> 'closed'
    order by n.created_at asc
  `;
}

export function findNest(nestId: string, userId: string) {
  return one<NestRow>(sql`
    select n.id, n.low_user_id, n.high_user_id, n.status, n.requested_by,
           n.created_at, n.confirmed_at,
           p.signing_key  as partner_signing_key,
           p.identity_key as partner_identity_key
    from nests n
    join users p
      on p.id = case when n.low_user_id = ${userId} then n.high_user_id else n.low_user_id end
    where n.id = ${nestId}
      and (n.low_user_id = ${userId} or n.high_user_id = ${userId})
  `);
}

/**
 * Only the person who sent the invite can open the nest, and only for a pair
 * they did not themselves request. That is the consent gate: redeeming a code
 * asks a question, it does not create a conversation.
 */
export function confirmNest(nestId: string, confirmerId: string) {
  return one<{ id: string }>(sql`
    update nests set status = 'active', confirmed_at = now()
    where id = ${nestId}
      and status = 'pending'
      and requested_by <> ${confirmerId}
      and (low_user_id = ${confirmerId} or high_user_id = ${confirmerId})
    returning id
  `);
}

export async function closeNest(nestId: string, userId: string): Promise<void> {
  await sql`
    update nests set status = 'closed'
    where id = ${nestId} and (low_user_id = ${userId} or high_user_id = ${userId})
  `;
}

// --- letters ----------------------------------------------------------------

export interface LetterRow extends Row {
  id: string;
  nest_id: string;
  sender_id: string;
  pigeon_id: string | null;
  header: unknown;
  manifest: string;
  body: string | null;
  mode: 'normal' | 'express';
  departed_at: Date;
  arrives_at: Date;
  opened_at: Date | null;
  reseal_requested_at: Date | null;
}

export function insertLetter(input: {
  nestId: string;
  senderId: string;
  pigeonId: string;
  header: unknown;
  manifest: string;
  body: string;
  mode: string;
  departedAt: Date;
  arrivesAt: Date;
}) {
  return one<{ id: string }>(sql`
    insert into letters
      (nest_id, sender_id, pigeon_id, header, manifest, body, mode, departed_at, arrives_at)
    values (
      ${input.nestId}, ${input.senderId}, ${input.pigeonId}, ${JSON.stringify(input.header)},
      ${input.manifest}, ${input.body}, ${input.mode}, ${input.departedAt}, ${input.arrivesAt}
    )
    returning id
  `);
}

/**
 * Letters in a nest, with the body withheld until the pigeon lands.
 *
 * The gate is in the SQL rather than in application code on purpose: there is
 * no route through this function that returns an undelivered body, whatever a
 * caller passes in.
 */
export function listLetters(nestId: string, limit = 100) {
  return sql<LetterRow>`
    select id, nest_id, sender_id, pigeon_id, header, manifest, mode,
           departed_at, arrives_at, opened_at, reseal_requested_at,
           case when arrives_at <= now() then body else null end as body
    from letters
    where nest_id = ${nestId}
    order by departed_at desc
    limit ${limit}
  `;
}

export function findDeliveredLetter(letterId: string, userId: string) {
  return one<LetterRow>(sql`
    select l.id, l.nest_id, l.sender_id, l.pigeon_id, l.header, l.manifest, l.body, l.mode,
           l.departed_at, l.arrives_at, l.opened_at, l.reseal_requested_at
    from letters l
    join nests n on n.id = l.nest_id
    where l.id = ${letterId}
      and l.arrives_at <= now()
      and (n.low_user_id = ${userId} or n.high_user_id = ${userId})
  `);
}

/** When the next undelivered letter in this nest is due, if any. */
export function nextArrival(nestId: string) {
  return one<{ arrives_at: Date }>(sql`
    select arrives_at from letters
    where nest_id = ${nestId} and arrives_at > now()
    order by arrives_at asc limit 1
  `);
}

export async function markOpened(letterId: string, userId: string): Promise<void> {
  await sql`
    update letters set opened_at = now()
    where id = ${letterId} and opened_at is null and sender_id <> ${userId}
  `;
}

// --- rate limiting ----------------------------------------------------------

/**
 * Fixed-window counter. Returns true when the caller is over the limit.
 *
 * Good enough for the handful of endpoints reachable without a session; the
 * pigeon coop is what actually paces everything else.
 */
export async function isRateLimited(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const row = await one<{ hits: number }>(sql`
    insert into rate_limits (bucket, hits, window_start)
    values (${bucket}, 1, now())
    on conflict (bucket) do update set
      hits = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then 1 else rate_limits.hits + 1
      end,
      window_start = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then now() else rate_limits.window_start
      end
    returning hits
  `);

  return (row?.hits ?? 0) > limit;
}

export { LIFE, LIMITS };

// --- pigeons ----------------------------------------------------------------

export interface PigeonRow extends Row {
  id: string;
  nest_id: string;
  name: string;
  hatched_at: Date;
  holder_id: string | null;
  flying_to: string | null;
  departed_at: Date | null;
  arrives_at: Date | null;
  urges: number;
  stamina: number;
  hunger: number;
  spirits: number;
  vitals_at: Date;
  fed_at: Date | null;
  petted_at: Date | null;
  pets_today: number;
  pets_day_at: Date | null;
  trips: number;
  bond: number;
}

/**
 * Turn a row into the shape the life model understands, from the point of view
 * of whoever is asking. "With you" and "with them" are the same row read by
 * two different people.
 */
export function toPigeonState(row: PigeonRow, viewerId: string): PigeonState {
  const place: PigeonPlace =
    row.flying_to !== null ? 'flying' : row.holder_id === viewerId ? 'with-you' : 'with-them';

  return {
    id: row.id,
    name: row.name,
    hatchedAt: row.hatched_at.getTime(),
    stamina: row.stamina,
    hunger: row.hunger,
    spirits: row.spirits,
    vitalsAt: row.vitals_at.getTime(),
    fedAt: row.fed_at?.getTime() ?? null,
    pettedAt: row.petted_at?.getTime() ?? null,
    petsToday: row.pets_today,
    petsDayAt: row.pets_day_at?.getTime() ?? null,
    trips: row.trips,
    bond: row.bond,
    place,
    arrivesAt: row.arrives_at?.getTime() ?? null,
    urges: row.urges,
  };
}

/**
 * Two birds, one at each end.
 *
 * Hatched when a nest is confirmed, and this is the whole of the pacing
 * system: with one bird each, you can write, and then you wait until she sends
 * one back. Nothing refills on a timer because nothing needs to.
 */
export async function hatchPigeons(
  nestId: string,
  lowUserId: string,
  highUserId: string,
  names: [string, string],
): Promise<void> {
  await sql`
    insert into pigeons (nest_id, name, holder_id)
    select ${nestId}, * from unnest(
      ${[names[0], names[1]]}::text[],
      ${[lowUserId, highUserId]}::text[]
    )
  `;
}

export async function countPigeons(nestId: string): Promise<number> {
  const row = await one<{ n: string }>(sql`
    select count(*) as n from pigeons where nest_id = ${nestId}
  `);
  return Number(row?.n ?? 0);
}

/**
 * Land any bird whose flight time has passed.
 *
 * Done lazily on read rather than by a scheduled job: this app has no worker
 * and does not need one, because a bird that has arrived is simply one whose
 * arrival time is behind us. Idempotent, so calling it on every read is safe.
 */
export async function landArrivals(nestId: string): Promise<string[]> {
  const landed = await sql<{ id: string }>`
    update pigeons
    set holder_id = flying_to,
        flying_to = null,
        departed_at = null,
        arrives_at = null,
        urges = 0,
        trips = trips + 1
    where nest_id = ${nestId}
      and flying_to is not null
      and arrives_at <= now()
    returning id
  `;
  return landed.map((row) => row.id);
}

/*
 * Column lists are written out in full in each query rather than shared
 * through a fragment helper. There is no raw-SQL escape hatch anywhere in this
 * file on purpose: every value is a bound parameter, and keeping it that way
 * means no query can ever be assembled from a string.
 */

export function listPigeons(nestId: string) {
  return sql<PigeonRow>`
    select id, nest_id, name, hatched_at, holder_id, flying_to, departed_at,
           arrives_at, urges, stamina, hunger, spirits, vitals_at, fed_at,
           petted_at, pets_today, pets_day_at, trips, bond
    from pigeons
    where nest_id = ${nestId}
    order by hatched_at asc, id asc
  `;
}

/** One bird, but only if the person asking is actually in her nest. */
export function findPigeon(pigeonId: string, userId: string) {
  return one<PigeonRow>(sql`
    select p.id, p.nest_id, p.name, p.hatched_at, p.holder_id, p.flying_to,
           p.departed_at, p.arrives_at, p.urges, p.stamina, p.hunger, p.spirits,
           p.vitals_at, p.fed_at, p.petted_at, p.pets_today, p.pets_day_at,
           p.trips, p.bond
    from pigeons p
    join nests n on n.id = p.nest_id
    where p.id = ${pigeonId}
      and n.status = 'active'
      and (n.low_user_id = ${userId} or n.high_user_id = ${userId})
  `);
}

export interface VitalsUpdate {
  stamina: number;
  hunger: number;
  spirits: number;
  vitalsAt: number;
}

/**
 * Send her out.
 *
 * Atomic by location: the `holder_id = viewer and flying_to is null` predicate
 * is what makes a double send impossible. The first update clears holder_id,
 * so a second one racing it simply matches nothing.
 *
 * The condition arithmetic happens in the app rather than in SQL because it
 * depends on the bird's traits, and because the flight's length is something
 * the server is not allowed to know.
 */
export function releasePigeon(input: {
  pigeonId: string;
  holderId: string;
  flyingTo: string;
  departedAt: Date;
  arrivesAt: Date;
  vitals: VitalsUpdate;
}) {
  return one<{ id: string }>(sql`
    update pigeons
    set holder_id = null,
        flying_to = ${input.flyingTo},
        departed_at = ${input.departedAt},
        arrives_at = ${input.arrivesAt},
        urges = 0,
        stamina = ${Math.round(input.vitals.stamina)},
        hunger = ${Math.round(input.vitals.hunger)},
        spirits = ${Math.round(input.vitals.spirits)},
        vitals_at = ${new Date(input.vitals.vitalsAt)}
    where id = ${input.pigeonId}
      and holder_id = ${input.holderId}
      and flying_to is null
    returning id
  `);
}

/** Grain. Guarded by the cooldown so it cannot be spammed. */
export function feedPigeon(pigeonId: string, holderId: string, vitals: VitalsUpdate) {
  return one<{ id: string }>(sql`
    update pigeons
    set stamina = ${Math.round(vitals.stamina)},
        hunger = ${Math.round(vitals.hunger)},
        spirits = ${Math.round(vitals.spirits)},
        vitals_at = ${new Date(vitals.vitalsAt)},
        fed_at = now()
    where id = ${pigeonId}
      and holder_id = ${holderId}
      and flying_to is null
      and (fed_at is null or fed_at <= now() - make_interval(hours => ${LIFE.feedCooldownHours}))
    returning id
  `);
}

/**
 * A scratch under the chin.
 *
 * The daily tally rolls over inside the statement, so there is no separate job
 * and no window where yesterday's count blocks today's first pet.
 */
export function petPigeon(pigeonId: string, holderId: string, vitals: VitalsUpdate) {
  return one<{ id: string; pets_today: number }>(sql`
    update pigeons
    set spirits = ${Math.round(vitals.spirits)},
        vitals_at = ${new Date(vitals.vitalsAt)},
        petted_at = now(),
        bond = least(100, bond + ${LIFE.bondPerPet}),
        pets_today = case
          when pets_day_at is null or pets_day_at <= now() - interval '1 day' then 1
          else pets_today + 1
        end,
        pets_day_at = case
          when pets_day_at is null or pets_day_at <= now() - interval '1 day' then now()
          else pets_day_at
        end
    where id = ${pigeonId}
      and holder_id = ${holderId}
      and flying_to is null
      and (
        pets_day_at is null
        or pets_day_at <= now() - interval '1 day'
        or pets_today < ${LIFE.petsPerDay}
      )
    returning id, pets_today
  `);
}

/**
 * Push her to hurry.
 *
 * Only the person who sent her may do this, and only while she is genuinely
 * still in the air. The letter's own arrival is moved separately, and only by
 * the sender, so the server cannot bring a delivery forward on its own.
 */
export function urgePigeon(input: {
  pigeonId: string;
  senderId: string;
  arrivesAt: Date;
  vitals: VitalsUpdate;
}) {
  return one<{ id: string; urges: number }>(sql`
    update pigeons
    set arrives_at = ${input.arrivesAt},
        urges = urges + 1,
        stamina = ${Math.round(input.vitals.stamina)},
        hunger = ${Math.round(input.vitals.hunger)},
        spirits = ${Math.round(input.vitals.spirits)},
        vitals_at = ${new Date(input.vitals.vitalsAt)}
    where id = ${input.pigeonId}
      and flying_to is not null
      and flying_to <> ${input.senderId}
      and arrives_at > now()
      and urges < ${LIFE.maxUrgesPerFlight}
    returning id, urges
  `);
}

export async function renamePigeon(
  pigeonId: string,
  userId: string,
  name: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(sql`
    update pigeons p
    set name = ${name}
    from nests n
    where p.id = ${pigeonId}
      and n.id = p.nest_id
      and (n.low_user_id = ${userId} or n.high_user_id = ${userId})
    returning p.id
  `);
  return row !== null;
}

/**
 * Set the bond on specific birds.
 *
 * Takes explicit ids because bond is earned per bird: an earlier version
 * bumped every bird in the nest whenever any one of them landed, which quietly
 * rewarded the one that had been sitting at home all week.
 */
export async function setBonds(nestId: string, bonds: Array<[string, number]>): Promise<void> {
  if (bonds.length === 0) return;
  await sql`
    update pigeons p
    set bond = least(100, g.bond)
    from unnest(${bonds.map((b) => b[0])}::uuid[], ${bonds.map((b) => b[1])}::int[]) as g(id, bond)
    where p.id = g.id and p.nest_id = ${nestId}
  `;
}

/**
 * Bring a letter's arrival forward, because its carrier was urged on.
 *
 * The header inside the ciphertext still names the original arrival time, and
 * still authenticates it — this only moves the moment the server is willing to
 * hand the body over, and only ever earlier at the sender's own request. A
 * server cannot do this by itself: it has no way to make a client ask.
 */
export async function accelerateLetter(pigeonId: string, savedMs: number): Promise<void> {
  await sql`
    update letters
    set arrives_at = greatest(now(), arrives_at - make_interval(secs => ${savedMs / 1000}))
    where pigeon_id = ${pigeonId} and arrives_at > now()
  `;
}

// --- the world map ----------------------------------------------------------

/**
 * Add one to a city's count. Opt-in, and never tied to a person or a letter.
 *
 * There is no row here that says who chose a city or when a letter moved —
 * only that some number of people have, at some point, said they send from it.
 */
/**
 * Add one to a city's count, once per account, ever.
 *
 * Returns false if this account is already on the map. The membership row is
 * claimed first and atomically: if the insert conflicts, nothing is counted,
 * so no amount of repeat calls can inflate a city past the threshold that is
 * supposed to guarantee several distinct people are behind it.
 */
export async function recordBeacon(userId: string, city: string): Promise<boolean> {
  const claimed = await one<{ user_id: string }>(sql`
    insert into world_members (user_id) values (${userId})
    on conflict (user_id) do nothing
    returning user_id
  `);

  if (!claimed) return false;

  await sql`
    insert into world_beacons (city, senders, updated_at)
    values (${city}, 1, now())
    on conflict (city) do update
      set senders = world_beacons.senders + 1, updated_at = now()
  `;

  return true;
}

export async function hasJoinedWorldMap(userId: string): Promise<boolean> {
  return (await one(sql`select user_id from world_members where user_id = ${userId}`)) !== null;
}

/**
 * Cities with enough senders that nobody is a dot of one.
 *
 * The threshold is the privacy property: a city with two people in it is not
 * shown at all, so appearing on the map never singles anybody out.
 */
export function listBeacons(minimum: number, limit = 200) {
  return sql<{ city: string; senders: number }>`
    select city, senders from world_beacons
    where senders >= ${minimum}
    order by senders desc
    limit ${limit}
  `;
}

// --- repairing a letter nobody can open -------------------------------------

/** The sender's own view of one letter, for checking a repair against. */
export function findLetterForSender(letterId: string, senderId: string) {
  return one<{
    id: string;
    nest_id: string;
    sender_id: string;
    mode: string;
    departed_at: Date;
    arrives_at: Date;
  }>(sql`
    select l.id, l.nest_id, l.sender_id, l.mode, l.departed_at, l.arrives_at
    from letters l
    join nests n on n.id = l.nest_id
    where l.id = ${letterId}
      and l.sender_id = ${senderId}
      and (n.low_user_id = ${senderId} or n.high_user_id = ${senderId})
      and n.status = 'active'
  `);
}


/**
 * Ask the sender to seal this one again.
 *
 * Only the recipient may ask, and only inside their own active nest. The
 * request carries no reason and no key material: the server neither knows nor
 * needs to know why the words would not open.
 *
 * Deliberately allowed while the pigeon is still flying. The manifest is
 * released on departure, so a device that has lost its keys finds out it
 * cannot read this letter long before it lands — and repairing it then means
 * it is readable the moment it arrives, rather than arriving broken and
 * needing a second round trip to fix.
 */
export async function requestReseal(letterId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    update letters set reseal_requested_at = now()
    where id = ${letterId}
      and sender_id <> ${userId}
      and nest_id in (
        select id from nests
        where (low_user_id = ${userId} or high_user_id = ${userId}) and status = 'active'
      )
    returning id
  `;
  return rows.length === 1;
}

/**
 * Replace a letter's ciphertext with one sealed for the keys the recipient
 * holds now.
 *
 * Everything about the journey stays as it was: the same row, the same bird,
 * the same departure and the same arrival. Only the session header and the
 * two ciphertexts change, because only they were addressed to the key that
 * went missing. `opened_at` is cleared so the letter can be collected again,
 * and the request is cleared with it.
 *
 * The timing columns are matched in the predicate rather than written, so a
 * caller cannot use a repair to move a letter through time.
 */
export async function resealLetter(input: {
  letterId: string;
  senderId: string;
  header: unknown;
  manifest: string;
  body: string;
  departedAt: Date;
  arrivesAt: Date;
}): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    update letters set
      header = ${JSON.stringify(input.header)}::jsonb,
      manifest = ${input.manifest},
      body = ${input.body},
      opened_at = null,
      reseal_requested_at = null
    where id = ${input.letterId}
      and sender_id = ${input.senderId}
      and departed_at = ${input.departedAt}
      and arrives_at = ${input.arrivesAt}
    returning id
  `;
  return rows.length === 1;
}

// --- the archive ------------------------------------------------------------

export interface ArchiveEntryRow extends Row {
  letter_id: string;
  blob: string;
  updated_at: Date;
}

/**
 * Every letter this account has kept, as ciphertext.
 *
 * Nothing here is readable without the owner's recovery phrase, so there is no
 * filtering to do beyond the account itself.
 */
export function listArchiveEntries(userId: string) {
  return sql<ArchiveEntryRow>`
    select letter_id, blob, updated_at
    from archive_entries
    where user_id = ${userId}
    order by updated_at desc
  `;
}

/**
 * Keep a letter, or replace the copy already kept.
 *
 * Last write wins, which is right for a blob whose plaintext only its owner
 * can produce: two devices re-sealing the same letter write equivalent
 * content, so there is nothing to reconcile.
 */
export async function putArchiveEntries(
  userId: string,
  entries: readonly { letterId: string; blob: string }[],
): Promise<void> {
  for (const entry of entries) {
    await sql`
      insert into archive_entries (user_id, letter_id, blob, updated_at)
      values (${userId}, ${entry.letterId}, ${entry.blob}, now())
      on conflict (user_id, letter_id)
      do update set blob = excluded.blob, updated_at = now()
    `;
  }
}

/**
 * Drop the one-time prekeys nobody has taken yet.
 *
 * For a device that has lost its secrets: the public halves still on the
 * server are worse than useless, because the next letter would be sealed
 * against one and arrive unopenable. Claimed keys are deliberately left
 * alone — they belong to letters already in flight, and their ids must stay
 * spent so the high-water mark never reissues one.
 */
export async function deleteUnclaimedPreKeys(userId: string): Promise<number> {
  const rows = await sql<{ id: number }>`
    delete from one_time_prekeys
    where user_id = ${userId} and claimed_at is null
    returning id
  `;
  return rows.length;
}

/** How many letters this account is keeping. */
export async function countArchiveEntries(userId: string): Promise<number> {
  const row = await one<{ n: string }>(sql`
    select count(*) as n from archive_entries where user_id = ${userId}
  `);
  return Number(row?.n ?? 0);
}
