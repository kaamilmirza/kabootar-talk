/**
 * The failure that used to lose letters outright.
 *
 * Prekey secrets are random, not derived from the recovery phrase, so a
 * cleared browser cannot rebuild them. Everything else survives a wipe — the
 * identity, the nests, the kept letters — but a letter sealed for that browser
 * arrives unopenable, and no amount of typing the twelve words brings it back.
 *
 * Two things have to hold, and both are checked here. A device that comes back
 * without its keys has to say so and take new ones, otherwise every future
 * letter fails the same way in silence. And the letter that was already in the
 * air has to be recoverable, because the sender still has the words.
 *
 *   KABOOTAR_E2E=http://localhost:3000 npm test
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { openManifest, sealLetter, type EnvelopeHeader } from '../crypto/envelope';
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
import { plannedDurationMs } from '../flight/schedule';

const BASE = process.env.KABOOTAR_E2E;
const describeE2E = BASE ? describe : describe.skip;

const TORONTO = { lat: 43.6532, lon: -79.3832, label: 'Toronto' };
const HYDERABAD = { lat: 17.385, lon: 78.4867, label: 'Hyderabad' };

interface Bird {
  id: string;
  place: string;
  stamina: number;
}

class Device {
  cookie = '';
  signedPreKey!: { record: PreKeyRecord; signature: string };
  oneTimePreKeys: PreKeyRecord[] = [];

  constructor(
    readonly identity: Identity,
    readonly phrase: string,
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

  /** What a restored client does: new signed prekey, new pool, dead pool cleared. */
  async reKey(signedPreKeyId: number, startId: number, count = 20): Promise<void> {
    this.signedPreKey = createSignedPreKey(this.identity, signedPreKeyId);
    this.oneTimePreKeys = createOneTimePreKeys(count, startId + 1);

    const { status, body } = await this.post('/api/keys', {
      signedPreKey: {
        id: this.signedPreKey.record.id,
        publicKey: this.signedPreKey.record.publicKey,
        signature: this.signedPreKey.signature,
      },
      oneTimePreKeys: this.oneTimePreKeys.map((k) => ({ id: k.id, publicKey: k.publicKey })),
      replaceOneTimePreKeys: true,
    });
    expect(status, JSON.stringify(body)).toBe(200);
  }

  secretFor(signedPreKeyId: number, oneTimePreKeyId: number | null) {
    const oneTime = this.oneTimePreKeys.find((k) => k.id === oneTimePreKeyId);
    return {
      signedPreKeySecret: this.signedPreKey.record.secretKey,
      ...(oneTime ? { oneTimePreKeySecret: oneTime.secretKey } : {}),
    };
  }
}

