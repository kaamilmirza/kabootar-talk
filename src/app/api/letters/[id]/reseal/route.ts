import { z } from 'zod';

import * as db from '@/lib/db/queries';
import { assertSameOrigin, badRequest, forbidden, json, notFound, parseBody, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { b64Blob, sendLetterSchema, uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

/**
 * Seal a letter again, for the keys the recipient holds now.
 *
 * Prekey secrets are random rather than derived from the recovery phrase, so
 * a recipient who clears their browser loses the ability to open anything
 * sealed for the old device — including letters already in the air. The words
 * are not gone, though: the sender kept them, so they can be sealed a second
 * time and put back in the same row.
 *
 * This is a repair, not a resend. The bird already made the journey, so the
 * departure, the arrival and the carrier all stay exactly as they were: the
 * header is checked against the stored row here, and the columns themselves
 * are never written, so neither layer has to trust the other.
 */
const schema = z.object({
  header: sendLetterSchema.shape.header,
  manifest: b64Blob,
  body: sendLetterSchema.shape.body,
});

export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const letterId = uuid.parse((await params).id);

  const input = await parseBody(request, schema);

  const existing = await db.findLetterForSender(letterId, userId);
  if (!existing) throw notFound('No such letter.');
  if (existing.sender_id !== userId) throw forbidden('Only the sender can seal it again.');

  /*
   * A repair may change the ciphertext and nothing else. Anything that would
   * alter the journey is refused here and, because `resealLetter` matches the
   * timing columns in its predicate, again in SQL.
   */
  if (
    input.header.nestId !== existing.nest_id ||
    input.header.senderId !== userId ||
    input.header.mode !== existing.mode ||
    input.header.departedAt !== existing.departed_at.getTime() ||
    input.header.arrivesAt !== existing.arrives_at.getTime()
  ) {
    throw badRequest('A repair cannot change the journey.');
  }

  const ok = await db.resealLetter({
    letterId,
    senderId: userId,
    header: input.header,
    manifest: input.manifest,
    body: input.body,
  });

  if (!ok) throw notFound('No such letter.');

  return json({ ok: true });
});
