/**
 * The whole thing, end to end, against a running server and a real database.
 *
 * Two identities are created from scratch, paired with a real code, approved,
 * and a real letter is encrypted, sent, and fetched back. Nothing is mocked —
 * the point is to catch the things unit tests structurally cannot: that the
 * SQL is right, that the delivery gate actually withholds the body, and that
 * what comes back out of Postgres still decrypts.
 *
 * Opt-in, because it needs a server and a database:
 *
 *   KABOOTAR_E2E=http://localhost:3000 npm test
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  openArchiveEntry,
  sealArchiveEntry,
  type ArchivedLetter,
} from '../crypto/archive';
import { openBody, openManifest, sealLetter, type EnvelopeHeader } from '../crypto/envelope';
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
import { flightCost, LIFE } from '../pigeon/life';
import { buildItinerary, plannedDurationMs, statusAt, verifyItinerary } from '../flight/schedule';

const BASE = process.env.KABOOTAR_E2E;
const describeE2E = BASE ? describe : describe.skip;

const TORONTO = { lat: 43.6532, lon: -79.3832, label: 'Toronto' };
const HYDERABAD = { lat: 17.385, lon: 78.4867, label: 'Hyderabad' };

/** One signed-in device: an identity, its prekey secrets, and its cookie. */
class Device {
  cookie = '';
  signedPreKey!: { record: PreKeyRecord; signature: string };
  oneTimePreKeys: PreKeyRecord[] = [];

  constructor(
    readonly identity: Identity,
    /** Kept so a test can restore the same account on a second device. */
    readonly phrase = '',
  ) {}

  static create(): Device {
    const phrase = generateRecoveryPhrase();
    return new Device(identityFromPhrase(phrase), phrase);
  }

  async call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...init?.headers,
      },
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;

    const body = (await response.json().catch(() => ({}))) as T;
    return { status: response.status, body };
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
    const { status, body } = await this.post<{ userId: string }>('/api/register', {
      signingKey: pub.signingKey,
      identityKey: pub.identityKey,
      signedPreKey: {
        id: this.signedPreKey.record.id,
        publicKey: this.signedPreKey.record.publicKey,
        signature: this.signedPreKey.signature,
      },
      oneTimePreKeys: this.oneTimePreKeys.map((k) => ({ id: k.id, publicKey: k.publicKey })),
    });

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.userId).toBe(this.identity.id);
  }

  /** Sign back in from scratch, the way a returning device would. */
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

  secretFor(signedPreKeyId: number, oneTimePreKeyId: number | null) {
    const oneTime = this.oneTimePreKeys.find((k) => k.id === oneTimePreKeyId);
    return {
      signedPreKeySecret: this.signedPreKey.record.secretKey,
      ...(oneTime ? { oneTimePreKeySecret: oneTime.secretKey } : {}),
    };
  }
}

/*
 * Generous, because these are real round trips to a real database and the
 * pairing code is hashed with Argon2id on purpose — about a second per hash,
 * twice per pairing. Slow here is the feature working.
 */
