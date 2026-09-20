/**
 * The whole thing, played out at speed, against a real server and a real
 * database — every way a person can lose a device in the middle of it.
 *
 * The end-to-end suite proves each piece in isolation. This proves the pieces
 * survive each other: a letter that lands, gets read, gets archived, and then
 * has the ground pulled out from under it. Flights that really take a day are
 * fast-forwarded by moving the arrival time in the database, which is exactly
 * what the server's delivery gate reads. The sealed header is left untouched,
 * so every decryption here is the same work the real client does.
 *
 * Local only, and it refuses to run anywhere else — it writes directly to the
 * database and would be destructive against anything real.
 *
 *   KABOOTAR_E2E=http://localhost:3000 npx vitest run src/lib/server/scenarios.local.test.ts
 */

import { neon } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openBody, openManifest, sealLetter, type EnvelopeHeader } from '../crypto/envelope';
import { openArchiveEntry, sealArchiveEntry, type ArchivedLetter } from '../crypto/archive';
import { generateInviteCode, hashInviteCode } from '../crypto/invite';
import {
  generateRecoveryPhrase,
  identityFromPhrase,
  sign,
  toPublicIdentity,
  type Identity,
} from '../crypto/identity';
import { b64, concat, unb64, utf8 } from '../crypto/primitives';
import {
  acceptSession,
  createOneTimePreKeys,
  createSignedPreKey,
  initiateSession,
  type PreKeyBundle,
  type PreKeyRecord,
} from '../crypto/x3dh';
import { distanceKm } from '../flight/geo';
import { flightCost } from '../pigeon/life';

const BASE = process.env.KABOOTAR_E2E;
const DB = process.env.DATABASE_URL;

/*
 * Two locks, because this file moves arrival times by hand. It runs only
 * against a server on this machine, and only when a database is reachable.
 */
const local = BASE && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && DB;
const describeLocal = local ? describe : describe.skip;

const sql = local ? neon(DB!) : (null as never);

const TORONTO = { lat: 43.6532, lon: -79.3832, label: 'Toronto' };
const HYDERABAD = { lat: 17.385, lon: 78.4867, label: 'Hyderabad' };
const KM = distanceKm(TORONTO, HYDERABAD);

/** Express, at its legal minimum, so the flight is short before we shorten it. */
const HALF_HOUR = 1_800_000;

interface Bird {
  id: string;
  name: string;
  place: string;
  stamina: number;
  canFly: boolean;
}

class Device {
  cookie = '';
  signedPreKey!: { record: PreKeyRecord; signature: string };
  oneTimePreKeys: PreKeyRecord[] = [];
  /** What this device has read and kept, as the real archive would hold it. */
  archive = new Map<string, ArchivedLetter>();

  constructor(
    readonly identity: Identity,
    readonly phrase: string,
    readonly label: string,
  ) {}

  static create(label: string): Device {
    const phrase = generateRecoveryPhrase();
    return new Device(identityFromPhrase(phrase), phrase, label);
  }

  /** A second device for the same person: same words, nothing else carried over. */
  static restore(from: Device, label: string): Device {
    return new Device(identityFromPhrase(from.phrase), from.phrase, label);
  }

