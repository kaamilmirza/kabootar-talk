'use client';

/**
 * The slow hashes, run somewhere they will not freeze the interface.
 *
 * Two things in this app use Argon2id: unlocking the vault with a PIN, and
 * hashing a pairing code. Both are deliberately expensive, and both used to
 * run on the main thread, which meant the app locked solid for several seconds
 * at exactly the two moments a person is waiting on it.
 *
 * Parameters are a considered trade, not a default. OWASP's baseline for
 * Argon2id is 19 MiB with t=2; this uses 64 MiB with t=3, comfortably above
 * that, while landing near a second on a phone rather than seven.
 *
 * Worth being plain about the limit: a six-digit PIN is twenty bits, and no
 * key-stretching cost makes twenty bits strong against someone who has taken
 * a copy of the vault. The PIN buys time, not safety. A passkey is bound to
 * the device's secure element and cannot be copied at all, which is why it is
 * the option offered first.
 */

import { argon2id } from '@noble/hashes/argon2.js';

import type { KdfRequest, KdfResponse } from './kdf.worker';

export interface ArgonParams {
  t: number;
  m: number;
  p: number;
  dkLen: number;
}

/** What new vaults and pairing codes use today. */
export const ARGON: ArgonParams = { t: 3, m: 65536, p: 1, dkLen: 32 };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (key: Uint8Array) => void; reject: (e: Error) => void }>();

/** Whether the heavy hashing is genuinely running off the main thread. */
export function usingWorker(): boolean {
  return worker !== null && !workerFailed;
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerFailed || typeof Worker === 'undefined') return null;

  try {
    // `type: 'module'` is required, not optional: the worker is ESM, and
    // constructing it as a classic worker fails on the first import — which
    // the fallback below would then quietly absorb by running Argon2id on the
    // main thread, reintroducing exactly the freeze this file exists to avoid.
    worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<KdfResponse>) => {
      const { id, key, error } = event.data;
      const waiting = pending.get(id);
      if (!waiting) return;

      pending.delete(id);
      if (key) waiting.resolve(new Uint8Array(key));
      else waiting.reject(new Error(error ?? 'Key derivation failed.'));
    };

    worker.onerror = () => {
      // Fail every outstanding request rather than hanging the caller; the
      // next call will fall back to the main thread.
      for (const [, waiting] of pending) waiting.reject(new Error('Key derivation failed.'));
      pending.clear();
      worker?.terminate();
      worker = null;
      workerFailed = true;
    };

    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/**
 * Derive a key with Argon2id, in a worker when one is available.
 *
 * Falls back to the main thread rather than failing: a browser without workers
 * should still be able to unlock, even if it stutters doing it.
 */
export function stretch(
  password: Uint8Array,
  salt: Uint8Array,
  params: ArgonParams = ARGON,
): Promise<Uint8Array> {
  const w = getWorker();
  if (!w) return Promise.resolve(argon2id(password, salt, params));

  return new Promise<Uint8Array>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });

    const request: KdfRequest = { id, password, salt, ...params };
    w.postMessage(request);
  }).catch(() => argon2id(password, salt, params));
}
