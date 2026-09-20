import * as db from '@/lib/db/queries';
import { LIMITS } from '@/lib/server/config';
import { assertSameOrigin, json, parseBody, route, tooMany } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { archivePutSchema } from '@/lib/server/validation';

/**
 * The letters this account is keeping.
 *
 * Everything returned is ciphertext sealed under a key derived from the
 * owner's recovery phrase, so this endpoint hands back something it cannot
 * read to someone who has already proved they hold the identity. A device
 * restored from the phrase calls this once and has the whole history back.
 */
export const GET = route(async () => {
  const userId = await requireUserId();
  const rows = await db.listArchiveEntries(userId);

  return json({
    entries: rows.map((row) => ({
      letterId: row.letter_id,
      blob: row.blob,
      updatedAt: row.updated_at.getTime(),
    })),
  });
});

/**
 * Keep a letter, from whichever device just read or wrote it.
 *
 * Batched because a device coming back online may have several to push, and
 * because the first sync after this shipped has to carry everything already
 * sitting in local storage.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();

  const { entries } = await parseBody(request, archivePutSchema);

  /*
   * Two bounds, because this is the only endpoint that grows storage on
   * demand. The rate limit stops a loop; the count stops a slow fill. Neither
   * is reachable by anybody writing letters.
   */
  if (await db.isRateLimited(`archive:${userId}`, LIMITS.archiveWritesPerHour, 3600)) {
    throw tooMany('Slow down.');
  }

  if ((await db.countArchiveEntries(userId)) + entries.length > LIMITS.maxArchiveEntries) {
    throw tooMany('Your archive is full.');
  }

  await db.putArchiveEntries(userId, entries);

  return json({ kept: await db.countArchiveEntries(userId) });
});
