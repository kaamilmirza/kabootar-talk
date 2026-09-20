/**
 * Sealing a letter you want to keep.
 *
 * Separate from the device storage that uses it, because this is the part that
 * has to be right: the key derivation is what makes a kept letter portable
 * between your devices, and the associated data is what stops the server
 * serving one letter's words under another letter's id.
 *
 * Pure functions over bytes, no browser, so the tests exercise exactly what
 * ships rather than a re-implementation of it.
 */

import type { Identity } from './identity';
import type { FlightManifest } from './envelope';
import { b64, derive, open, seal, unb64, utf8 } from './primitives';

export interface ArchivedLetter {
  letterId: string;
  nestId: string;
  /** Did this device write it, or receive it? */
  direction: 'sent' | 'received';
  text: string;
  writtenAt: number;
  departedAt: number;
  arrivesAt: number;
  manifest: FlightManifest;
}

/**
 * The key every one of your devices arrives at independently.
 *
 * Derived from the identity, which is derived from the twelve words, so a
 * phone and a laptop restored from the same phrase produce the same key
 * without ever having exchanged it — and the server, which holds only public
 * keys, cannot produce it at all.
 */
export function archiveKey(identity: Identity): Uint8Array {
  return derive(identity.signing.secretKey, 'archive/v1');
}

/**
 * Bind a sealed entry to the letter it belongs to.
 *
 * Without this the server could return entry A under letter B's id and the
 * device would decrypt it happily, showing the right words against the wrong
 * flight and the wrong date. With it, that substitution fails to authenticate.
 */
function entryAad(letterId: string): Uint8Array {
  return utf8(`kabootar/archive/entry/v1/${letterId}`);
}

export function sealArchiveEntry(identity: Identity, letter: ArchivedLetter): string {
  return b64(seal(archiveKey(identity), utf8(JSON.stringify(letter)), entryAad(letter.letterId)));
}

/** Null for anything that does not authenticate, or is not the letter asked for. */
export function openArchiveEntry(
  identity: Identity,
  letterId: string,
  blob: string,
): ArchivedLetter | null {
  try {
    const plain = open(archiveKey(identity), unb64(blob), entryAad(letterId));
    const letter = JSON.parse(new TextDecoder().decode(plain)) as ArchivedLetter;
    // A blob that authenticates but names a different letter is still wrong.
    return letter.letterId === letterId ? letter : null;
  } catch {
    return null;
  }
}