  async call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }

  post<T>(path: string, payload?: unknown) {
    return this.call<T>(path, {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  async register(): Promise<void> {
    this.signedPreKey = createSignedPreKey(this.identity, 1);
    this.oneTimePreKeys = createOneTimePreKeys(20, 1);
    const pub = toPublicIdentity(this.identity);
    const { status } = await this.post('/api/register', {
      signingKey: pub.signingKey,
      identityKey: pub.identityKey,
      signedPreKey: {
        id: this.signedPreKey.record.id,
        publicKey: this.signedPreKey.record.publicKey,
        signature: this.signedPreKey.signature,
      },
      oneTimePreKeys: this.oneTimePreKeys.map((k) => ({ id: k.id, publicKey: k.publicKey })),
    });
    expect(status).toBe(200);
  }

  async signIn(): Promise<void> {
    const { body } = await this.post<{ nonce: string }>('/api/auth/challenge', {
      userId: this.identity.id,
    });
    const signature = sign(this.identity, concat(utf8('kabootar/auth/v1'), unb64(body.nonce)));
    const { status } = await this.post('/api/auth/verify', {
      userId: this.identity.id,
      nonce: body.nonce,
      signature: b64(signature),
    });
    expect(status).toBe(200);
  }

  /**
   * Exactly what the client does on sign-in: if this device holds no secret
   * for the signed prekey the server advertises, take new keys.
   */
  async signInAndHeal(): Promise<'healthy' | 're-keyed'> {
    await this.signIn();

    const me = await this.call<{
      preKeys: { nextId: number; batchSize: number };
      signedPreKey: { id: number };
    }>('/api/me');

    const advertised = me.body.signedPreKey.id;
    const holdsIt = this.signedPreKey?.record.id === advertised;
    if (holdsIt) return 'healthy';

    this.signedPreKey = createSignedPreKey(this.identity, advertised + 1);
    this.oneTimePreKeys = createOneTimePreKeys(20, me.body.preKeys.nextId + 1);

    const { status } = await this.post('/api/keys', {
      signedPreKey: {
        id: this.signedPreKey.record.id,
        publicKey: this.signedPreKey.record.publicKey,
        signature: this.signedPreKey.signature,
      },
      oneTimePreKeys: this.oneTimePreKeys.map((k) => ({ id: k.id, publicKey: k.publicKey })),
      replaceOneTimePreKeys: true,
    });
    expect(status).toBe(200);
    return 're-keyed';
  }

  /** Pull the kept letters down, as a restored device does. */
  async syncArchive(): Promise<number> {
    const { body } = await this.call<{ entries: { letterId: string; blob: string }[] }>(
      '/api/archive',
    );
    let pulled = 0;
    for (const entry of body.entries) {
      if (this.archive.has(entry.letterId)) continue;
      const opened = openArchiveEntry(this.identity, entry.letterId, entry.blob);
      if (opened) {
        this.archive.set(entry.letterId, opened);
        pulled += 1;
      }
    }
    return pulled;
  }

  async keep(letter: ArchivedLetter): Promise<void> {
    this.archive.set(letter.letterId, letter);
    const { status } = await this.post('/api/archive', {
      entries: [{ letterId: letter.letterId, blob: sealArchiveEntry(this.identity, letter) }],
    });
    expect(status).toBe(200);
  }

  secretFor(signedPreKeyId: number, oneTimePreKeyId: number | null) {
    if (this.signedPreKey.record.id !== signedPreKeyId) return null;
    if (oneTimePreKeyId === null) {
      return { signedPreKeySecret: this.signedPreKey.record.secretKey };
    }
    const oneTime = this.oneTimePreKeys.find((k) => k.id === oneTimePreKeyId);
    if (!oneTime) return null;
    return {
      signedPreKeySecret: this.signedPreKey.record.secretKey,
      oneTimePreKeySecret: oneTime.secretKey,
    };
  }
}

// --- the world, sped up ------------------------------------------------------

/*
 * Everything below writes to whatever database this machine is pointed at,
 * and that is very often the real one. So every statement is scoped to the
 * nest these tests created, by id. Nothing here may touch a letter it did not
 * write, and `guardOthers` checks afterwards that nothing did.
 */

/** Land this nest's flights, the way a day of waiting would. */
async function fastForward(nestId: string): Promise<void> {
  // Departure moves with arrival: the table insists a letter lands after it
  // leaves, which is exactly the constraint you want and exactly the one a
  // naive fast-forward trips over.
  await sql`
    update letters
    set departed_at = now() - interval '1 hour',
        arrives_at = now() - interval '5 seconds'
    where nest_id = ${nestId} and arrives_at > now()
  `;
  await sql`
    update pigeons
    set departed_at = now() - interval '1 hour',
        arrives_at = now() - interval '5 seconds'
    where nest_id = ${nestId} and arrives_at is not null and arrives_at > now()
  `;
}

/** Make this nest's birds fit to fly again, the way a night of rest would. */
async function rest(nestId: string): Promise<void> {
  await sql`
    update pigeons
    set stamina = 100, hunger = 0, spirits = 100, vitals_at = now(), urges = 0
    where nest_id = ${nestId}
  `;
}

/**
 * Put a rested bird in someone's hands.
 *
 * The bird economy is real and is tested properly elsewhere: two kabootars
 * shuttle, and when they are both at the far end you genuinely cannot write.
 * That is the point of the app, and it is also not what these tests are
 * about — they are about what happens to the words when a device dies. So the
 * later scenarios place a bird rather than spending several round trips
 * walking one back across the world.
 */
async function readyBird(nestId: string, holderId: string): Promise<void> {
  await sql`
    update pigeons
    set holder_id = ${holderId},
        flying_to = null,
        departed_at = null,
        arrives_at = null,
        stamina = 100,
        hunger = 0,
        spirits = 100,
        vitals_at = now(),
        urges = 0
    where id = (select id from pigeons where nest_id = ${nestId} order by hatched_at limit 1)
  `;
}

/** Every letter that existed before these tests, and its exact state. */
async function snapshotOthers() {
  const rows = (await sql`
    select id, arrives_at, opened_at, octet_length(body) as b from letters
  `) as { id: string; arrives_at: Date; opened_at: Date | null; b: number }[];

  return rows.map((r) => ({
    id: r.id,
    arrivesAt: r.arrives_at.toISOString(),
    openedAt: r.opened_at?.toISOString() ?? null,
    bytes: Number(r.b),
  }));
}

describeLocal('a whole correspondence, and every way to lose a device', { timeout: 300_000 }, () => {
  const toronto = Device.create('Toronto phone');
  const hyderabad = Device.create('Hyderabad phone');

  let nestId = '';
  const sent: Record<string, { id: string; text: string; header: EnvelopeHeader }> = {};

  /** Write a letter, for real, through the API. */
  async function write(
    from: Device,
    label: string,
    text: string,
    from_: typeof TORONTO,
    to: typeof TORONTO,
  ) {
    const flock = await from.call<{ flock: Bird[] }>(`/api/nests/${nestId}`);
    const bird = flock.body.flock.find((p) => p.place === 'with-you' && p.canFly);
    expect(bird, `${from.label} should have a bird to send`).toBeDefined();

    const bundle = await from.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    expect(bundle.status, JSON.stringify(bundle.body)).toBe(200);

    const session = initiateSession(from.identity, bundle.body);
    const departedAt = Date.now();
    const arrivesAt = departedAt + HALF_HOUR;

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: from.identity.id,
      session: session.header,
      departedAt,
      arrivesAt,
      mode: 'express',
    };

    const manifest = { from: from_, to, mode: 'express' as const };
    const sealed = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest,
      body: { text, writtenAt: departedAt },
    });

    const result = await from.post<{ id: string }>(`/api/nests/${nestId}/letters`, {
      pigeonId: bird!.id,
      staminaAfter: Math.max(0, bird!.stamina - flightCost(KM)),
      header,
      manifest: sealed.manifest,
      body: sealed.body,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);

    // The sender keeps their own copy, which is what makes a repair possible.
    await from.keep({
      letterId: result.body.id,
      nestId,
      direction: 'sent',
      text,
      writtenAt: departedAt,
      departedAt,
      arrivesAt,
      manifest,
    });

    sent[label] = { id: result.body.id, text, header };
    return result.body.id;
  }

  /** Read a landed letter the way the client does, archiving what opens. */
  async function read(
    by: Device,
    letterId: string,
  ): Promise<{ text: string } | { blocked: 'no-key' | 'in-flight' }> {
    const inbox = await by.call<{
      letters: { id: string; mine: boolean; header: EnvelopeHeader; manifest: string; body: string | null; departedAt: number; arrivesAt: number }[];
    }>(`/api/nests/${nestId}/letters`);

    const raw = inbox.body.letters.find((l) => l.id === letterId)!;
    if (!raw.body) return { blocked: 'in-flight' };

    const secrets = by.secretFor(
      raw.header.session.signedPreKeyId,
      raw.header.session.oneTimePreKeyId,
    );
    if (!secrets) {
      await by.post(`/api/letters/${letterId}/reseal-request`);
      return { blocked: 'no-key' };
    }

    const partner = raw.header.senderId === toronto.identity.id ? toronto : hyderabad;
    const accepted = acceptSession({
      self: by.identity,
      senderIdentityKey: toPublicIdentity(partner.identity).identityKey,
      header: raw.header.session,
      ...secrets,
    });

    const opener = {
      sharedSecret: accepted.sharedSecret,
      associatedData: accepted.associatedData,
      header: raw.header,
    };

    const manifest = openManifest(opener, raw.manifest);
    const body = openBody(opener, raw.body);

    await by.keep({
      letterId,
      nestId,
      direction: 'received',
      text: body.text,
      writtenAt: body.writtenAt,
      departedAt: raw.departedAt,
      arrivesAt: raw.arrivesAt,
      manifest,
    });

    return { text: body.text };
  }

  /** The sender answering a repair request from their own kept copy. */
  async function repair(by: Device, letterId: string): Promise<void> {
    const kept = by.archive.get(letterId);
    expect(kept, 'the sender must still have the words').toBeDefined();

    /*
     * The timings come from the server's copy of the letter, not from the
     * archive. The real client does the same, and it matters: the archive
     * records what the sender believed when they wrote it, while the row is
     * the journey of record. A repair has to match the row exactly.
     */
    const inbox = await by.call<{
      letters: { id: string; departedAt: number; arrivesAt: number; mode: 'normal' | 'express' }[];
    }>(`/api/nests/${nestId}/letters`);
    const current = inbox.body.letters.find((l) => l.id === letterId)!;

    const bundle = await by.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const session = initiateSession(by.identity, bundle.body);

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: by.identity.id,
      session: session.header,
      departedAt: current.departedAt,
      arrivesAt: current.arrivesAt,
      mode: current.mode,
    };

    const sealed = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: kept!.manifest,
      body: { text: kept!.text, writtenAt: kept!.writtenAt },
    });

    const { status, body } = await by.post(`/api/letters/${letterId}/reseal`, {
      header,
      manifest: sealed.manifest,
      body: sealed.body,
    });
    expect(status, JSON.stringify(body)).toBe(200);
  }

  let others: Awaited<ReturnType<typeof snapshotOthers>> = [];

  beforeAll(async () => {
    // Anything already in this database belongs to somebody real.
    others = await snapshotOthers();

    await toronto.register();
    await hyderabad.register();

    const code = generateInviteCode();
    const codeHash = b64(hashInviteCode(code));
    await toronto.post('/api/nests/invite', { codeHash });
    const redeemed = await hyderabad.post<{ nestId: string }>('/api/nests/redeem', { codeHash });
    nestId = redeemed.body.nestId;
    await toronto.post(`/api/nests/${nestId}`);
  });

  afterAll(async () => {
    if (!local) return;

    for (const id of [toronto.identity.id, hyderabad.identity.id]) {
      await sql`delete from users where id = ${id}`;
    }

    // Nothing that existed before may have moved. Arrival times especially:
    // landing somebody's real letter early would be unrecoverable.
    const after = new Map((await snapshotOthers()).map((l) => [l.id, l]));
    for (const was of others) {
      const is = after.get(was.id);
      expect(is, `pre-existing letter ${was.id} disappeared`).toBeDefined();
      expect(is, `pre-existing letter ${was.id} was modified`).toEqual(was);
    }
  });

  it('carries a letter there and an answer back', async () => {
    const first = await write(toronto, 'first', 'The lake has gone grey and it is only September.', TORONTO, HYDERABAD);

    // Still flying: the body is withheld, whatever the reader does.
    expect(await read(hyderabad, first)).toEqual({ blocked: 'in-flight' });

    await fastForward(nestId);
    expect(await read(hyderabad, first)).toEqual({
      text: 'The lake has gone grey and it is only September.',
    });

    await rest(nestId);
    const reply = await write(hyderabad, 'reply', 'It is still 31 degrees here. The roof is done.', HYDERABAD, TORONTO);

    await fastForward(nestId);
    expect(await read(toronto, reply)).toEqual({
      text: 'It is still 31 degrees here. The roof is done.',
    });
  });

  it('gives a wiped device its whole history back', async () => {
    // The Hyderabad phone is dropped in a river. New laptop, same twelve words.
    const laptop = Device.restore(hyderabad, 'Hyderabad laptop');
    expect(await laptop.signInAndHeal()).toBe('re-keyed');

    const pulled = await laptop.syncArchive();
    expect(pulled, 'both letters come back, sent and received').toBe(2);

    const texts = [...laptop.archive.values()].map((l) => l.text).sort();
    expect(texts).toEqual(
      [
        'It is still 31 degrees here. The roof is done.',
        'The lake has gone grey and it is only September.',
      ].sort(),
    );
  });

  it('repairs a letter that was in the air when the device died', async () => {
    await readyBird(nestId, toronto.identity.id);
    const inFlight = await write(toronto, 'inflight', 'This one was flying when the phone died.', TORONTO, HYDERABAD);

    // Hyderabad loses the device mid-flight and comes back on a new one.
    const replacement = Device.restore(hyderabad, 'Hyderabad replacement');
    expect(await replacement.signInAndHeal()).toBe('re-keyed');
    await replacement.syncArchive();

    await fastForward(nestId);

    // Sealed for keys that no longer exist anywhere.
    expect(await read(replacement, inFlight)).toEqual({ blocked: 'no-key' });

    // The sender still has the words, so the letter is repaired and opens.
    await repair(toronto, inFlight);
    expect(await read(replacement, inFlight)).toEqual({
      text: 'This one was flying when the phone died.',
    });
  });

  it('survives both people losing their devices at once', async () => {
    await readyBird(nestId, toronto.identity.id);
    const crossing = await write(toronto, 'crossing', 'Both phones are about to be replaced.', TORONTO, HYDERABAD);

    const newToronto = Device.restore(toronto, 'Toronto replacement');
    const newHyderabad = Device.restore(hyderabad, 'Hyderabad second replacement');

    expect(await newToronto.signInAndHeal()).toBe('re-keyed');
    expect(await newHyderabad.signInAndHeal()).toBe('re-keyed');

    // Each pulls their own history down before anything else.
    await newToronto.syncArchive();
    await newHyderabad.syncArchive();

    await fastForward(nestId);
    expect(await read(newHyderabad, crossing)).toEqual({ blocked: 'no-key' });

    // The sender's replacement device repairs it from the synced archive,
    // having never held the original keys itself.
    await repair(newToronto, crossing);
    expect(await read(newHyderabad, crossing)).toEqual({
      text: 'Both phones are about to be replaced.',
    });
  });

  it('never loses a letter across repeated device changes', async () => {
    let writer = toronto;
    let reader = hyderabad;

    for (let round = 0; round < 3; round += 1) {
      await readyBird(nestId, writer.identity.id);
      const text = `Round ${round}: still here, still arriving.`;
      const id = await write(writer, `round-${round}`, text, TORONTO, HYDERABAD);

      // Both sides change device every round, mid-flight.
      writer = Device.restore(writer, `writer-${round}`);
      reader = Device.restore(reader, `reader-${round}`);
      await writer.signInAndHeal();
      await reader.signInAndHeal();
      await writer.syncArchive();
      await reader.syncArchive();

      await fastForward(nestId);

      let result = await read(reader, id);
      if ('blocked' in result) {
        await repair(writer, id);
        result = await read(reader, id);
      }

      expect(result, `round ${round} must arrive intact`).toEqual({ text });

      // Swap directions so both sides take a turn writing.
      [writer, reader] = [reader, writer];
    }
  });

  it('still refuses to hand over a letter before it lands', async () => {
    await readyBird(nestId, toronto.identity.id);
    const late = await write(toronto, 'late', 'Not yet.', TORONTO, HYDERABAD);
    expect(await read(hyderabad, late)).toEqual({ blocked: 'in-flight' });

    const direct = await hyderabad.call(`/api/letters/${late}`);
    expect(direct.status, 'the gate is in SQL, not in the client').toBe(425);
  });
});
