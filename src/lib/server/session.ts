import 'server-only';

import { cookies } from 'next/headers';

import { b64, hash, randomBytes, unb64, utf8 } from '../crypto/primitives';
import * as db from '../db/queries';
import { isProduction, LIMITS } from './config';
import { unauthorized } from './http';

const COOKIE = 'kabootar_session';

/**
 * Only a hash of the session token is stored.
 *
 * A database dump therefore contains nothing that can be replayed as a login —
 * the same reason password hashes exist, applied to sessions.
 */
function tokenHash(token: string): Uint8Array {
  return hash(utf8('kabootar/session/v1'), unb64(token));
}

export async function startSession(userId: string): Promise<void> {
  const token = b64(randomBytes(32));
  await db.createSession(tokenHash(token), userId, LIMITS.sessionDays);

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    // Strict, not Lax: nothing in this app is meant to be reachable by
    // following a link from somewhere else, so there is no reason to loosen it.
    sameSite: 'strict',
    path: '/',
    maxAge: LIMITS.sessionDays * 24 * 3600,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    try {
      await db.deleteSession(tokenHash(token));
    } catch {
      // A malformed cookie is not worth failing a sign-out over.
    }
  }
  jar.delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const session = await db.findSession(tokenHash(token));
    return session?.user_id ?? null;
  } catch {
    return null;
  }
}

export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw unauthorized();
  return userId;
}
