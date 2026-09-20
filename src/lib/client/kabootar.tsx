'use client';

/**
 * The single place client state and the send/receive flow live.
 *
 * Reading this file top to bottom shows exactly what the device does with your
 * keys: derives them from the phrase in memory, uses them, and never writes an
 * unwrapped copy anywhere.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  openBody,
  openManifest,
  sealLetter,
  type EnvelopeHeader,
  type FlightManifest,
  type LetterBody,
  type Place,
} from '../crypto/envelope';
import {
  generateRecoveryPhrase,
  identityFromPhrase,
  safetyCheck,
  sign,
  toPublicIdentity,
  type Identity,
  type PublicIdentity,
  type SafetyCheck,
} from '../crypto/identity';
import { b64, concat, unb64, utf8 } from '../crypto/primitives';
import { generateInviteCode } from '../crypto/invite';
import { hashInviteCodeAsync } from './invite';
import { acceptSession, initiateSession, type PreKeyBundle } from '../crypto/x3dh';
import { buildItinerary, plannedDurationMs, type FlightMode } from '../flight/schedule';
import { distanceKm } from '../flight/geo';
import { effectiveSpeed, flightCost, type Mood } from '../pigeon/life';

import { ApiError, del, get, now, post } from './api';
import {
  archiveLetter,
  keepLetter,
  readArchive,
  syncArchive,
  type ArchivedLetter,
} from './archive';
import {
  burnOneTimePreKey,
  generateInitialPreKeys,
  generateMoreOneTimePreKeys,
  preKeySecretsFor,
  rotateSignedPreKey,
} from './prekeys';
import { placesFor, rememberPlaces, type NestPlaces } from './places';
import { wipeEverything } from './idb';
import {
  hasVault,
  PIN_LENGTH,
  saveWithPasskey,
  saveWithPin,
  unlock,
  vaultMethod,
  type UnlockMethod,
} from './vault';

const AUTH_CONTEXT = 'kabootar/auth/v1';

// --- shapes the server returns ----------------------------------------------

/** A kabootar, as she is right now. */
export interface Pigeon {
  id: string;
  name: string;
  hatchedAt: number;
  place: 'with-you' | 'with-them' | 'flying';
  arrivesAt: number | null;
  /** True only for the person who sent her: only they may push her on. */
  canUrge: boolean;
  trips: number;
  bond: number;
  urges: number;
  traits: Array<{ id: string; name: string; note: string }>;
  stamina: number;
  hunger: number;
  spirits: number;
  mood: Mood;
  canFly: boolean;
  blockedBecause: 'tired' | 'unwilling' | 'flying' | 'away' | null;
  readyAt: number | null;
  canFeed: boolean;
  canPet: boolean;
  urgesLeft: number;
}

export interface Me {
  userId: string;
  signingKey: string;
  identityKey: string;
  limits: { maxNests: number; worldMapMinimum: number };
  preKeys: { available: number; needsTopUp: boolean; batchSize: number; nextId: number };
  signedPreKey: { id: number; needsRotation: boolean };
}

export interface Nest {
  id: string;
  status: 'pending' | 'active' | 'closed';
  partner: PublicIdentity;
  awaitingYou: boolean;
  createdAt: number;
  confirmedAt: number | null;
}

interface RawLetter {
  id: string;
  senderId: string;
  mine: boolean;
  pigeonId: string | null;
  pigeonName: string | null;
  header: EnvelopeHeader;
  manifest: string;
  body: string | null;
  mode: FlightMode;
  departedAt: number;
  arrivesAt: number;
  openedAt: number | null;
}

export interface Letter {
  id: string;
  mine: boolean;
  /** The bird who carried it, so her traits shape the journey shown. */
  pigeonId: string | null;
  pigeonName: string | null;
  mode: FlightMode;
  departedAt: number;
  arrivesAt: number;
  openedAt: number | null;
  manifest: FlightManifest | null;
  /** Null while the pigeon is still flying. */
  text: string | null;
  writtenAt: number | null;
  status: 'flying' | 'landed' | 'locked';
}

export type Status = 'loading' | 'needs-setup' | 'locked' | 'ready';

interface KabootarValue {
  status: Status;
  identity: Identity | null;
  me: Me | null;
  nests: Nest[];
  unlockMethod: UnlockMethod | null;
  error: string | null;

