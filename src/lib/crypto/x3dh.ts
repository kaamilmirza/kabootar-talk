/**
 * X3DH key agreement — how a letter gets a key nobody else can rebuild.
 *
 * Both of you are asleep in different time zones when a letter is written, so
 * the key exchange has to work without either side being online. X3DH solves
 * exactly that: you publish a small pile of public prekeys once, and anyone
 * holding them can start a session with you while you are offline.
 *
 * What this buys, concretely:
 *   - Forward secrecy. Every letter gets its own key from a one-time prekey
 *     that is destroyed after use. Someone who seizes your phone tomorrow and
 *     unlocks it cannot read the letters you have already opened and deleted,
 *     and cannot read anything from the server's copies.
 *   - Authentication. The signed prekey is signed by your long-term identity
 *     key, so a server that substitutes its own prekeys is caught.
 *   - Deniability. The shared secret is symmetric — either of you could have
 *     produced any letter, so neither of you can prove to a third party that
 *     the other wrote it.
 *
 * Follows Signal's X3DH specification: https://signal.org/docs/specifications/x3dh/
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';

import { b64, concat, derive, unb64, utf8 } from './primitives';
import { deriveUserId, verify, type Identity } from './identity';

const INFO_ROOT = 'x3dh/root/v1';
const SPK_CONTEXT = 'kabootar/signed-prekey/v1';

/**
 * Prefix required by the X3DH spec. It keeps the KDF input distinguishable
 * from a raw curve point and pins this to a single curve.
 */
const F = new Uint8Array(32).fill(0xff);

export interface PreKeyRecord {
  id: number;
  /** Base64. Never leaves the device. */
  secretKey: string;
  publicKey: string;
}

/** The public bundle the server stores and hands to whoever writes to you. */
export interface PreKeyBundle {
  userId: string;
  signingKey: string;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  /** Present unless the pool ran dry; the server deletes it after handing it out. */
  oneTimePreKey?: { id: number; key: string };
}

/** Which prekeys a letter used, so the recipient can rebuild the same secret. */
export interface SessionHeader {
  ephemeralKey: string;
  signedPreKeyId: number;
  oneTimePreKeyId: number | null;
}

export interface InitiatedSession {
  sharedSecret: Uint8Array;
  header: SessionHeader;
  /** Sender and recipient long-term keys, bound into every ciphertext. */
  associatedData: Uint8Array;
}

// --- publishing your own keys ----------------------------------------------

function newPreKey(id: number): PreKeyRecord {
  const { secretKey, publicKey } = x25519.keygen();
  return { id, secretKey: b64(secretKey), publicKey: b64(publicKey) };
}

/**
 * The medium-term key, rotated on a schedule. Signing it is what stops the
 * server from quietly substituting a key it controls.
 */
export function createSignedPreKey(
  identity: Identity,
  id: number,
): { record: PreKeyRecord; signature: string } {
  const record = newPreKey(id);
  const signature = signPreKey(identity, unb64(record.publicKey));
  return { record, signature: b64(signature) };
}

export function createOneTimePreKeys(count: number, startId: number): PreKeyRecord[] {
  return Array.from({ length: count }, (_, i) => newPreKey(startId + i));
}

function preKeySigningMessage(publicKey: Uint8Array): Uint8Array {
  return concat(utf8(SPK_CONTEXT), publicKey);
}

function signPreKey(identity: Identity, publicKey: Uint8Array): Uint8Array {
  return ed25519.sign(preKeySigningMessage(publicKey), identity.signing.secretKey);
}

// --- verifying somebody else's bundle ---------------------------------------

/**
 * Never derive a key from a bundle that has not been through this.
 *
 * Two things are checked: that the user id really is the hash of the signing
 * key in the bundle (so the server cannot relabel someone else's keys as your
 * partner's), and that the signed prekey carries a valid signature from that
 * signing key (so the server cannot inject a prekey it knows the secret for).
 */
export function verifyBundle(bundle: PreKeyBundle): void {
  const signingKey = unb64(bundle.signingKey);

  if (deriveUserId(signingKey) !== bundle.userId) {
    throw new Error('Prekey bundle does not match the user id it claims.');
  }

  const ok = verify(
    signingKey,
    unb64(bundle.signedPreKeySignature),
    preKeySigningMessage(unb64(bundle.signedPreKey)),
  );

  if (!ok) throw new Error('Prekey bundle signature is invalid.');
}

// --- the agreement itself ---------------------------------------------------

/** Binds both long-term identities into every ciphertext produced from a session. */
export function associatedData(
  senderIdentityKey: Uint8Array,
  recipientIdentityKey: Uint8Array,
): Uint8Array {
  return concat(utf8('kabootar/ad/v1'), senderIdentityKey, recipientIdentityKey);
}

/** Sender side. Verifies the bundle, then derives a secret only the pair can rebuild. */
export function initiateSession(self: Identity, bundle: PreKeyBundle): InitiatedSession {
  verifyBundle(bundle);

  const recipientIdentity = unb64(bundle.identityKey);
  const signedPreKey = unb64(bundle.signedPreKey);
  const ephemeral = x25519.keygen();

  const dh1 = x25519.getSharedSecret(self.agreement.secretKey, signedPreKey);
  const dh2 = x25519.getSharedSecret(ephemeral.secretKey, recipientIdentity);
  const dh3 = x25519.getSharedSecret(ephemeral.secretKey, signedPreKey);

  const parts = [F, dh1, dh2, dh3];
  if (bundle.oneTimePreKey) {
    parts.push(x25519.getSharedSecret(ephemeral.secretKey, unb64(bundle.oneTimePreKey.key)));
  }

  return {
    sharedSecret: derive(concat(...parts), INFO_ROOT),
    header: {
      ephemeralKey: b64(ephemeral.publicKey),
      signedPreKeyId: bundle.signedPreKeyId,
      oneTimePreKeyId: bundle.oneTimePreKey?.id ?? null,
    },
    associatedData: associatedData(self.agreement.publicKey, recipientIdentity),
  };
}

export interface AcceptSessionInput {
  self: Identity;
  /** The sender's long-term X25519 public key, base64. */
  senderIdentityKey: string;
  header: SessionHeader;
  /** Base64 secret for the signed prekey the sender used. */
  signedPreKeySecret: string;
  /** Base64 secret for the one-time prekey, if the sender consumed one. */
  oneTimePreKeySecret?: string;
}

/** Recipient side. Rebuilds the identical secret from its half of the exchange. */
export function acceptSession(input: AcceptSessionInput): {
  sharedSecret: Uint8Array;
  associatedData: Uint8Array;
} {
  const { self, header } = input;
  const senderIdentity = unb64(input.senderIdentityKey);
  const ephemeral = unb64(header.ephemeralKey);
  const signedPreKeySecret = unb64(input.signedPreKeySecret);

  const dh1 = x25519.getSharedSecret(signedPreKeySecret, senderIdentity);
  const dh2 = x25519.getSharedSecret(self.agreement.secretKey, ephemeral);
  const dh3 = x25519.getSharedSecret(signedPreKeySecret, ephemeral);

  const parts = [F, dh1, dh2, dh3];
  if (input.oneTimePreKeySecret) {
    parts.push(x25519.getSharedSecret(unb64(input.oneTimePreKeySecret), ephemeral));
  } else if (header.oneTimePreKeyId !== null) {
    throw new Error('Letter used a one-time prekey this device no longer holds.');
  }

  return {
    sharedSecret: derive(concat(...parts), INFO_ROOT),
    associatedData: associatedData(senderIdentity, self.agreement.publicKey),
  };
}
