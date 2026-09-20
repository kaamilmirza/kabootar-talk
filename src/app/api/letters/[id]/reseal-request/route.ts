import * as db from '@/lib/db/queries';
import { assertSameOrigin, json, notFound, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

/**
 * Tell the sender this one would not open.
 *
 * Raised by a device that has the letter but not the key it was sealed for,
 * which is what a cleared browser leaves behind. It carries no reason and no
 * key material: the server records only that a repair was asked for, and the
 * sender's own kept copy does the rest.
 */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const letterId = uuid.parse((await params).id);

  if (!(await db.requestReseal(letterId, userId))) {
    throw notFound('No such letter.');
  }

  return json({ ok: true });
});
