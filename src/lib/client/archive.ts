'use client';

/**
 * Your own copy of the letters, on every device you own.
 *
 * A letter's transport is forward secret: the one-time prekey that opened it
 * is destroyed on read, and the copy in the `letters` table becomes unreadable
 * to everyone including you. That is the right guarantee for something in
 * flight. It was the wrong one for something you want to keep, because it made
 * whichever device happened to open the letter the only place the words
 * existed — and browsers evict storage.
 *
 * So a kept letter is re-sealed under a key derived from the recovery phrase
 * and mirrored to the server. Every device restored from those twelve words
 * derives the identical key, which is what makes the history portable without
 * the server ever holding one.
 *
 * The trade, stated plainly because it reverses an older promise: somebody
 * holding both your phrase and a database dump could read your history. The
 * server alone still cannot, and neither can anyone who takes only the phrase.
 *
 * Local storage stays the fast path and the offline path. The server is the
 * durable one. Neither is trusted to be complete, so every read merges both.
 */

import type { Identity } from '../crypto/identity';
import {
  archiveKey,
  openArchiveEntry,
  sealArchiveEntry,
  type ArchivedLetter,
} from '../crypto/archive';
import { b64, open, seal, unb64, utf8 } from '../crypto/primitives';
import { get, post } from './api';
import { idb, STORES } from './idb';

const AAD = utf8('kabootar/archive/v1');

export type { ArchivedLetter };

type Archive = Record<string, ArchivedLetter>;

// --- the copy on this device ------------------------------------------------

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

// --- keeping a letter -------------------------------------------------------

/**
 * Write a letter to this device.
 *
 * Local first and always: whatever the network is doing, the words are not
 * lost between decrypting them and storing them.
 */
export async function archiveLetter(identity: Identity, letter: ArchivedLetter): Promise<void> {
  const archive = await load(identity);
  archive[letter.letterId] = letter;
  await save(identity, archive);
}

/**
 * Push a letter to the server, and say whether it got there.
 *
 * The caller uses the answer to decide whether it is safe to destroy the key
 * that opened the letter: a burned prekey plus a failed upload would leave the
 * words on one device only, which is the exact situation this replaces.
 */
export async function keepLetter(identity: Identity, letter: ArchivedLetter): Promise<boolean> {
  try {
    await post('/api/archive', {
      entries: [{ letterId: letter.letterId, blob: sealArchiveEntry(identity, letter) }],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconcile this device with the server, in both directions.
 *
 * Pull is what makes a new device whole. Push is what rescues letters that
 * were archived before this existed, or while the network was down. Neither
 * side is authoritative, so anything missing from one is sent to the other.
 */
export async function syncArchive(identity: Identity): Promise<{ pulled: number; pushed: number }> {
  const local = await load(identity);
  let pulled = 0;

  let remoteIds = new Set<string>();
  try {
    const { entries } = await get<{
      entries: { letterId: string; blob: string; updatedAt: number }[];
    }>('/api/archive');

    remoteIds = new Set(entries.map((e) => e.letterId));

    for (const entry of entries) {
      if (local[entry.letterId]) continue;

      const letter = openArchiveEntry(identity, entry.letterId, entry.blob);
      if (letter) {
        local[entry.letterId] = letter;
        pulled += 1;
      }
    }

    if (pulled > 0) await save(identity, local);
  } catch {
    // Offline, or the account has nothing kept yet. The local copy still works.
    return { pulled: 0, pushed: 0 };
  }

  const missing = Object.values(local).filter((l) => !remoteIds.has(l.letterId));
  let pushed = 0;

  // Batched to the server's ceiling, so a long history does not arrive as one
  // oversized request.
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    try {
      await post('/api/archive', {
        entries: batch.map((l) => ({ letterId: l.letterId, blob: sealArchiveEntry(identity, l) })),
      });
      pushed += batch.length;
    } catch {
      break;
    }
  }

  return { pulled, pushed };
}

// --- reading ----------------------------------------------------------------

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
