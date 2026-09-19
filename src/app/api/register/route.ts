import { ed25519 } from '@noble/curves/ed25519.js';

import { deriveUserId } from '@/lib/crypto/identity';
import { concat, unb64, utf8 } from '@/lib/crypto/primitives';
import * as db from '@/lib/db/queries';
import { RATE_LIMITS } from '@/lib/server/config';
import { assertSameOrigin, badRequest, clientIp, json, parseBody, route, tooMany } from '@/lib/server/http';
import { startSession } from '@/lib/server/session';
import { registerSchema } from '@/lib/server/validation';

/**
 * Create an account.
 *
 * "Account" overstates it: this stores two public keys and a pile of prekeys.
 * There is no name, no email and no password, because the client already holds
 * the only secret that matters and the server has no use for anything else.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  if (await db.isRateLimited(`register:${clientIp(request)}`, RATE_LIMITS.register.hits, RATE_LIMITS.register.windowSeconds)) {
    throw tooMany('Too many new coops from here. Try again later.');
  }

  const input = await parseBody(request, registerSchema);

  // The id is derived from the key, never accepted from the client, so nobody
  // can register under an id belonging to somebody else.
  const signingKey = unb64(input.signingKey);
  const id = deriveUserId(signingKey);

  // Verify the signed prekey here too. The recipient's client checks this
  // independently, but refusing to store a bad bundle keeps the damage from
  // a broken or malicious client contained to that client.
  const signedMessage = concat(
    utf8('kabootar/signed-prekey/v1'),
    unb64(input.signedPreKey.publicKey),
  );

  let signatureOk = false;
  try {
    signatureOk = ed25519.verify(unb64(input.signedPreKey.signature), signedMessage, signingKey);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw badRequest('Signed prekey signature did not verify.');

  const existing = await db.findUser(id);
  if (existing && existing.signing_key !== input.signingKey) {
    throw badRequest('That identity is already registered with different keys.');
  }

  await db.createUser({ id, signingKey: input.signingKey, identityKey: input.identityKey });
  await db.upsertSignedPreKey({
    userId: id,
    id: input.signedPreKey.id,
    publicKey: input.signedPreKey.publicKey,
    signature: input.signedPreKey.signature,
  });
  await db.insertOneTimePreKeys(id, input.oneTimePreKeys);

  await startSession(id);
  await db.purgeExpired();

  return json({ userId: id });
});
