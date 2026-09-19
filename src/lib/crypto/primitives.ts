/**
 * The only place raw cryptographic primitives are touched.
 *
 * Everything else in the app composes these. Keeping the surface this small is
 * deliberate: it is the part most worth reading carefully, and the part where
 * a mistake is least likely to be noticed by testing.
 *
 * Choices, and why:
 *   - XChaCha20-Poly1305 for AEAD. 24-byte nonces mean random nonces are safe
 *     without a counter, which removes the classic catastrophic-reuse footgun.
 *   - X25519 for key agreement, Ed25519 for signatures, derived from separate
 *     HKDF outputs rather than converted from one another — reusing one key
 *     across two algorithms is a known way to get into trouble.
 *   - HKDF-SHA256 for every derivation, always with a distinct `info` label so
 *     two different uses can never land on the same key.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64urlnopad } from '@scure/base';

export const NONCE_BYTES = 24;
export const KEY_BYTES = 32;

/** Domain separator mixed into every derivation in this app. */
const APP_SALT = new TextEncoder().encode('kabootar-talk/v1');

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

export const b64 = (b: Uint8Array): string => base64urlnopad.encode(b);
export const unb64 = (s: string): Uint8Array => base64urlnopad.decode(s);

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Compare two byte strings without leaking, through timing, where they differ.
 * Used for anything an attacker could submit repeatedly, like a session token.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Derive a key. `info` must be unique per purpose — that label is the only
 * thing preventing two different uses of the same secret from colliding.
 */
export function derive(
  ikm: Uint8Array,
  info: string,
  length = KEY_BYTES,
  salt: Uint8Array = APP_SALT,
): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8(info), length);
}

export function hash(...parts: Uint8Array[]): Uint8Array {
  return sha256(concat(...parts));
}

/**
 * Encrypt, returning `nonce || ciphertext || tag` as one blob.
 *
 * `aad` is authenticated but not encrypted: tampering with it makes decryption
 * fail. Message headers go here, so the server cannot alter a letter's claimed
 * sender or delivery time without destroying the letter.
 */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return concat(nonce, ct);
}

/** Throws if the ciphertext or the associated data has been touched. */
export function open(key: Uint8Array, blob: Uint8Array, aad: Uint8Array): Uint8Array {
  if (blob.length <= NONCE_BYTES) throw new Error('ciphertext too short');
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ct = blob.subarray(NONCE_BYTES);
  return xchacha20poly1305(key, nonce, aad).decrypt(ct);
}

/** Best-effort scrub of key material once it is no longer needed. */
export function wipe(...arrays: Uint8Array[]): void {
  for (const a of arrays) a.fill(0);
}
