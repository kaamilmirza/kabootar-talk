/**
 * Who you are on Kabootar Talk.
 *
 * There is no account, no email, no password and no user row worth stealing.
 * Your identity is a keypair derived from twelve words that only ever exist on
 * your device and on whatever paper you wrote them on. The server learns a
 * public key and nothing else, so there is no personal data for a breach to
 * expose — the strongest privacy guarantee available is simply not collecting
 * anything in the first place.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { base32crockford } from '@scure/base';

import { b64, concat, derive, hash, unb64, utf8 } from './primitives';

/** 128 bits of entropy — twelve words. */
const ENTROPY_BITS = 128;

const INFO_SIGNING = 'identity/ed25519/v1';
const INFO_AGREEMENT = 'identity/x25519/v1';
const INFO_SAFETY = 'safety-number/v1';

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface Identity {
  /** Stable public handle, derived from the signing key. Safe to store and log. */
  id: string;
  /** Ed25519 — proves to the server that a request is really from you. */
  signing: KeyPair;
  /** X25519 — the long-term half of every message key agreement. */
  agreement: KeyPair;
}

/** The public half, as published to the server. */
export interface PublicIdentity {
  id: string;
  signingKey: string;
  identityKey: string;
}

export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, ENTROPY_BITS);
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizePhrase(phrase), wordlist);
}

/** Tolerate the extra spaces and capitals people introduce when retyping. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

/**
 * Twelve words in, a full identity out. Deterministic: the same phrase always
 * rebuilds exactly the same keys, which is what makes the phrase a backup.
 */
export function identityFromPhrase(phrase: string): Identity {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('That is not a valid recovery phrase.');
  }

  // No BIP39 passphrase: the words are the whole secret, and a second secret
  // people would have to remember separately is a good way to lose an account.
  const seed = mnemonicToSeedSync(normalized);

  const signingSeed = derive(seed, INFO_SIGNING);
  const agreementSeed = derive(seed, INFO_AGREEMENT);

  const signing: KeyPair = {
    secretKey: signingSeed,
    publicKey: ed25519.getPublicKey(signingSeed),
  };
  const agreement: KeyPair = {
    secretKey: agreementSeed,
    publicKey: x25519.getPublicKey(agreementSeed),
  };

  return { id: deriveUserId(signing.publicKey), signing, agreement };
}

export function toPublicIdentity(identity: Identity): PublicIdentity {
  return {
    id: identity.id,
    signingKey: b64(identity.signing.publicKey),
    identityKey: b64(identity.agreement.publicKey),
  };
}

/**
 * A user id is a hash of the signing key, not a random string, so the server
 * cannot hand two people the same id or silently swap one identity for another.
 */
export function deriveUserId(signingPublicKey: Uint8Array): string {
  return base32crockford.encode(hash(utf8('kabootar/user-id/v1'), signingPublicKey));
}

export function sign(identity: Identity, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, identity.signing.secretKey);
}

export function verify(
  signingPublicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, signingPublicKey);
  } catch {
    return false;
  }
}

// --- safety numbers ---------------------------------------------------------

export interface SafetyCheck {
  /** 60 digits, in twelve groups of five. */
  digits: string[];
  /** Eight words — far easier to read to each other over a call. */
  words: string[];
}

/**
 * The out-of-band check that makes the server untrusted rather than trusted.
 *
 * A malicious server could hand each of you a key it controls and sit in the
 * middle. It cannot make these eight words match on both phones. Reading them
 * aloud to each other once, on a call you already trust, closes that hole —
 * and it is the single most valuable thing a user of this app can do.
 */
export function safetyCheck(a: PublicIdentity, b: PublicIdentity): SafetyCheck {
  // Sort so both sides derive the same value regardless of who asks.
  const [first, second] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));

  const material = derive(
    concat(
      unb64(first.identityKey),
      unb64(first.signingKey),
      unb64(second.identityKey),
      unb64(second.signingKey),
    ),
    INFO_SAFETY,
    48,
  );

  return { digits: toDigitGroups(material), words: toWords(material) };
}

function toDigitGroups(material: Uint8Array): string[] {
  let n = 0n;
  for (const byte of material.subarray(0, 32)) n = (n << 8n) | BigInt(byte);

  const digits = (n % 10n ** 60n).toString().padStart(60, '0');
  return Array.from({ length: 12 }, (_, i) => digits.slice(i * 5, i * 5 + 5));
}

function toWords(material: Uint8Array): string[] {
  // Eleven bits per word indexes the 2048-word BIP39 list exactly.
  const words: string[] = [];
  let bits = 0;
  let acc = 0;

  for (const byte of material.subarray(32)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 11 && words.length < 8) {
      bits -= 11;
      words.push(wordlist[(acc >> bits) & 0x7ff]);
    }
  }

  return words;
}
