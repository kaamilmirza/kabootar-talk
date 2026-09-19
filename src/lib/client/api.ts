'use client';

/**
 * Talking to the server.
 *
 * Every response carries the server's clock in `x-kabootar-time`. We keep the
 * offset and use it everywhere a flight is drawn, so the pigeon's position is
 * always computed against real time rather than whatever this device believes.
 * A wrong clock then becomes a cosmetic problem instead of a way to hurry a
 * letter along.
 */

import { checkClock, type ClockCheck } from '../flight/tamper';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let serverOffsetMs = 0;
let lastClockCheck: ClockCheck | null = null;
const listeners = new Set<() => void>();

/** Server time, as best this device can tell. Use this, never Date.now(). */
export function now(): number {
  return Date.now() - serverOffsetMs;
}

export function clockCheck(): ClockCheck | null {
  return lastClockCheck;
}

export function onClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function recordServerTime(header: string | null): void {
  if (!header) return;

  const serverNow = Number(header);
  if (!Number.isFinite(serverNow)) return;

  const deviceNow = Date.now();
  serverOffsetMs = deviceNow - serverNow;

  const previous = lastClockCheck?.suspicious;
  lastClockCheck = checkClock(deviceNow, serverNow);

  if (previous !== lastClockCheck.suspicious) {
    for (const listener of listeners) listener();
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      // Presence of this header means the request cannot be a simple
      // cross-origin form post, which is a second line of CSRF defence.
      'x-kabootar': '1',
      ...init?.headers,
    },
    credentials: 'same-origin',
  });

  recordServerTime(response.headers.get('x-kabootar-time'));

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : 'Something went wrong.',
      payload,
    );
  }

  return payload as T;
}

export const get = <T,>(path: string) => api<T>(path);

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });
