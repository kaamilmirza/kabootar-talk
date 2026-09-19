import { b64, randomBytes } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { LIMITS, RATE_LIMITS } from '@/lib/server/config';
import { assertSameOrigin, clientIp, json, parseBody, route, tooMany } from '@/lib/server/http';
import { challengeSchema } from '@/lib/server/validation';

/**
 * Step one of signing in: ask for a nonce to sign.
 *
 * A nonce is issued whether or not the account exists, and is always the same
 * shape, so this endpoint cannot be used to find out which ids are registered.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  if (await db.isRateLimited(`auth:${clientIp(request)}`, RATE_LIMITS.auth.hits, RATE_LIMITS.auth.windowSeconds)) {
    throw tooMany('Too many attempts. Try again shortly.');
  }

  const { userId } = await parseBody(request, challengeSchema);
  const nonce = randomBytes(32);

  const user = await db.findUser(userId);
  if (user) {
    await db.createChallenge(nonce, userId, LIMITS.challengeTtlSeconds);
  }

  // An unknown id still gets a well-formed nonce; it simply will not verify.
  return json({ nonce: b64(nonce), expiresIn: LIMITS.challengeTtlSeconds });
});
