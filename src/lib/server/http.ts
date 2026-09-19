import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

/**
 * Errors the client is allowed to see.
 *
 * Deliberately vague where being specific would help an attacker: a bad
 * pairing code and an expired one look identical from outside, so a guesser
 * learns nothing from the difference.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new ApiError(400, m);
export const unauthorized = (m = 'Sign in first.') => new ApiError(401, m);
export const forbidden = (m = 'Not your nest.') => new ApiError(403, m);
export const notFound = (m = 'Not found.') => new ApiError(404, m);
export const tooMany = (m = 'Slow down.') => new ApiError(429, m);

export function json(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data as never, init);
  // Clients compare this against their own clock to spot a skewed device.
  response.headers.set('x-kabootar-time', String(Date.now()));
  return response;
}

/**
 * Wraps a route so no unexpected error ever reaches the client.
 *
 * An unhandled exception is logged server-side and returned as a flat 500 with
 * no message: stack traces and driver errors leak schema details and library
 * versions, and none of that belongs in a response.
 */
export function route<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message, ...error.extra }, { status: error.status });
      }
      if (error instanceof ZodError) {
        return json({ error: 'That request did not look right.' }, { status: 400 });
      }

      console.error('[kabootar] unhandled error', error);
      return json({ error: 'Something went wrong.' }, { status: 500 });
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('Expected JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest('That request did not look right.');
  return result.data;
}

/**
 * Cross-site request forgery guard.
 *
 * Session cookies are already SameSite=Strict, which is the real defence. This
 * is a second, independent check so a browser bug or a future cookie change
 * cannot silently open a hole.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // Same-origin navigations and server-side calls send none.

  const host = request.headers.get('host');
  if (!host) throw forbidden('Bad origin.');

  try {
    if (new URL(origin).host !== host) throw forbidden('Bad origin.');
  } catch {
    throw forbidden('Bad origin.');
  }
}

/** Best guess at the caller's address, for rate limiting only. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
