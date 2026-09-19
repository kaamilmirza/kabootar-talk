import { z } from 'zod';

import * as db from '@/lib/db/queries';
import { feed, pet, urge } from '@/lib/pigeon/life';
import { viewOf } from '@/lib/server/flock';
import { assertSameOrigin, badRequest, json, notFound, parseBody, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(['feed', 'pet', 'urge', 'rename']),
  /** Only for rename. */
  name: z.string().trim().min(1).max(24).optional(),
});

/**
 * Looking after a kabootar.
 *
 * Every action re-derives her condition from the stored values and the clock
 * before deciding anything, so nothing depends on a background job having run,
 * and a client cannot talk her into being less tired than she is.
 */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const pigeonId = uuid.parse((await params).id);

  const input = await parseBody(request, schema);

  const row = await db.findPigeon(pigeonId, userId);
  if (!row) throw notFound('No such kabootar.');

  const state = db.toPigeonState(row, userId);
  const now = Date.now();

  if (input.action === 'rename') {
    if (!input.name) throw badRequest('She needs a name.');
    await db.renamePigeon(pigeonId, userId, input.name);

    const updated = await db.findPigeon(pigeonId, userId);
    return json({ pigeon: viewOf(db.toPigeonState(updated!, userId), now) });
  }

  if (input.action === 'feed') {
    if (state.place !== 'with-you') throw badRequest('She is not with you.');

    const vitals = feed(state, now);
    const fed = await db.feedPigeon(pigeonId, userId, vitals);
    if (!fed) throw badRequest('She has just been fed.');
  }

  if (input.action === 'pet') {
    if (state.place !== 'with-you') throw badRequest('She is not with you.');

    const vitals = pet(state, now);
    const petted = await db.petPigeon(pigeonId, userId, vitals);
    if (!petted) throw badRequest('She has had quite enough fussing for today.');
  }

  if (input.action === 'urge') {
    // Only the person who sent her can push her, and only mid-flight.
    if (state.place !== 'flying') throw badRequest('She is not flying.');

    const result = urge(state, now);
    if (!result) throw badRequest('She has been pushed as hard as she will go.');

    const urged = await db.urgePigeon({
      pigeonId,
      senderId: userId,
      arrivesAt: new Date(result.arrivesAt),
      vitals: result.vitals,
    });
    if (!urged) throw badRequest('She cannot be pushed any further.');

    // The letter she is carrying arrives sooner too.
    await db.accelerateLetter(pigeonId, result.savedMs);
  }

  const updated = await db.findPigeon(pigeonId, userId);
  if (!updated) throw notFound('No such kabootar.');

  return json({ pigeon: viewOf(db.toPigeonState(updated, userId), Date.now()) });
});
