/**
 * Pairing codes — the only way to reach another person on Kabootar Talk.
 *
 * There is no directory, no search, no "people you may know" and no way to
 * address a letter to an id you were not handed. Someone can only write to you
 * if you generated a code, gave it to them yourself, and then approved them
 * when they turned up. That is why this app cannot develop a spam problem: the
 * mechanism that would be needed to spam somebody does not exist.
 *
 * The code itself never reaches the server. Both sides send only a slow hash
 * of it, so a stolen database contains no usable codes — and because the hash
 * is Argon2id rather than SHA-256, it cannot be brute-forced back into one
 * either, despite a code being only 66 bits.
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { concat, randomBytes, utf8 } from './primitives';

/** Six words: 66 bits, and still readable over a phone call. */
export const CODE_WORDS = 6;

const SALT = utf8('kabootar/invite/v1//salt');

/**
 * Tuned so a phone spends around a second on it. Pairing happens once, so the
 * cost is invisible to the user and painful for anyone attacking the hash.
 */
const ARGON = { t: 3, m: 65536, p: 1, dkLen: 32 } as const;

export function generateInviteCode(): string {
  // 66 bits of entropy, read 11 bits at a time out of 9 random bytes.
  const bytes = randomBytes(9);
  const words: string[] = [];

  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 11 && words.length < CODE_WORDS) {
      bits -= 11;
      words.push(wordlist[(acc >> bits) & 0x7ff]);
    }
  }

  return words.join(' ');
}

/** Forgive capitals, stray spaces and the dashes people add when copying. */
export function normalizeInviteCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[-_,]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function isValidInviteCode(code: string): boolean {
  const words = normalizeInviteCode(code).split(' ');
  return words.length === CODE_WORDS && words.every((w) => wordlist.includes(w));
}

/**
 * The value actually sent to the server, by both the inviter and the redeemer.
 *
 * Deliberately slow. Called once when a code is created and once when it is
 * used, so roughly a second on a phone is a fine price.
 */
export function hashInviteCode(code: string): Uint8Array {
  const normalized = normalizeInviteCode(code);
  if (!isValidInviteCode(normalized)) {
    throw new Error('That is not a valid pairing code.');
  }
  return argon2id(concat(utf8('kabootar/invite/v1'), utf8(normalized)), SALT, ARGON);
}
