/**
 * Key stretching, off the main thread.
 *
 * Argon2id is deliberately expensive — that cost is the only thing standing
 * between a stolen vault and a six-digit PIN. But running it inline froze the
 * whole tab for seconds: no spinner, no scrolling, no response to a tap. The
 * work has to happen; it just must not happen where the interface lives.
 */

import { argon2id } from '@noble/hashes/argon2.js';

export interface KdfRequest {
  id: number;
  password: Uint8Array;
  salt: Uint8Array;
  t: number;
  m: number;
  p: number;
  dkLen: number;
}

export interface KdfResponse {
  id: number;
  key?: Uint8Array;
  error?: string;
}

self.onmessage = (event: MessageEvent<KdfRequest>) => {
  const { id, password, salt, t, m, p, dkLen } = event.data;

  try {
    const key = argon2id(password, salt, { t, m, p, dkLen });
    // Transferred, not copied, so the key never lingers in a second buffer.
    (self as unknown as Worker).postMessage({ id, key } satisfies KdfResponse, [key.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : 'Key derivation failed.',
    } satisfies KdfResponse);
  }
};
