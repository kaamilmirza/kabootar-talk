'use client';

/**
 * Where your identity lives on this device.
 *
 * The recovery phrase is never stored in the clear and never leaves the
 * device. It is wrapped with a key that this file can only obtain by asking
 * you for something — your face, your fingerprint, or a PIN — and the wrapped
 * blob sits in IndexedDB, useless on its own.
 *
 * Two unlock methods:
 *
 *   passkey  Preferred. Uses the WebAuthn PRF extension to have the device's
 *            secure element produce a key that exists nowhere else and cannot
 *            be extracted from the phone, even by someone holding it. The
 *            passkey is used purely as a key source — sign-in to the server is
 *            still an Ed25519 signature, so no server is trusted with anything.
 *
 *   pin      Fallback for browsers without PRF. Argon2id with deliberately
 *            heavy parameters, so a stolen database of wrapped blobs is not
 *            worth attacking.
 */

import {
  b64,
  concat,
  derive,
  open,
  randomBytes,
  seal,
  unb64,
  utf8,
} from '../crypto/primitives';
import { idb, STORES } from './idb';
import { ARGON, stretch, usingWorker, type ArgonParams } from './kdf';

export { usingWorker };

const RECORD_KEY = 'identity';

/** How many digits a PIN must have. */
export const PIN_LENGTH = 4;

/**
 * Slowing down someone tapping at a stolen phone.
 *
 * A four-digit PIN is about thirteen bits — ten thousand possibilities — and
 * no amount of key stretching makes thirteen bits strong on its own. Argon2id
 * is what makes an *offline* attack on a copied vault expensive; this is what
 * makes an *online* one, somebody sitting there guessing, impractical.
 *
 * Attempts are never reset by closing the app, only by getting it right. The
 * recovery phrase is always a way back in, so nobody is ever locked out of
 * their own letters by this.
 */
const LOCKOUTS: Array<{ after: number; waitMs: number }> = [
  { after: 5, waitMs: 30_000 },
  { after: 7, waitMs: 2 * 60_000 },
  { after: 9, waitMs: 10 * 60_000 },
  { after: 12, waitMs: 60 * 60_000 },
];

export class LockedOutError extends Error {
  constructor(readonly until: number) {
    super('Too many attempts.');
    this.name = 'LockedOutError';
  }
}

function lockoutFor(failures: number): number {
  let wait = 0;
  for (const step of LOCKOUTS) if (failures >= step.after) wait = step.waitMs;
  return wait;
}

/**
 * What the very first vaults were written with, before the cost was tuned
 * down and moved off the main thread.
 *
 * Argon2id parameters are part of the key: change them and the same PIN
 * derives a different key, which would lock out anybody who had already set
 * up. So every vault records the parameters it was written with, and this is
 * the assumption for the ones written before that field existed.
 */
const LEGACY_ARGON: ArgonParams = { t: 4, m: 131072, p: 1, dkLen: 32 };

export type UnlockMethod = 'passkey' | 'pin';

interface VaultRecord {
  method: UnlockMethod;
  /** Wrapped recovery phrase: nonce || ciphertext. */
  wrapped: string;
  salt: string;
  /** Present for the passkey method. */
  credentialId?: string;
  /** Absent on vaults written before the parameters were tunable. */
  kdf?: ArgonParams;
  /** Consecutive wrong PINs, and when guessing may resume. */
  failures?: number;
  lockedUntil?: number;
  createdAt: number;
}

async function readRecord(): Promise<VaultRecord | null> {
  try {
    return (
      (await idb<VaultRecord | undefined>(STORES.vault, 'readonly', (s) => s.get(RECORD_KEY))) ??
      null
    );
  } catch {
    return null;
  }
}

async function writeRecord(record: VaultRecord): Promise<void> {
  await idb(STORES.vault, 'readwrite', (s) => s.put(record, RECORD_KEY));
}

export async function hasVault(): Promise<boolean> {
  return (await readRecord()) !== null;
}

export async function vaultMethod(): Promise<UnlockMethod | null> {
  return (await readRecord())?.method ?? null;
}

export async function clearVault(): Promise<void> {
  try {
    await idb(STORES.vault, 'readwrite', (s) => s.delete(RECORD_KEY));
  } catch {
    // Nothing stored; nothing to clear.
  }
}

// --- passkeys ---------------------------------------------------------------

/** Whether this browser exposes WebAuthn at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/**
 * Whether there is a built-in authenticator worth offering.
 *
 * Whether it supports PRF cannot be known without asking it, so this only
 * answers "is there a Face ID / fingerprint / Windows Hello here at all" — the
 * rest is discovered during setup, and handled rather than thrown.
 */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Raised when the passkey exists but will not derive keys. */
export class PrfUnsupportedError extends Error {
  constructor() {
    super(
      'This device can make a passkey but will not derive an encryption key from it. ' +
        'Use a PIN instead — your letters are protected exactly the same way either side of this choice.',
    );
    this.name = 'PrfUnsupportedError';
  }
}

const PRF_SALT = utf8('kabootar-talk/vault/prf/v1');

/**
 * WebAuthn wants buffers backed by a plain ArrayBuffer. Our byte arrays may be
 * views onto something else, so copy rather than cast.
 */
function asBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/**
 * Create a passkey whose only job is to produce a wrapping key.
 *
 * Two steps, and the second is not optional.
 *
 * Registration tells you only whether PRF is *available* — the flag comes back
 * as `prf.enabled`, and most authenticators return no actual key material at
 * this point. The derived secret comes from an assertion. An earlier version
 * of this read `prf.results.first` straight off the creation response, found
 * nothing there, and told people their device was broken when it was working
 * exactly to spec.
 *
 * No server is involved either way: the challenge is local and the credential
 * is never used to authenticate anywhere. We want the secure element, not the
 * login.
 */
async function createPasskey(label: string): Promise<{ credentialId: string; secret: Uint8Array }> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: asBuffer(randomBytes(32)),
      rp: { name: 'Kabootar Talk', id: window.location.hostname },
      user: { id: asBuffer(randomBytes(16)), name: label, displayName: label },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      // Asking only whether PRF is supported. The value comes later.
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey was not created.');

  const results = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  // Some authenticators do hand the value over at creation. Take it if so.
  const immediate = results.prf?.results?.first;
  const credentialId = b64(new Uint8Array(credential.rawId));

  if (immediate) return { credentialId, secret: new Uint8Array(immediate) };
  if (results.prf?.enabled === false) throw new PrfUnsupportedError();

  // The ordinary path: ask the freshly made credential for the derived value.
  const secret = await derivePrf(credentialId);
  if (!secret) throw new PrfUnsupportedError();

  return { credentialId, secret };
}

async function derivePrf(credentialId: string): Promise<Uint8Array | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: asBuffer(randomBytes(32)),
      allowCredentials: [{ type: 'public-key', id: asBuffer(unb64(credentialId)) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: asBuffer(PRF_SALT) } } },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) return null;

  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;

  return first ? new Uint8Array(first) : null;
}

async function unlockWithPasskey(credentialId: string): Promise<Uint8Array> {
  const secret = await derivePrf(credentialId);
  if (!secret) {
    throw new Error('This device would not derive a key from that passkey.');
  }
  return secret;
}

// --- wrapping ---------------------------------------------------------------

/** Deliberately slow, and deliberately off the main thread. See `kdf.ts`. */
function pinKey(pin: string, salt: Uint8Array, params: ArgonParams): Promise<Uint8Array> {
  return stretch(concat(utf8('kabootar/vault/pin/v1'), utf8(pin)), salt, params);
}

function wrappingKey(secret: Uint8Array, salt: Uint8Array): Uint8Array {
  return derive(concat(secret, salt), 'vault/wrap/v1');
}

const VAULT_AAD = utf8('kabootar/vault/v1');

/** Store the recovery phrase behind a passkey. Returns nothing on success. */
export async function saveWithPasskey(phrase: string, label: string): Promise<void> {
  const { credentialId, secret } = await createPasskey(label);
  const salt = randomBytes(32);

  await writeRecord({
    method: 'passkey',
    credentialId,
    salt: b64(salt),
    wrapped: b64(seal(wrappingKey(secret, salt), utf8(phrase), VAULT_AAD)),
    createdAt: Date.now(),
  });
}

/** Store the recovery phrase behind a PIN. */
export async function saveWithPin(phrase: string, pin: string): Promise<void> {
  if (!/^\d+$/.test(pin) || pin.length < PIN_LENGTH) {
    throw new Error(`Your PIN needs ${PIN_LENGTH} digits.`);
  }

  const salt = randomBytes(32);
  const key = wrappingKey(await pinKey(pin, salt, ARGON), salt);

  await writeRecord({
    method: 'pin',
    salt: b64(salt),
    kdf: ARGON,
    wrapped: b64(seal(key, utf8(phrase), VAULT_AAD)),
    createdAt: Date.now(),
  });
}

/**
 * Recover the phrase. Throws if the PIN is wrong or the passkey is refused —
 * and cannot tell the difference between a wrong PIN and a corrupted vault,
 * because the AEAD tag fails identically either way.
 */
/** How long the vault is refusing guesses for, if it is. */
export async function lockedFor(): Promise<number> {
  const record = await readRecord();
  if (!record?.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil - Date.now());
}

export async function unlock(pin?: string): Promise<string> {
  const record = await readRecord();
  if (!record) throw new Error('Nothing stored on this device.');

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    throw new LockedOutError(record.lockedUntil);
  }

  const salt = unb64(record.salt);

  const secret =
    record.method === 'passkey'
      ? await unlockWithPasskey(record.credentialId!)
      : await pinKey(pin ?? '', salt, record.kdf ?? LEGACY_ARGON);

  try {
    const phrase = new TextDecoder().decode(
      open(wrappingKey(secret, salt), unb64(record.wrapped), VAULT_AAD),
    );

    // Right answer: forget every wrong one.
    if (record.failures) {
      await writeRecord({ ...record, failures: 0, lockedUntil: undefined });
    }

    return phrase;
  } catch {
    // The AEAD tag cannot tell a wrong PIN from a corrupted vault, and neither
    // can we — so both count as an attempt, and both say the same thing.
    const failures = (record.failures ?? 0) + 1;
    const wait = lockoutFor(failures);

    await writeRecord({
      ...record,
      failures,
      lockedUntil: wait > 0 ? Date.now() + wait : undefined,
    });

    if (wait > 0) throw new LockedOutError(Date.now() + wait);

    throw new Error(
      record.method === 'pin' ? 'That PIN is not right.' : 'Could not unlock with that passkey.',
    );
  }
}
