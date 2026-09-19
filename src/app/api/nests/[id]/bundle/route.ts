import * as db from '@/lib/db/queries';
import { assertSameOrigin, forbidden, json, notFound, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

/**
 * Your partner's prekey bundle, for encrypting the next letter.
 *
 * Only reachable for an active nest you are in — prekeys are not public, so
 * nobody can harvest them for an id they have no relationship with.
 *
 * A POST, despite reading like a fetch, because it takes a one-time prekey out
 * of the pool and does not put it back. As a GET it was something a browser
 * might reasonably repeat on its own — a prefetch, a bfcache restore, a retry
 * — and each repeat would quietly drain a prekey.
 *
 * The client must therefore only call this when it is actually about to send.
 */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const nest = await db.findNest(nestId, userId);
  if (!nest) throw notFound('No such nest.');
  if (nest.status !== 'active') throw forbidden('That nest is not active yet.');

  const partnerId = nest.low_user_id === userId ? nest.high_user_id : nest.low_user_id;

  const base = await db.findBundleBase(partnerId);
  if (!base) throw notFound('Your partner has not published keys yet.');

  const oneTime = await db.claimOneTimePreKey(partnerId);

  return json({
    userId: base.user_id,
    signingKey: base.signing_key,
    identityKey: base.identity_key,
    signedPreKeyId: base.spk_id,
    signedPreKey: base.spk_public_key,
    signedPreKeySignature: base.spk_signature,
    ...(oneTime ? { oneTimePreKey: { id: oneTime.id, key: oneTime.public_key } } : {}),
  });
});
