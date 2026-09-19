import * as db from '@/lib/db/queries';
import { assertSameOrigin, forbidden, json, notFound, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { hatchNames } from '@/lib/pigeon/names';
import { flockFor } from '@/lib/server/flock';
import { uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Context) => {
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const nest = await db.findNest(nestId, userId);
  if (!nest) throw notFound('No such nest.');

  const partnerId = nest.low_user_id === userId ? nest.high_user_id : nest.low_user_id;

  const [flock, next] = await Promise.all([
    nest.status === 'active' ? flockFor(nestId, userId, Date.now()) : Promise.resolve([]),
    db.nextArrival(nestId),
  ]);

  return json({
    id: nest.id,
    status: nest.status,
    partner: {
      id: partnerId,
      signingKey: nest.partner_signing_key,
      identityKey: nest.partner_identity_key,
    },
    awaitingYou: nest.status === 'pending' && nest.requested_by !== userId,
    flock,
    nextArrivalAt: next?.arrives_at.getTime() ?? null,
  });
});

/** Confirm a pending nest — only the person who issued the code may do this. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const confirmed = await db.confirmNest(nestId, userId);
  if (!confirmed) throw forbidden('That nest is not yours to confirm.');

  // Two birds, one at each end. Hatched once, when the pair first agree.
  const nest = await db.findNest(nestId, userId);
  if (nest && (await db.countPigeons(nestId)) === 0) {
    await db.hatchPigeons(nestId, nest.low_user_id, nest.high_user_id, hatchNames());
  }

  return json({ id: confirmed.id, status: 'active' });
});

/** Close a nest. Either side may do it, and it stops all further letters. */
export const DELETE = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const nest = await db.findNest(nestId, userId);
  if (!nest) throw notFound('No such nest.');

  await db.closeNest(nestId, userId);
  return json({ ok: true });
});
