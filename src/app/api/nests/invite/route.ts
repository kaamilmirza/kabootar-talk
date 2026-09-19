import { unb64 } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { LIMITS } from '@/lib/server/config';
import { assertSameOrigin, json, parseBody, route, tooMany } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { inviteSchema } from '@/lib/server/validation';

/**
 * Register a pairing code you generated.
 *
 * Only the Argon2id hash arrives here — the words themselves never leave your
 * device, so there is nothing in the database that could be stolen and used to
 * pair with you.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();

  if ((await db.countOpenInvites(userId)) >= LIMITS.maxOpenInvites) {
    throw tooMany('You already have codes outstanding. Use or cancel one first.');
  }
  if ((await db.countNests(userId)) >= LIMITS.maxNests) {
    throw tooMany('Your coop is full.');
  }

  const { codeHash } = await parseBody(request, inviteSchema);
  await db.createInvite(unb64(codeHash), userId, LIMITS.invitesTtlMinutes);

  return json({ expiresInMinutes: LIMITS.invitesTtlMinutes });
});

/** Cancel every outstanding code, for when one was shared by accident. */
export const DELETE = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  await db.revokeInvites(userId);
  return json({ ok: true });
});