describeE2E('a letter sealed for a device that no longer exists', { timeout: 180_000 }, () => {
  const writer = Device.create();
  const reader = Device.create();

  let nestId = '';
  let letterId = '';
  let departedAt = 0;
  let arrivesAt = 0;

  const words = 'This one was sealed for a browser that does not exist any more.';

  async function seal(bundle: PreKeyBundle, when: { departedAt: number; arrivesAt: number }) {
    const session = initiateSession(writer.identity, bundle);
    const header: EnvelopeHeader = {
      v: 1,
      nestId,
      senderId: writer.identity.id,
      session: session.header,
      departedAt: when.departedAt,
      arrivesAt: when.arrivesAt,
      mode: 'normal',
    };
    const sealed = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest: { from: TORONTO, to: HYDERABAD, mode: 'normal' },
      body: { text: words, writtenAt: when.departedAt },
    });
    return { header, manifest: sealed.manifest, body: sealed.body };
  }

  beforeAll(async () => {
    await writer.register();
    await reader.register();

    const code = generateInviteCode();
    const codeHash = b64(hashInviteCode(code));
    await writer.post('/api/nests/invite', { codeHash });
    const redeemed = await reader.post<{ nestId: string }>('/api/nests/redeem', { codeHash });
    nestId = redeemed.body.nestId;
    await writer.post(`/api/nests/${nestId}`);
  });

  it('is sent normally, sealed for the keys the reader has today', async () => {
    const flock = await writer.call<{ flock: Bird[] }>(`/api/nests/${nestId}`);
    const bird = flock.body.flock.find((p) => p.place === 'with-you')!;

    const bundle = await writer.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    departedAt = Date.now();
    arrivesAt = departedAt + plannedDurationMs(distanceKm(TORONTO, HYDERABAD), 'normal');

    const { header, manifest, body } = await seal(bundle.body, { departedAt, arrivesAt });

    const sent = await writer.post<{ id: string }>(`/api/nests/${nestId}/letters`, {
      pigeonId: bird.id,
      staminaAfter: Math.max(0, bird.stamina - flightCost(distanceKm(TORONTO, HYDERABAD))),
      header,
      manifest,
      body,
    });

    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    letterId = sent.body.id;
  });

  it('re-keys when the reader returns on a wiped device', async () => {
    // Same twelve words and nothing else, which is the restore path exactly.
    const wiped = new Device(identityFromPhrase(reader.phrase), reader.phrase);
    await wiped.signIn();

    const before = await wiped.call<{ preKeys: { nextId: number } }>('/api/me');
    await wiped.reKey(2, before.body.preKeys.nextId);

    const after = await wiped.call<{
      preKeys: { available: number; nextId: number };
      signedPreKey: { id: number };
    }>('/api/me');

    expect(after.body.signedPreKey.id, 'a new signed prekey is advertised').toBe(2);
    expect(after.body.preKeys.available, 'the dead pool is replaced, not added to').toBe(20);
    expect(
      after.body.preKeys.nextId,
      'ids only ever climb, so nothing in flight can be mismatched to a new secret',
    ).toBeGreaterThanOrEqual(before.body.preKeys.nextId);

    reader.signedPreKey = wiped.signedPreKey;
    reader.oneTimePreKeys = wiped.oneTimePreKeys;
    reader.cookie = wiped.cookie;
  });

  it('cannot be opened by the wiped device, which asks for a repair', async () => {
    const inbox = await reader.call<{ letters: { id: string; header: EnvelopeHeader }[] }>(
      `/api/nests/${nestId}/letters`,
    );
    const raw = inbox.body.letters.find((l) => l.id === letterId)!;

    expect(
      reader.oneTimePreKeys.some((k) => k.id === raw.header.session.oneTimePreKeyId),
      'the letter names a key this device has never held',
    ).toBe(false);

    expect((await reader.post(`/api/letters/${letterId}/reseal-request`)).status).toBe(200);
  });

  it('will not let the reader repair a letter they received', async () => {
    const bundle = await writer.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const { header, manifest, body } = await seal(bundle.body, { departedAt, arrivesAt });

    const { status } = await reader.post(`/api/letters/${letterId}/reseal`, {
      header,
      manifest,
      body,
    });
    expect(status).toBe(404);
  });

  it('will not let a stranger ask for a repair', async () => {
    const stranger = Device.create();
    await stranger.register();
    expect((await stranger.post(`/api/letters/${letterId}/reseal-request`)).status).toBe(404);
  });

  it('will not let a repair move the letter through time', async () => {
    const bundle = await writer.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    const { header, manifest, body } = await seal(bundle.body, {
      departedAt,
      arrivesAt: arrivesAt - 3_600_000, // an hour sooner
    });

    const { status } = await writer.post(`/api/letters/${letterId}/reseal`, {
      header,
      manifest,
      body,
    });
    expect(status).toBe(400);
  });

  it('is repaired from the sender’s own copy, and opens', async () => {
    const bundle = await writer.post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
    expect(bundle.body.signedPreKeyId, 'sealed against the reader’s new key').toBe(2);

    const { header, manifest, body } = await seal(bundle.body, { departedAt, arrivesAt });

    const repaired = await writer.post(`/api/letters/${letterId}/reseal`, {
      header,
      manifest,
      body,
    });
    expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);

    const inbox = await reader.call<{
      letters: {
        id: string;
        header: EnvelopeHeader;
        manifest: string;
        departedAt: number;
        arrivesAt: number;
        resealRequested: boolean;
      }[];
    }>(`/api/nests/${nestId}/letters`);

    const raw = inbox.body.letters.find((l) => l.id === letterId)!;

    expect(raw.departedAt, 'the journey it already made is untouched').toBe(departedAt);
    expect(raw.arrivesAt).toBe(arrivesAt);
    expect(raw.resealRequested, 'the request is cleared once it is answered').toBe(false);

    const accepted = acceptSession({
      self: reader.identity,
      senderIdentityKey: toPublicIdentity(writer.identity).identityKey,
      header: raw.header.session,
      ...reader.secretFor(raw.header.session.signedPreKeyId, raw.header.session.oneTimePreKeyId),
    });

    const opener = {
      sharedSecret: accepted.sharedSecret,
      associatedData: accepted.associatedData,
      header: raw.header,
    };

    expect(openManifest(opener, raw.manifest).to.label).toBe('Hyderabad');
  });

  it('still refuses to hand over the body before the pigeon lands', async () => {
    // The repair must not have opened an early door.
    const early = await reader.call<{ error: string }>(`/api/letters/${letterId}`);
    expect(early.status).toBe(425);
  });
});
