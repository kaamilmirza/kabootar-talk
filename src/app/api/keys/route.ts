import { ed25519 } from '@noble/curves/ed25519.js';
import { z } from 'zod';

import { concat, unb64, utf8 } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { assertSameOrigin, badRequest, json, notFound, parseBody, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { preKeysSchema, signedPreKeySchema } from '@/lib/server/validation';

const schema = z.object({
  oneTimePreKeys: preKeysSchema.shape.oneTimePreKeys.optional(),
  signedPreKey: signedPreKeySchema.optional(),
});

/**
 * Top up one-time prekeys, and rotate the signed prekey.
 *
 * Clients call this whenever their pool runs low. Running out is not fatal —
 * X3DH degrades to a session without a one-time prekey — but it costs
 * per-letter forward secrecy until the pool is refilled, so it is worth doing
 * eagerly.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();

  const input = await parseBody(request, schema);
  if (!input.oneTimePreKeys && !input.signedPreKey) {
    throw badRequest('Nothing to publish.');
  }

  if (input.signedPreKey) {
    const user = await db.findUser(userId);
    if (!user) throw notFound('Unknown identity.');

    const message = concat(
      utf8('kabootar/signed-prekey/v1'),
      unb64(input.signedPreKey.publicKey),
    );

    let ok = false;
    try {
      ok = ed25519.verify(unb64(input.signedPreKey.signature), message, unb64(user.signing_key));
    } catch {
      ok = false;
    }
    if (!ok) throw badRequest('Signed prekey signature did not verify.');

    await db.upsertSignedPreKey({ userId, ...input.signedPreKey });
  }

  if (input.oneTimePreKeys) {
    await db.insertOneTimePreKeys(userId, input.oneTimePreKeys);
  }

  // Clear out prekeys that have already been used while we are here. This is
  // the endpoint a client hits whenever its pool runs low, which makes it the
  // natural place for the housekeeping to happen on a live account.
  await db.pruneClaimedPreKeys();

  return json({ available: await db.countAvailablePreKeys(userId) });
});
