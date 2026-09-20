/**
 * The device side of keeping letters.
 *
 * `archive.ts` is the piece that decides what is written where and, crucially,
 * what `keepLetter` reports back — because the caller destroys the key that
 * opened a letter based on that answer. A false "yes" there loses words
 * permanently, so it gets tested rather than reasoned about.
 *
 * IndexedDB and the network are both replaced with in-memory stand-ins. What
 * is exercised for real is the merge: which letters are pulled, which are
 * pushed, and what happens when either side is empty, stale or broken.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sealArchiveEntry, type ArchivedLetter } from '../crypto/archive';
import { generateRecoveryPhrase, identityFromPhrase } from '../crypto/identity';

// --- stand-ins ---------------------------------------------------------------

const store = new Map<string, string>();

vi.mock('./idb', () => ({
  STORES: { vault: 'vault', prekeys: 'prekeys', letters: 'letters', places: 'places' },
  idb: vi.fn(
    async (_store: string, _mode: string, run: (s: unknown) => { result?: unknown }) => {
      // A single-store shim: enough for the archive, which only ever gets, puts
      // and deletes one row keyed by identity id.
      const shim = {
        get: (key: string) => ({ result: store.get(key) }),
        put: (value: string, key: string) => {
          store.set(key, value);
          return { result: undefined };
        },
        delete: (key: string) => {
          store.delete(key);
          return { result: undefined };
        },
      };
      return run(shim as never).result;
    },
  ),
}));

const server = {
  entries: new Map<string, string>(),
  failGet: false,
  failPost: false,
  posts: 0,
};

vi.mock('./api', () => ({
  get: vi.fn(async () => {
    if (server.failGet) throw new Error('offline');
    return {
      entries: [...server.entries].map(([letterId, blob]) => ({
        letterId,
        blob,
        updatedAt: 1,
      })),
    };
  }),
  post: vi.fn(async (_path: string, payload: { entries: { letterId: string; blob: string }[] }) => {
    if (server.failPost) throw new Error('offline');
    server.posts += 1;
    for (const e of payload.entries) server.entries.set(e.letterId, e.blob);
    return { kept: server.entries.size };
  }),
}));

const { archiveLetter, keepLetter, letterFile, readArchive, syncArchive } =
  await import('./archive');

// --- fixtures ----------------------------------------------------------------

const identity = identityFromPhrase(generateRecoveryPhrase());
const NEST = '55555555-5555-4555-8555-555555555555';

function letter(n: number, text = `letter ${n}`): ArchivedLetter {
  return {
    letterId: `0000000${n}-0000-4000-8000-000000000000`,
    nestId: NEST,
    direction: 'received',
    text,
    writtenAt: 1_700_000_000_000 + n,
    departedAt: 1_700_000_000_000 + n,
    arrivesAt: 1_700_086_400_000 + n,
    manifest: {
      from: { lat: 43.6532, lon: -79.3832, label: 'Toronto' },
      to: { lat: 17.385, lon: 78.4867, label: 'Hyderabad' },
      mode: 'normal',
    },
  };
}

beforeEach(() => {
  store.clear();
  server.entries.clear();
  server.failGet = false;
  server.failPost = false;
  server.posts = 0;
});

// --- the tests ---------------------------------------------------------------

describe('keeping a letter on this device', () => {
  it('reads back what was written', async () => {
    await archiveLetter(identity, letter(1, 'the roof is done'));

    const back = await readArchive(identity, NEST);
    expect(back).toHaveLength(1);
    expect(back[0]!.text).toBe('the roof is done');
  });

  it('keeps letters from other nests out of the list', async () => {
    await archiveLetter(identity, letter(1));
    await archiveLetter(identity, { ...letter(2), nestId: 'another-nest' });

    expect(await readArchive(identity, NEST)).toHaveLength(1);
    expect(await readArchive(identity)).toHaveLength(2);
  });

  it('stores nothing readable', async () => {
    await archiveLetter(identity, letter(1, 'the roof is done'));
    expect([...store.values()].join()).not.toContain('roof');
  });
});

describe('reporting whether a letter is safe', () => {
  it('says yes only when the server took it', async () => {
    expect(await keepLetter(identity, letter(1))).toBe(true);
    expect(server.entries.size).toBe(1);
  });

  /*
   * The important one. The caller burns the one-time prekey when this returns
   * true, and a burned prekey cannot be recovered — so a failed upload must
   * report false and leave the letter re-openable.
   */
  it('says no when the upload fails, so the key is not destroyed', async () => {
    server.failPost = true;
    expect(await keepLetter(identity, letter(1))).toBe(false);
    expect(server.entries.size).toBe(0);
  });
});

