import { pickLine, EARLY_PEEK_LINES } from '@/lib/flight/tamper';
import * as db from '@/lib/db/queries';
import { assertSameOrigin, json, notFound, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

/**
 * Collect a delivered letter.
 *
 * `findDeliveredLetter` will not return a row before the arrival time, so
 * there is no code path here that can hand over an early body. Asking anyway
 * is a perfectly natural thing to try, so it gets a 425 and a straight answer
 * rather than a scolding.
 */
export const GET = route(async (_request: Request, { params }: Context) => {
  const userId = await requireUserId();
  const letterId = uuid.parse((await params).id);

  const letter = await db.findDeliveredLetter(letterId, userId);
  if (!letter) {
    return json(
      {
        error: 'Still in flight.',
        pigeon: pickLine(EARLY_PEEK_LINES, Date.now() / 60_000),
      },
      { status: 425 },
    );
  }

  return json({
    id: letter.id,
    senderId: letter.sender_id,
    header: letter.header,
    manifest: letter.manifest,
    body: letter.body,
    mode: letter.mode,
    departedAt: letter.departed_at.getTime(),
    arrivesAt: letter.arrives_at.getTime(),
    openedAt: letter.opened_at?.getTime() ?? null,
  });
});

/** Mark a letter as read, so the sender can see it landed and was opened. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const letterId = uuid.parse((await params).id);

  const letter = await db.findDeliveredLetter(letterId, userId);
  if (!letter) throw notFound('No such letter.');

  await db.markOpened(letterId, userId);
  return json({ ok: true });
});
