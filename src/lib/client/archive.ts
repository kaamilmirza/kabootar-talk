'use client';

/**
 * Your own copy of the letters.
 *
 * Forward secrecy has a consequence people should understand rather than be
 * surprised by: once a letter has been opened and its one-time prekey burned,
 * the copy on the server is permanently unreadable — by an attacker, by us,
 * and by you. So the readable copy lives here, on the device, encrypted under
 * a key derived from your identity.
 *
 * The honest trade this makes:
 *   - A stolen database reveals nothing, ever, even years later.
 *   - Restoring from your recovery phrase on a new phone gets your identity
 *     and your nests back, but not your old letters. They were only ever on
 *     the old device. That is the cost of the guarantee above.
 */

import type { Identity } from '../crypto/identity';
import { b64, derive, open, seal, unb64, utf8 } from '../crypto/primitives';
import type { FlightManifest } from '../crypto/envelope';
import { idb, STORES } from './idb';

const AAD = utf8('kabootar/archive/v1');

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

type Archive = Record<string, ArchivedLetter>;

function archiveKey(identity: Identity): Uint8Array {
  return derive(identity.signing.secretKey, 'archive/v1');
}

async function load(identity: Identity): Promise<Archive> {
  const blob = await idb<string | undefined>(STORES.letters, 'readonly', (s) => s.get(identity.id));
  if (!blob) return {};

  try {
    return JSON.parse(
      new TextDecoder().decode(open(archiveKey(identity), unb64(blob), AAD)),
    ) as Archive;
  } catch {
    return {};
  }
}

async function save(identity: Identity, archive: Archive): Promise<void> {
  const blob = b64(seal(archiveKey(identity), utf8(JSON.stringify(archive)), AAD));
  await idb(STORES.letters, 'readwrite', (s) => s.put(blob, identity.id));
}

export async function archiveLetter(identity: Identity, letter: ArchivedLetter): Promise<void> {
  const archive = await load(identity);
  archive[letter.letterId] = letter;
  await save(identity, archive);
}

export async function readArchive(identity: Identity, nestId?: string): Promise<ArchivedLetter[]> {
  const archive = Object.values(await load(identity));
  const scoped = nestId ? archive.filter((l) => l.nestId === nestId) : archive;
  return scoped.sort((a, b) => b.departedAt - a.departedAt);
}

export async function archivedLetter(
  identity: Identity,
  letterId: string,
): Promise<ArchivedLetter | null> {
  return (await load(identity))[letterId] ?? null;
}

export async function clearArchive(identity: Identity): Promise<void> {
  await idb(STORES.letters, 'readwrite', (s) => s.delete(identity.id));
}
