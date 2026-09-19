'use client';

/**
 * Pairing-code hashing, off the main thread.
 *
 * The synchronous version in `crypto/invite.ts` stays as the definition of the
 * scheme, and is what the tests exercise. This is the same hash run in a
 * worker, so generating or redeeming a code does not lock up the interface for
 * a second while Argon2id does its work.
 */

import { isValidInviteCode, normalizeInviteCode } from '../crypto/invite';
import { concat, utf8 } from '../crypto/primitives';
import { stretch } from './kdf';

const SALT = utf8('kabootar/invite/v1//salt');

export async function hashInviteCodeAsync(code: string): Promise<Uint8Array> {
  const normalized = normalizeInviteCode(code);
  if (!isValidInviteCode(normalized)) {
    throw new Error('That is not a valid pairing code.');
  }
  return stretch(concat(utf8('kabootar/invite/v1'), utf8(normalized)), SALT);
}