describe('syncing with the server', () => {
  it('pulls a letter this device has never seen', async () => {
    const theirs = letter(7, 'written on the phone');
    server.entries.set(theirs.letterId, sealArchiveEntry(identity, theirs));

    const { pulled } = await syncArchive(identity);

    expect(pulled).toBe(1);
    expect((await readArchive(identity, NEST))[0]!.text).toBe('written on the phone');
  });

  it('pushes letters the server does not have yet', async () => {
    await archiveLetter(identity, letter(1));
    await archiveLetter(identity, letter(2));

    const { pushed } = await syncArchive(identity);

    expect(pushed).toBe(2);
    expect(server.entries.size).toBe(2);
  });

  it('does nothing when both sides already agree', async () => {
    await archiveLetter(identity, letter(1));
    await syncArchive(identity);

    server.posts = 0;
    const again = await syncArchive(identity);

    expect(again).toEqual({ pulled: 0, pushed: 0 });
    expect(server.posts, 'a settled archive should not keep uploading').toBe(0);
  });

  it('leaves the local copy alone when the network is down', async () => {
    await archiveLetter(identity, letter(1, 'still here'));
    server.failGet = true;

    expect(await syncArchive(identity)).toEqual({ pulled: 0, pushed: 0 });
    expect((await readArchive(identity, NEST))[0]!.text).toBe('still here');
  });

  it('ignores an entry it cannot open rather than losing the rest', async () => {
    const good = letter(1, 'readable');
    server.entries.set(good.letterId, sealArchiveEntry(identity, good));
    server.entries.set('0000009-0000-4000-8000-000000000000', 'not-a-real-blob');

    const { pulled } = await syncArchive(identity);

    expect(pulled).toBe(1);
    expect(await readArchive(identity)).toHaveLength(1);
  });

  it('gives a wiped device its whole history back', async () => {
    // Two letters read on a phone, then pushed up.
    await archiveLetter(identity, letter(1, 'first'));
    await archiveLetter(identity, letter(2, 'second'));
    await syncArchive(identity);

    // The phone is wiped: cleared site data, new laptop, same twelve words.
    store.clear();
    expect(await readArchive(identity)).toHaveLength(0);

    const { pulled } = await syncArchive(identity);

    expect(pulled).toBe(2);
    const back = await readArchive(identity, NEST);
    expect(back.map((l) => l.text).sort()).toEqual(['first', 'second']);
  });
});

describe('taking the letters with you', () => {
  it('writes every letter, oldest first, with its words intact', () => {
    const file = letterFile([
      { ...letter(2, 'the second one'), direction: 'received' },
      { ...letter(1, 'the first one'), direction: 'sent' },
    ]);

    expect(file).toContain('the first one');
    expect(file).toContain('the second one');
    expect(file.indexOf('the first one')).toBeLessThan(file.indexOf('the second one'));
    expect(file).toContain('2 letters');
  });

  it('says which way each one went', () => {
    const file = letterFile([{ ...letter(1), direction: 'sent' }]);
    expect(file).toContain('Toronto to Hyderabad');
    expect(file).toContain('Written');
    expect(file).toContain('Landed');
  });

  it('keeps line breaks and scripts that are not English', () => {
    const text = 'پہلی سطر\nدوسری سطر';
    const file = letterFile([letter(1, text)]);
    expect(file).toContain(text);
  });

  it('is readable on its own, with no keys or ciphertext in it', () => {
    const file = letterFile([letter(1, 'plain words')]);
    expect(file).not.toMatch(/[A-Za-z0-9_-]{60,}/);
    expect(file).toContain('KABOOTAR TALK');
  });

  it('handles an empty archive without producing nonsense', () => {
    const file = letterFile([]);
    expect(file).toContain('0 letters');
  });
});
