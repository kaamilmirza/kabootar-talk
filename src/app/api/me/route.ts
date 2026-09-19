import * as db from '@/lib/db/queries';
import { LIMITS } from '@/lib/server/config';
import { json, notFound, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';

/** Who am I, and do I need to top up my prekeys? */
export const GET = route(async () => {
  const userId = await requireUserId();

  const [user, available, signed] = await Promise.all([
    db.findUser(userId),
    db.countAvailablePreKeys(userId),
    db.currentSignedPreKey(userId),
  ]);

  if (!user) throw notFound('Unknown identity.');

  const ageDays = signed
    ? (Date.now() - signed.created_at.getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;

  return json({
    userId,
    signingKey: user.signing_key,
    identityKey: user.identity_key,
    limits: { maxNests: LIMITS.maxNests, worldMapMinimum: LIMITS.worldMapMinimum },
    preKeys: {
      available,
      needsTopUp: available < LIMITS.preKeyLowWater,
      batchSize: LIMITS.preKeyBatch,
      nextId: await db.highestPreKeyId(userId),
    },
    signedPreKey: {
      id: signed?.id ?? 0,
      needsRotation: ageDays > LIMITS.signedPreKeyMaxAgeDays,
    },
  });
});