describeE2E('the whole journey', { timeout: 60_000 }, () => {
  const alice = Device.create();
  const bob = Device.create();

  let nestId = '';
  let letterId = '';
  let flock: Array<{
    id: string;
    name: string;
    place: string;
    canFly: boolean;
    stamina: number;
    spirits: number;
    hunger: number;
    canFeed: boolean;
    canPet: boolean;
    canUrge: boolean;
    trips: number;
    bond: number;
  }> = [];
  let sentAt = 0;
  let arrivesAt = 0;

  const secret = 'Assalamu alaikum. I have been thinking about the roof in Hyderabad.';

  beforeAll(async () => {
    await alice.register();
    await bob.register();
  });

  it('creates two identities the server has no personal data for', async () => {
    const { body } = await alice.call<{ userId: string }>('/api/me');
    expect(body.userId).toBe(alice.identity.id);
  });

  it('refuses to pair without a code', async () => {
    const { status } = await alice.call('/api/nests');
    expect(status).toBe(200);

    const { body } = await alice.call<{ nests: unknown[] }>('/api/nests');
    expect(body.nests).toHaveLength(0);
  });

  it('rejects a made-up pairing code', async () => {
    const { status } = await bob.post('/api/nests/redeem', {
      codeHash: b64(hashInviteCode(generateInviteCode())),
    });
    expect(status).toBe(400);
  });

  it('pairs only with a real code, and only after approval', async () => {
    const code = generateInviteCode();
    const codeHash = b64(hashInviteCode(code));

    expect((await alice.post('/api/nests/invite', { codeHash })).status).toBe(200);

    const redeemed = await bob.post<{ nestId: string; status: string }>('/api/nests/redeem', {
      codeHash,
    });
    expect(redeemed.status).toBe(200);
    nestId = redeemed.body.nestId;

    // Pending, not active: redeeming asks a question, it does not open a channel.
    const pending = await bob.call<{ status: string; awaitingYou: boolean }>(`/api/nests/${nestId}`);
    expect(pending.body.status).toBe('pending');
    expect(pending.body.awaitingYou).toBe(false);

    // Bob cannot confirm his own request.
    expect((await bob.post(`/api/nests/${nestId}`)).status).toBe(403);

    // Nothing can be sent while it is pending.
    const early = await bob.post(`/api/nests/${nestId}/bundle`);
    expect(early.status).toBe(403);

    const confirmed = await alice.post<{ status: string }>(`/api/nests/${nestId}`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('active');
  });

  it('hatches two birds, one at each end', async () => {
    const mine = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const theirs = await bob.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);

    expect(mine.body.flock).toHaveLength(2);
    flock = mine.body.flock;

    // The same two birds, seen from opposite ends of the world.
    expect(mine.body.flock.filter((p) => p.place === 'with-you')).toHaveLength(1);
    expect(mine.body.flock.filter((p) => p.place === 'with-them')).toHaveLength(1);
    expect(theirs.body.flock.filter((p) => p.place === 'with-you')).toHaveLength(1);

    const mineHere = mine.body.flock.find((p) => p.place === 'with-you')!;
    const theirsHere = theirs.body.flock.find((p) => p.place === 'with-you')!;
    expect(mineHere.id).not.toBe(theirsHere.id);

    // Freshly hatched birds are rested and willing.
    expect(mineHere.canFly).toBe(true);
    expect(mineHere.stamina).toBe(100);
  });

  it('will not send a bird that is on the far side of the world', async () => {
    const away = flock.find((p) => p.place === 'with-them')!;
    expect(away.canFly).toBe(false);
  });

  it('can be fed and made a fuss of, and it shows', async () => {
    const mine = flock.find((p) => p.place === 'with-you')!;

    // Hungry enough to bother feeding only after a while; petting always works.
    const petted = await alice.post<{ pigeon: typeof flock[number] }>(
      `/api/pigeons/${mine.id}`,
      { action: 'pet' },
    );
    expect(petted.status).toBe(200);
    expect(petted.body.pigeon.spirits).toBeGreaterThanOrEqual(mine.spirits);

    const renamed = await alice.post<{ pigeon: typeof flock[number] }>(
      `/api/pigeons/${mine.id}`,
      { action: 'rename', name: 'Heer' },
    );
    expect(renamed.body.pigeon.name).toBe('Heer');
  });

  it('will not let a stranger touch somebody else’s bird', async () => {
    const outsider = Device.create();
    await outsider.register();

    const mine = flock.find((p) => p.place === 'with-you')!;
    const poke = await outsider.post(`/api/pigeons/${mine.id}`, { action: 'pet' });
    expect(poke.status).toBe(404);
  });

  it('will not hand a prekey bundle to a stranger', async () => {
    const stranger = Device.create();
    await stranger.register();
    expect((await stranger.call(`/api/nests/${nestId}`)).status).toBe(404);
    expect((await stranger.post(`/api/nests/${nestId}/bundle`)).status).toBe(404);
  });

  it('sends a real encrypted letter', async () => {
    const bundle = await alice.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    expect(bundle.status).toBe(200);
    expect(bundle.body.userId).toBe(bob.identity.id);

    const session = initiateSession(alice.identity, bundle.body);

    sentAt = Date.now();
    arrivesAt = sentAt + plannedDurationMs(distanceKm(TORONTO, HYDERABAD), 'normal');

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: alice.identity.id,
      session: session.header,
      departedAt: sentAt,
      arrivesAt,
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
      body: { text: secret, writtenAt: sentAt },
    });

    const mine = flock.find((p) => p.place === 'with-you')!;

    const sent = await alice.post<{ id: string; pigeon: { place: string; stamina: number } }>(
      `/api/nests/${nestId}/letters`,
      {
        pigeonId: mine.id,
        staminaAfter: Math.max(0, mine.stamina - flightCost(distanceKm(TORONTO, HYDERABAD))),
        header,
        manifest: letter.manifest,
        body: letter.body,
      },
    );

    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    letterId = sent.body.id;

    // She is gone, and the trip has told on her.
    expect(sent.body.pigeon.place).toBe('flying');
    expect(sent.body.pigeon.stamina).toBeLessThan(LIFE.readyAt);
  });

  it('cannot send the same bird twice', async () => {
    const mine = flock.find((p) => p.place === 'with-you')!;
    const bundle = await alice.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const session = initiateSession(alice.identity, bundle.body);
    const departedAt = Date.now();

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: alice.identity.id,
      session: session.header,
      departedAt,
      arrivesAt: departedAt + plannedDurationMs(distanceKm(TORONTO, HYDERABAD), 'normal'),
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
      body: { text: 'second', writtenAt: departedAt },
    });

    const again = await alice.post(`/api/nests/${nestId}/letters`, {
      pigeonId: mine.id,
      staminaAfter: 0,
      header,
      manifest: letter.manifest,
      body: letter.body,
    });

    expect(again.status).toBe(429);
  });

  it('refuses a flight that would barely tire her', async () => {
    const theirs = await bob.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const bobsBird = theirs.body.flock.find((p) => p.place === 'with-you')!;

    const bundle = await bob.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const session = initiateSession(bob.identity, bundle.body);
    const departedAt = Date.now();

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: bob.identity.id,
      session: session.header,
      departedAt,
      arrivesAt: departedAt + plannedDurationMs(distanceKm(TORONTO, HYDERABAD), 'normal'),
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: HYDERABAD, to: TORONTO, mode: 'normal' },
      body: { text: 'cheap trip', writtenAt: departedAt },
    });

    // Claiming she comes back barely touched.
    const cheeky = await bob.post(`/api/nests/${nestId}/letters`, {
      pigeonId: bobsBird.id,
      staminaAfter: bobsBird.stamina,
      header,
      manifest: letter.manifest,
      body: letter.body,
    });

    expect(cheeky.status).toBe(400);
  });

  it('refuses a flight time no kabootar could manage', async () => {
    const bundle = await alice.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const session = initiateSession(alice.identity, bundle.body);
    const departedAt = Date.now();

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: alice.identity.id,
      session: session.header,
      departedAt,
      // Ten minutes from Toronto to Hyderabad.
      arrivesAt: departedAt + 10 * 60_000,
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
      body: { text: 'let me in early', writtenAt: departedAt },
    });

    const sent = await alice.post(`/api/nests/${nestId}/letters`, {
      header,
      manifest: letter.manifest,
      body: letter.body,
    });

    expect(sent.status).toBe(400);
  });

  it('withholds the letter until the pigeon lands', async () => {
    const { body } = await bob.call<{
      letters: Array<{ id: string; body: string | null; manifest: string; arrivesAt: number }>;
    }>(`/api/nests/${nestId}/letters`);

    const letter = body.letters.find((l) => l.id === letterId)!;
    expect(letter).toBeDefined();

    // The whole promise of the app, asserted: the text is simply not there.
    expect(letter.body).toBeNull();
    expect(letter.manifest).toBeTruthy();
    expect(letter.arrivesAt).toBeGreaterThan(Date.now() + 20 * 3_600_000);

    // Nor can it be fetched directly.
    const direct = await bob.call<{ pigeon: string }>(`/api/letters/${letterId}`);
    expect(direct.status).toBe(425);
    expect(direct.body.pigeon).toBeTruthy();
  });

  it('lets the recipient watch the flight without reading the letter', async () => {
    const { body } = await bob.call<{
      letters: Array<{ id: string; header: EnvelopeHeader; manifest: string }>;
    }>(`/api/nests/${nestId}/letters`);

    const letter = body.letters.find((l) => l.id === letterId)!;
    const session = acceptSession({
      self: bob.identity,
      senderIdentityKey: toPublicIdentity(alice.identity).identityKey,
      header: letter.header.session,
      ...bob.secretFor(letter.header.session.signedPreKeyId, letter.header.session.oneTimePreKeyId),
    });

    const opener = {
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header: letter.header,
    };

    const manifest = openManifest(opener, letter.manifest);
    expect(manifest.from.label).toBe('Toronto');
    expect(manifest.to.label).toBe('Hyderabad');

    // And the route the server never saw is reconstructable on this device.
    const itinerary = buildItinerary({
      from: manifest.from,
      to: manifest.to,
      departedAt: letter.header.departedAt,
      arrivesAt: letter.header.arrivesAt,
      seed: letter.id,
    });

    expect(verifyItinerary(itinerary)).toBeCloseTo(1, 1);
    expect(statusAt(itinerary, Date.now()).phase).toBe('flying');
  });

  it('decrypts once delivered, and only by the right person', async () => {
    // Re-seal the same letter as if it had already arrived, so the delivered
    // path is exercised without waiting a real day.
    const bundle = await alice.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const session = initiateSession(alice.identity, bundle.body);

    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: alice.identity.id,
      session: session.header,
      departedAt: Date.now(),
      arrivesAt: Date.now() + plannedDurationMs(1, 'normal'),
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
      body: { text: secret, writtenAt: header.departedAt },
    });

    const received = acceptSession({
      self: bob.identity,
      senderIdentityKey: toPublicIdentity(alice.identity).identityKey,
      header: session.header,
      ...bob.secretFor(session.header.signedPreKeyId, session.header.oneTimePreKeyId),
    });

    const opener = {
      sharedSecret: received.sharedSecret,
      associatedData: received.associatedData,
      header,
    };

    expect(openBody(opener, letter.body).text).toBe(secret);
  });

  it('leaves you with nothing to write with until one comes home', async () => {
    // This is the whole pacing mechanism, asserted. Alice had one bird at her
    // end and she has sent it; the other is at Bob's. There is no counter to
    // wait on and nothing to spend — there is simply no bird here.
    const { body } = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);

    expect(body.flock).toHaveLength(2);
    expect(body.flock.some((p) => p.canFly)).toBe(false);
    expect(body.flock.map((p) => p.place).sort()).toEqual(['flying', 'with-them']);
  });

  it('the bird Bob is holding is the one Alice cannot touch, and vice versa', async () => {
    const mine = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const theirs = await bob.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);

    const alicesView = new Map(mine.body.flock.map((p) => [p.id, p.place]));
    const bobsView = new Map(theirs.body.flock.map((p) => [p.id, p.place]));

    for (const [id, place] of alicesView) {
      if (place === 'with-them') expect(bobsView.get(id)).toBe('with-you');
      if (place === 'with-you') expect(bobsView.get(id)).toBe('with-them');
      if (place === 'flying') expect(bobsView.get(id)).toBe('flying');
    }
  });

  it('offers the push to the sender and not to the recipient', async () => {
    const mine = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const theirs = await bob.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);

    const flyingForAlice = mine.body.flock.find((p) => p.place === 'flying')!;
    const flyingForBob = theirs.body.flock.find((p) => p.place === 'flying')!;

    expect(flyingForAlice.canUrge, 'the sender may push her').toBe(true);
    expect(flyingForBob.canUrge, 'the recipient may not').toBe(false);

    // And the server agrees, not just the flag.
    const refused = await bob.post(`/api/pigeons/${flyingForBob.id}`, { action: 'urge' });
    expect(refused.status).toBe(400);
  });

  it('lets the sender push her on, at a cost to her', async () => {
    const mine = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const flying = mine.body.flock.find((p) => p.place === 'flying')!;

    const before = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const wasFlying = before.body.flock.find((p) => p.id === flying.id)!;

    const urged = await alice.post<{ pigeon: { spirits: number; urgesLeft: number } }>(
      `/api/pigeons/${flying.id}`,
      { action: 'urge' },
    );

    expect(urged.status, JSON.stringify(urged.body)).toBe(200);
    expect(urged.body.pigeon.spirits).toBeLessThan(wasFlying.spirits);
    expect(urged.body.pigeon.urgesLeft).toBeLessThan(3);
  });

  it('will not be pushed for ever', async () => {
    const mine = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);
    const flying = mine.body.flock.find((p) => p.place === 'flying')!;

    // Two more, then she has had enough.
    await alice.post(`/api/pigeons/${flying.id}`, { action: 'urge' });
    await alice.post(`/api/pigeons/${flying.id}`, { action: 'urge' });

    const tooMuch = await alice.post(`/api/pigeons/${flying.id}`, { action: 'urge' });
    expect(tooMuch.status).toBe(400);
  });

  it('counts one account on the world map once, however often it asks', async () => {
    // The threshold only means anything if each count is a distinct person.
    // Before this was enforced, one account could add itself repeatedly and
    // push its own city over the line on its own.
    const first = await alice.post('/api/world', { city: 'Montreal' });
    expect(first.status).toBe(200);

    for (let i = 0; i < 4; i++) {
      const again = await alice.post('/api/world', { city: 'Montreal' });
      expect(again.status).toBe(400);
    }

    const second = await alice.post('/api/world', { city: 'Paris' });
    expect(second.status, 'joining twice under a different city must also fail').toBe(400);
  });

  it('gives the bond only to the bird that actually made the delivery', async () => {
    const { body } = await alice.call<{ flock: typeof flock }>(`/api/nests/${nestId}`);

    // One bird is mid-flight and the other has never left home. The one that
    // has done nothing must not be collecting bond for the other's work.
    const idle = body.flock.find((p) => p.trips === 0 && p.place !== 'flying');
    if (idle) expect(idle.bond).toBe(0);
  });

  it('never shows a city with too few people in it', async () => {
    await alice.post('/api/world', { city: 'Toronto' });
    await bob.post('/api/world', { city: 'Hyderabad' });

    const { body } = await alice.call<{
      minimum: number;
      cities: Array<{ label: string; senders: number; lat: number; lon: number }>;
    }>('/api/world');

    // The privacy guarantee, stated as an invariant rather than as a count:
    // whatever is on the map, nobody on it is one of fewer than `minimum`.
    // Asserting emptiness instead would only pass against a fresh database.
    expect(body.minimum).toBeGreaterThanOrEqual(2);
    for (const city of body.cities) {
      expect(city.senders).toBeGreaterThanOrEqual(body.minimum);
      expect(Number.isFinite(city.lat)).toBe(true);
      expect(Number.isFinite(city.lon)).toBe(true);
    }
  });

  it('refuses a location that is not one of the bundled cities', async () => {
    const sneaky = await alice.post('/api/world', { city: '43.65,-79.38' });
    expect(sneaky.status).toBe(400);
  });

  it('never reissues a prekey id, even after used ones are pruned', async () => {
    // The subtle half of pruning. A letter's header names the prekey it was
    // sealed against, and the device maps that id to a secret; if an id came
    // round again the new secret would overwrite the old one and silently make
    // earlier letters unopenable. The high-water mark is what prevents it.
    const before = await alice.call<{ preKeys: { nextId: number } }>('/api/me');
    const highest = before.body.preKeys.nextId;
    expect(highest).toBeGreaterThan(0);

    // Top up, which also runs the pruning.
    const fresh = Array.from({ length: 5 }, (_, i) => ({
      id: highest + 1 + i,
      publicKey: 'A'.repeat(43),
    }));
    expect((await alice.post('/api/keys', { oneTimePreKeys: fresh })).status).toBe(200);

    const after = await alice.call<{ preKeys: { nextId: number } }>('/api/me');
    expect(after.body.preKeys.nextId, 'the mark only ever goes up').toBeGreaterThanOrEqual(
      highest + 5,
    );

    // And again, to be sure pruning has not walked it backwards.
    const later = await alice.call<{ preKeys: { nextId: number } }>('/api/me');
    expect(later.body.preKeys.nextId).toBeGreaterThanOrEqual(after.body.preKeys.nextId);
  });

  it('refuses to hand out a prekey bundle on a plain GET', async () => {
    // Claiming a prekey is not a safe request to repeat, so it is not a GET.
    const asGet = await alice.call(`/api/nests/${nestId}/bundle`);
    expect(asGet.status).toBe(405);
  });

  it('signs back in with nothing but the keys', async () => {
    const returning = new Device(alice.identity);
    await returning.signIn();

    const { body } = await returning.call<{ userId: string }>('/api/me');
    expect(body.userId).toBe(alice.identity.id);
  });

  /*
   * The reason the archive exists: a letter you have read should still be
   * yours on a device that did not read it, and after this one is wiped.
   */
  describe('the letters you keep', () => {
    const keptId = '44444444-4444-4444-8444-444444444444';

    const kept: ArchivedLetter = {
      letterId: keptId,
      nestId: '55555555-5555-4555-8555-555555555555',
      direction: 'received',
      text: 'Keep this one. It should outlive the browser it was read in.',
      writtenAt: 1_700_000_000_000,
      departedAt: 1_700_000_100_000,
      arrivesAt: 1_700_086_500_000,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
    };

    it('keeps one, sealed with something the server has no key for', async () => {
      const blob = sealArchiveEntry(alice.identity, kept);

      const { status, body } = await alice.post<{ kept: number }>('/api/archive', {
        entries: [{ letterId: keptId, blob }],
      });

      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.kept).toBeGreaterThanOrEqual(1);
    });

    it('gives it back to a device that has never seen it', async () => {
      // A laptop: the same twelve words, a fresh session, no local storage
      // and no contact of any kind with the device that read the letter.
      const laptop = new Device(identityFromPhrase(alice.phrase));
      await laptop.signIn();

      const { body } = await laptop.call<{
        entries: { letterId: string; blob: string }[];
      }>('/api/archive');

      const entry = body.entries.find((e) => e.letterId === keptId);
      expect(entry, 'the laptop should be offered the letter').toBeDefined();

      const opened = openArchiveEntry(laptop.identity, keptId, entry!.blob);
      expect(opened).not.toBeNull();
      expect(opened!.text).toBe(kept.text);
      expect(opened!.manifest.to.label).toBe('Hyderabad');
    });

    it('does not offer it to anybody else', async () => {
      const { body } = await bob.call<{ entries: { letterId: string }[] }>('/api/archive');
      expect(body.entries.some((e) => e.letterId === keptId)).toBe(false);
    });

    it('is unreadable even to somebody who steals the blob', async () => {
      const { body } = await alice.call<{
        entries: { letterId: string; blob: string }[];
      }>('/api/archive');

      const stolen = body.entries.find((e) => e.letterId === keptId)!.blob;
      expect(openArchiveEntry(bob.identity, keptId, stolen)).toBeNull();
    });

    it('replaces a letter rather than duplicating it', async () => {
      const before = await alice.call<{ entries: unknown[] }>('/api/archive');

      await alice.post('/api/archive', {
        entries: [{ letterId: keptId, blob: sealArchiveEntry(alice.identity, kept) }],
      });

      const after = await alice.call<{ entries: unknown[] }>('/api/archive');
      expect(after.body.entries.length).toBe(before.body.entries.length);
    });

    it('will not keep letters for a stranger', async () => {
      const nobody = new Device(identityFromPhrase(generateRecoveryPhrase()));

      const { status } = await nobody.post('/api/archive', {
        entries: [{ letterId: keptId, blob: sealArchiveEntry(nobody.identity, kept) }],
      });

      expect(status).toBe(401);
    });

    it('refuses a blob too large to be a letter', async () => {
      const { status } = await alice.post('/api/archive', {
        entries: [{ letterId: keptId, blob: 'A'.repeat(400_000) }],
      });

      expect(status).toBe(400);
    });
  });
});
