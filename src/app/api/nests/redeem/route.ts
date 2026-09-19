import { unb64 } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { LIMITS, RATE_LIMITS } from '@/lib/server/config';
import { assertSameOrigin, badRequest, clientIp, json, parseBody, route, tooMany } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { inviteSchema } from '@/lib/server/validation';

/**
 * Use someone's pairing code.
 *
 * This does not start a conversation. It creates a *pending* nest and waits
 * for the person who issued the code to approve you. Both halves of that are
 * required, which is what makes unsolicited contact impossible rather than
 * merely discouraged.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();

  if (await db.isRateLimited(`redeem:${clientIp(request)}`, RATE_LIMITS.redeem.hits, RATE_LIMITS.redeem.windowSeconds)) {
    throw tooMany('Too many pairing attempts. Try again later.');
  }

  if ((await db.countNests(userId)) >= LIMITS.maxNests) {
    throw tooMany('Your coop is full.');
  }

  const { codeHash } = await parseBody(request, inviteSchema);
  const invite = await db.claimInvite(unb64(codeHash), userId);

  // Wrong, expired, already used and self-issued codes all answer identically,
  // so a guesser learns nothing from which one they hit.
  if (!invite) throw badRequest('That pairing code is not valid.');

  if ((await db.countNests(invite.inviter_id)) >= LIMITS.maxNests) {
    throw badRequest('That pairing code is not valid.');
  }

  const nest = await db.createPendingNest(invite.inviter_id, userId);
  if (!nest) throw badRequest('That pairing code is not valid.');

  return json({ nestId: nest.id, status: nest.status });
});