  createPhrase: () => string;
  finishSetup: (phrase: string, options: { method: UnlockMethod; pin?: string; label?: string }) => Promise<void>;
  unlockDevice: (pin?: string) => Promise<void>;
  restoreFromPhrase: (phrase: string, options: { method: UnlockMethod; pin?: string; label?: string }) => Promise<void>;
  lock: () => void;
  forgetDevice: () => Promise<void>;

  refresh: () => Promise<void>;
  createInvite: () => Promise<string>;
  redeemInvite: (code: string) => Promise<void>;
  confirmNest: (nestId: string) => Promise<void>;
  closeNest: (nestId: string) => Promise<void>;

  safetyFor: (nest: Nest) => SafetyCheck | null;
  places: (nestId: string) => Promise<NestPlaces | null>;
  setPlaces: (nestId: string, places: NestPlaces) => Promise<void>;

  loadLetters: (nestId: string) => Promise<Letter[]>;
  loadFlock: (nestId: string) => Promise<Pigeon[]>;
  /** Feed her, make a fuss of her, push her on, or give her a new name. */
  tend: (
    pigeonId: string,
    action: 'feed' | 'pet' | 'urge' | 'rename',
    name?: string,
  ) => Promise<Pigeon>;
  sendLetter: (input: {
    nestId: string;
    pigeon: Pigeon;
    text: string;
    mode: FlightMode;
    from: Place;
    to: Place;
  }) => Promise<void>;
}

const KabootarContext = createContext<KabootarValue | null>(null);

export function useKabootar(): KabootarValue {
  const value = useContext(KabootarContext);
  if (!value) throw new Error('useKabootar must be used inside <KabootarProvider>.');
  return value;
}

