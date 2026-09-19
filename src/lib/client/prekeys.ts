'use client';

/**
 * The device's half of the prekeys it published.
 *
 * The server holds the public halves; these are the secrets that open letters
 * addressed to them. They are stored encrypted under a key derived from the
 * identity, so they are only readable while the vault is unlocked.
 *
 * Deleting a one-time prekey secret after use is not housekeeping — it is the
 * mechanism that makes forward secrecy real. Once it is gone, that letter's
 * key cannot be reconstructed by anybody, including you.
 */

import type { Identity } from '../crypto/identity';
import { b64, derive, open, seal, unb64, utf8 } from '../crypto/primitives';
import { createOneTimePreKeys, createSignedPreKey, type PreKeyRecord } from '../crypto/x3dh';
import { idb, STORES } from './idb';

const AAD = utf8('kabootar/prekey-store/v1');

interface StoredKeys {
  signed: Record<number, string>;
  oneTime: Record<number, string>;
}


function storeKey(identity: Identity): Uint8Array {
  return derive(identity.signing.secretKey, 'prekey-store/v1');
}

async function load(identity: Identity): Promise<StoredKeys> {
  const blob = await idb<string | undefined>(STORES.prekeys, 'readonly', (s) => s.get(identity.id));
  if (!blob) return { signed: {}, oneTime: {} };

  try {
    return JSON.parse(
      new TextDecoder().decode(open(storeKey(identity), unb64(blob), AAD)),
    ) as StoredKeys;
  } catch {
    // Wrong identity or corrupted store — safer to start fresh than to guess.
    return { signed: {}, oneTime: {} };
  }
}

async function save(identity: Identity, keys: StoredKeys): Promise<void> {
  const blob = b64(seal(storeKey(identity), utf8(JSON.stringify(keys)), AAD));
  await idb(STORES.prekeys, 'readwrite', (s) => s.put(blob, identity.id));
}

export interface GeneratedPreKeys {
  signedPreKey: { id: number; publicKey: string; signature: string };
  oneTimePreKeys: Array<{ id: number; publicKey: string }>;
}

/** Fresh keys for a brand-new identity, with the secrets kept locally. */
export async function generateInitialPreKeys(
  identity: Identity,
  batch: number,
): Promise<GeneratedPreKeys> {
  const signed = createSignedPreKey(identity, 1);
  const oneTime = createOneTimePreKeys(batch, 1);

  await save(identity, {
    signed: { [signed.record.id]: signed.record.secretKey },
    oneTime: Object.fromEntries(oneTime.map((k) => [k.id, k.secretKey])),
  });

  return {
    signedPreKey: {
      id: signed.record.id,
      publicKey: signed.record.publicKey,
      signature: signed.signature,
    },
    oneTimePreKeys: oneTime.map(publicOf),
  };
}

/** More one-time prekeys, appended to whatever is already stored. */
export async function generateMoreOneTimePreKeys(
  identity: Identity,
  count: number,
  startId: number,
): Promise<Array<{ id: number; publicKey: string }>> {
  const fresh = createOneTimePreKeys(count, startId + 1);
  const keys = await load(identity);

  for (const k of fresh) keys.oneTime[k.id] = k.secretKey;
  await save(identity, keys);

  return fresh.map(publicOf);
}

/** Rotate the signed prekey, keeping the old secret so letters in flight still open. */
export async function rotateSignedPreKey(
  identity: Identity,
  id: number,
): Promise<{ id: number; publicKey: string; signature: string }> {
  const signed = createSignedPreKey(identity, id);
  const keys = await load(identity);

  keys.signed[signed.record.id] = signed.record.secretKey;
  await save(identity, keys);

  return {
    id: signed.record.id,
    publicKey: signed.record.publicKey,
    signature: signed.signature,
  };
}

function publicOf(k: PreKeyRecord) {
  return { id: k.id, publicKey: k.publicKey };
}

export interface PreKeySecrets {
  signedPreKeySecret: string;
  oneTimePreKeySecret?: string;
}

/** The secrets needed to open one specific letter. */
export async function preKeySecretsFor(
  identity: Identity,
  signedPreKeyId: number,
  oneTimePreKeyId: number | null,
): Promise<PreKeySecrets | null> {
  const keys = await load(identity);
  const signedPreKeySecret = keys.signed[signedPreKeyId];
  if (!signedPreKeySecret) return null;

  if (oneTimePreKeyId === null) return { signedPreKeySecret };

  const oneTimePreKeySecret = keys.oneTime[oneTimePreKeyId];
  if (!oneTimePreKeySecret) return null;

  return { signedPreKeySecret, oneTimePreKeySecret };
}

/**
 * Destroy a one-time prekey secret once its letter has been opened.
 *
 * After this, that letter's key is gone for good. The copy still sitting on
 * the server is permanently unreadable, even to someone who later takes this
 * phone, the other phone and the database all at once.
 */
export async function burnOneTimePreKey(identity: Identity, id: number): Promise<void> {
  const keys = await load(identity);
  if (!(id in keys.oneTime)) return;

  delete keys.oneTime[id];
  await save(identity, keys);
}

export async function clearPreKeys(identity: Identity): Promise<void> {
  await idb(STORES.prekeys, 'readwrite', (s) => s.delete(identity.id));
}
