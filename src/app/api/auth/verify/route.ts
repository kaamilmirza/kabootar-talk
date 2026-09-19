import { ed25519 } from '@noble/curves/ed25519.js';

import { concat, unb64, utf8 } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { RATE_LIMITS } from '@/lib/server/config';
import { assertSameOrigin, clientIp, json, parseBody, route, tooMany, unauthorized } from '@/lib/server/http';
import { startSession } from '@/lib/server/session';
import { verifySchema } from '@/lib/server/validation';

/** The message a client signs to prove it holds the identity key. */
export const AUTH_CONTEXT = 'kabootar/auth/v1';

/**
 * Step two of signing in: hand back a signature over the nonce.
 *
 * There is no password to check, phish, reuse or leak — possession of the key
 * derived from the recovery phrase is the whole proof. The nonce is consumed
 * by the lookup itself, so a captured signature cannot be replayed.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  if (await db.isRateLimited(`auth:${clientIp(request)}`, RATE_LIMITS.auth.hits, RATE_LIMITS.auth.windowSeconds)) {
    throw tooMany('Too many attempts. Try again shortly.');
  }

  const input = await parseBody(request, verifySchema);

  const challenge = await db.consumeChallenge(unb64(input.nonce));
  if (!challenge || challenge.user_id !== input.userId) {
    throw unauthorized('That sign-in attempt has expired. Try again.');
  }

  const user = await db.findUser(input.userId);
  if (!user) throw unauthorized('Unknown identity.');

  const message = concat(utf8(AUTH_CONTEXT), unb64(input.nonce));

  let ok = false;
  try {
    ok = ed25519.verify(unb64(input.signature), message, unb64(user.signing_key));
  } catch {
    ok = false;
  }
  if (!ok) throw unauthorized('Signature did not verify.');

  await startSession(user.id);
  return json({ userId: user.id });
});