export function KabootarProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [nests, setNests] = useState<Nest[]>([]);
  const [unlockMethod, setUnlockMethod] = useState<UnlockMethod | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref as well so async flows can use it without stale closures.
  const identityRef = useRef<Identity | null>(null);
  const setBoth = (next: Identity | null) => {
    identityRef.current = next;
    setIdentity(next);
  };

  useEffect(() => {
    void (async () => {
      const method = await vaultMethod();
      setUnlockMethod(method);
      setStatus((await hasVault()) ? 'locked' : 'needs-setup');
    })();
  }, []);

  // --- server session -------------------------------------------------------

  const signIn = useCallback(async (id: Identity): Promise<boolean> => {
    const { nonce } = await post<{ nonce: string }>('/api/auth/challenge', { userId: id.id });
    const signature = sign(id, concat(utf8(AUTH_CONTEXT), unb64(nonce)));

    try {
      await post('/api/auth/verify', { userId: id.id, nonce, signature: b64(signature) });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      throw e;
    }
  }, []);

  const registerIdentity = useCallback(async (id: Identity) => {
    const keys = await generateInitialPreKeys(id, 100);
    const pub = toPublicIdentity(id);

    await post('/api/register', {
      signingKey: pub.signingKey,
      identityKey: pub.identityKey,
      signedPreKey: keys.signedPreKey,
      oneTimePreKeys: keys.oneTimePreKeys,
    });
  }, []);

  const refresh = useCallback(async () => {
    const id = identityRef.current;
    if (!id) return;

    const [profile, nestList] = await Promise.all([
      get<Me>('/api/me'),
      get<{ nests: Nest[] }>('/api/nests'),
    ]);

    setMe(profile);
    setNests(nestList.nests);

    // Keep the one-time prekey pool full so letters keep their per-letter
    // forward secrecy. Running dry is not fatal, but it is worth avoiding.
    if (profile.preKeys.needsTopUp) {
      const fresh = await generateMoreOneTimePreKeys(
        id,
        profile.preKeys.batchSize,
        profile.preKeys.nextId,
      );
      await post('/api/keys', { oneTimePreKeys: fresh });
    }

    /*
     * Replace the signed prekey once it is old enough.
     *
     * This is what makes it medium-term rather than permanent, and it bounds
     * how much a single compromised secret could ever expose. The previous
     * secret is deliberately kept, so letters already in the air — which were
     * sealed against it — still open when they land.
     */
    if (profile.signedPreKey.needsRotation) {
      const rotated = await rotateSignedPreKey(id, profile.signedPreKey.id + 1);
      await post('/api/keys', { signedPreKey: rotated });
    }

    /*
     * Reconcile the kept letters with the server, both ways.
     *
     * Pull is what makes a device you just restored whole: the history is
     * sealed under a key derived from your phrase, so it decrypts here
     * without anything having been transferred between devices. Push carries
     * up anything this device kept while offline, or before there was
     * anywhere durable to put it.
     *
     * Deliberately not awaited: a slow or failed sync must never hold up the
     * screen, and the local copy is already correct.
     */
    void syncArchive(id).catch(() => {});

    /*
     * Ask the browser to treat this origin's storage as durable.
     *
     * Without it the local archive is evictable under storage pressure, and
     * iOS clears it outright after weeks of not opening the app. The server
     * copy means eviction is no longer fatal, but losing the fast local copy
     * for no reason is still worth avoiding. Best effort: browsers may
     * decline, and nothing here depends on the answer.
     */
    void navigator.storage?.persist?.().catch(() => {});
  }, []);

  const activate = useCallback(
    async (id: Identity, { register }: { register: boolean }) => {
      setBoth(id);

      if (register) {
        await registerIdentity(id);
      } else if (!(await signIn(id))) {
        // The phrase is valid but the server has never seen it — treat it as a
        // first run on a fresh server rather than an error.
        await registerIdentity(id);
      }

      await refresh();
      setStatus('ready');
    },
    [refresh, registerIdentity, signIn],
  );

  // --- setup and unlock -----------------------------------------------------

  const createPhrase = useCallback(() => generateRecoveryPhrase(), []);

  const storePhrase = async (
    phrase: string,
    options: { method: UnlockMethod; pin?: string; label?: string },
  ) => {
    if (options.method === 'passkey') {
      await saveWithPasskey(phrase, options.label ?? 'Kabootar Talk');
    } else {
      if (!options.pin || options.pin.length !== PIN_LENGTH) {
        throw new Error(`Choose a PIN of ${PIN_LENGTH} digits.`);
      }
      await saveWithPin(phrase, options.pin);
    }
    setUnlockMethod(options.method);
  };

  const finishSetup = useCallback<KabootarValue['finishSetup']>(
    async (phrase, options) => {
      setError(null);
      try {
        await storePhrase(phrase, options);
        await activate(identityFromPhrase(phrase), { register: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Setup failed.');
        throw e;
      }
    },
    [activate],
  );

  const restoreFromPhrase = useCallback<KabootarValue['restoreFromPhrase']>(
    async (phrase, options) => {
      setError(null);
      try {
        const id = identityFromPhrase(phrase);
        await storePhrase(phrase, options);
        await activate(id, { register: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not restore.');
        throw e;
      }
    },
    [activate],
  );

  const unlockDevice = useCallback<KabootarValue['unlockDevice']>(
    async (pin) => {
      setError(null);
      try {
        const phrase = await unlock(pin);
        await activate(identityFromPhrase(phrase), { register: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not unlock.');
        throw e;
      }
    },
    [activate],
  );

  const lock = useCallback(() => {
    setBoth(null);
    setMe(null);
    setNests([]);
    setStatus('locked');
  }, []);

  const forgetDevice = useCallback(async () => {
    try {
      await post('/api/auth/logout');
    } catch {
      // Signing out locally matters more than telling the server about it.
    }
    // Everything, not just the vault: the archive of decrypted letters and the
    // prekey secrets live here too, and the button promises they go.
    await wipeEverything();
    setBoth(null);
    setMe(null);
    setNests([]);
    setUnlockMethod(null);
    setStatus('needs-setup');
  }, []);

  // --- pairing --------------------------------------------------------------

  const createInvite = useCallback(async () => {
    const code = generateInviteCode();
    await post('/api/nests/invite', { codeHash: b64(await hashInviteCodeAsync(code)) });
    return code;
  }, []);

  const redeemInvite = useCallback(
    async (code: string) => {
      await post('/api/nests/redeem', { codeHash: b64(await hashInviteCodeAsync(code)) });
      await refresh();
    },
    [refresh],
  );

  const confirmNest = useCallback(
    async (nestId: string) => {
      await post(`/api/nests/${nestId}`);
      await refresh();
    },
    [refresh],
  );

  const closeNest = useCallback(
    async (nestId: string) => {
      await del(`/api/nests/${nestId}`);
      await refresh();
    },
    [refresh],
  );

  const safetyFor = useCallback(
    (nest: Nest) => {
      const id = identityRef.current;
      return id ? safetyCheck(toPublicIdentity(id), nest.partner) : null;
    },
    // Reads the ref, not the state, so it needs no dependency on the identity.
    [],
  );

  // --- letters --------------------------------------------------------------

  const loadFlock = useCallback<KabootarValue['loadFlock']>(async (nestId) => {
    const nest = await get<{ flock: Pigeon[] }>(`/api/nests/${nestId}`);
    return nest.flock ?? [];
  }, []);

  const tend = useCallback<KabootarValue['tend']>(async (pigeonId, action, name) => {
    const result = await post<{ pigeon: Pigeon }>(`/api/pigeons/${pigeonId}`, { action, name });
    return result.pigeon;
  }, []);

  const sendLetter = useCallback<KabootarValue['sendLetter']>(
    async ({ nestId, pigeon, text, mode, from, to }) => {
      const id = identityRef.current;
      if (!id) throw new Error('Unlock first.');

      const trimmed = text.trim();
      if (!trimmed) throw new Error('Write something first.');

      // Claiming the bundle consumes one of your partner's one-time prekeys,
      // so it happens here, at the moment of sending, and nowhere else. It is
      // a POST for the same reason: it is not a safe request to repeat.
      const bundle = await post<PreKeyBundle>(`/api/nests/${nestId}/bundle`);
      const session = initiateSession(id, bundle);

      const departedAt = now();
      const km = distanceKm(from, to);

      // How long she takes is her own: her traits and her mood both count, and
      // the recipient's device works out the identical number from the same
      // inputs, so both of you watch the same flight.
      const arrivesAt =
        departedAt + plannedDurationMs(km, mode, undefined, effectiveSpeed(pigeon.id, pigeon.mood));

      const header: EnvelopeHeader = {
        v: 1,
        nestId,
        senderId: id.id,
        session: session.header,
        departedAt,
        arrivesAt,
        mode,
      };

      const body: LetterBody = { text: trimmed, writtenAt: departedAt };
      const manifest: FlightManifest = { from, to, mode };

      const sealed = sealLetter({
        sharedSecret: session.sharedSecret,
        associatedData: session.associatedData,
        header,
        manifest,
        body,
      });

      const result = await post<{ id: string }>(`/api/nests/${nestId}/letters`, {
        pigeonId: pigeon.id,
        // What the trip costs her. The server cannot work this out — it never
        // learns the distance — so it bounds the claim instead.
        staminaAfter: Math.max(0, Math.round(pigeon.stamina - flightCost(km))),
        header,
        manifest: sealed.manifest,
        body: sealed.body,
      });

      // Your own copy. The server's copy becomes unreadable to you the moment
      // your partner opens it and burns the prekey, which is the point.
      const kept = {
        letterId: result.id,
        nestId,
        direction: 'sent' as const,
        text: trimmed,
        writtenAt: departedAt,
        departedAt,
        arrivesAt,
        manifest,
      };

      await archiveLetter(id, kept);
      void keepLetter(id, kept);

      await rememberPlaces(id, nestId, { from, to });
      await refresh();
    },
    [refresh],
  );

  const loadLetters = useCallback<KabootarValue['loadLetters']>(
    async (nestId) => {
      const id = identityRef.current;
      if (!id) return [];

      const nest = nests.find((n) => n.id === nestId);
      const [{ letters }, archive] = await Promise.all([
        get<{ letters: RawLetter[] }>(`/api/nests/${nestId}/letters`),
        readArchive(id, nestId),
      ]);

      const byId = new Map<string, ArchivedLetter>(archive.map((a) => [a.letterId, a]));
      const out: Letter[] = [];

      for (const raw of letters) {
        const stored = byId.get(raw.id);
        const base = {
          id: raw.id,
          mine: raw.mine,
          pigeonId: raw.pigeonId,
          pigeonName: raw.pigeonName,
          mode: raw.mode,
          departedAt: raw.departedAt,
          arrivesAt: raw.arrivesAt,
          openedAt: raw.openedAt,
        };

        // Letters you wrote read from your own archive; the session that
        // encrypted them was never kept.
        if (raw.mine) {
          out.push({
            ...base,
            manifest: stored?.manifest ?? null,
            text: stored?.text ?? null,
            writtenAt: stored?.writtenAt ?? null,
            status: raw.arrivesAt <= now() ? 'landed' : 'flying',
          });
          continue;
        }

        if (stored) {
          out.push({
            ...base,
            manifest: stored.manifest,
            text: stored.text,
            writtenAt: stored.writtenAt,
            status: 'landed',
          });
          continue;
        }

        out.push(await decryptIncoming(id, nest, raw));
      }

      return out.sort((a, b) => b.departedAt - a.departedAt);
    },
    [nests],
  );

  const value = useMemo<KabootarValue>(
    () => ({
      status,
      identity,
      me,
      nests,
      unlockMethod,
      error,
      createPhrase,
      finishSetup,
      unlockDevice,
      restoreFromPhrase,
      lock,
      forgetDevice,
      refresh,
      createInvite,
      redeemInvite,
      confirmNest,
      closeNest,
      safetyFor,
      places: async (nestId) => (identityRef.current ? placesFor(identityRef.current, nestId) : null),
      setPlaces: async (nestId, p) => {
        if (identityRef.current) await rememberPlaces(identityRef.current, nestId, p);
      },
      loadLetters,
      loadFlock,
      tend,
      sendLetter,
    }),
    [
      status, identity, me, nests, unlockMethod, error,
      createPhrase, finishSetup, unlockDevice, restoreFromPhrase, lock, forgetDevice,
      refresh, createInvite, redeemInvite, confirmNest, closeNest, safetyFor,
      loadLetters, loadFlock, tend, sendLetter,
    ],
  );

  return <KabootarContext.Provider value={value}>{children}</KabootarContext.Provider>;
}

/**
 * Decrypt a letter somebody sent you.
 *
 * The route is always the same: rebuild the session from the prekeys the
 * sender used, open the manifest so the pigeon can be drawn, and open the body
 * only if the server actually handed one over.
 */
async function decryptIncoming(
  identity: Identity,
  nest: Nest | undefined,
  raw: RawLetter,
): Promise<Letter> {
  const base = {
    id: raw.id,
    mine: false,
    pigeonId: raw.pigeonId,
    pigeonName: raw.pigeonName,
    mode: raw.mode,
    departedAt: raw.departedAt,
    arrivesAt: raw.arrivesAt,
    openedAt: raw.openedAt,
    manifest: null,
    text: null,
    writtenAt: null,
  };

  if (!nest) return { ...base, status: 'locked' };

  const secrets = await preKeySecretsFor(
    identity,
    raw.header.session.signedPreKeyId,
    raw.header.session.oneTimePreKeyId,
  );

  // A burned prekey means this letter was already opened and archived on some
  // device. It cannot be opened again — that is forward secrecy working.
  if (!secrets) return { ...base, status: 'locked' };

  try {
    const session = acceptSession({
      self: identity,
      senderIdentityKey: nest.partner.identityKey,
      header: raw.header.session,
      ...secrets,
    });

    const opener = {
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header: raw.header,
    };

    const manifest = openManifest(opener, raw.manifest);

    if (!raw.body) {
      return { ...base, manifest, status: 'flying' };
    }

    const body = openBody(opener, raw.body);

    const kept = {
      letterId: raw.id,
      nestId: raw.header.nestId,
      direction: 'received' as const,
      text: body.text,
      writtenAt: body.writtenAt,
      departedAt: raw.departedAt,
      arrivesAt: raw.arrivesAt,
      manifest,
    };

    await archiveLetter(identity, kept);

    /*
     * The key that opened this letter is destroyed only once the kept copy
     * is somewhere durable.
     *
     * Burning it is irreversible: afterwards the letter cannot be opened
     * again from the server's copy by anyone, so a burn following a failed
     * upload would leave the only readable copy on this one device, which is
     * the situation the archive exists to end. If the upload does not land,
     * the prekey survives and the letter simply opens again next time.
     */
    const durable = await keepLetter(identity, kept);

    if (durable && raw.header.session.oneTimePreKeyId !== null) {
      await burnOneTimePreKey(identity, raw.header.session.oneTimePreKeyId);
    }

    void post(`/api/letters/${raw.id}`).catch(() => {});

    return { ...base, manifest, text: body.text, writtenAt: body.writtenAt, status: 'landed' };
  } catch {
    return { ...base, status: 'locked' };
  }
}

/** Convenience for screens that need the flight simulation for a letter. */
/**
 * The journey a letter made, rebuilt on the device.
 *
 * The carrying bird is passed in so her traits shape it: a Curious kabootar
 * genuinely comes down more often, a Stormheart meets less weather. Both ends
 * derive it from the same letter and the same bird, so both watch an identical
 * flight without exchanging anything to agree on it.
 */
export function itineraryFor(letter: Letter) {
  if (!letter.manifest) return null;

  return buildItinerary({
    from: letter.manifest.from,
    to: letter.manifest.to,
    departedAt: letter.departedAt,
    arrivesAt: letter.arrivesAt,
    seed: letter.id,
    mode: letter.mode,
    pigeonId: letter.pigeonId ?? undefined,
  });
}
