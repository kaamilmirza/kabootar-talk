/**
 * Whether a device still holds the keys it published.
 *
 * This decides whether the app throws away the account's published prekeys
 * and issues new ones, which is the most destructive thing it can do to
 * itself: get it wrong on a healthy device and every letter currently in the
 * air becomes unopenable. So the false positive is the case under test, not
 * the happy path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateRecoveryPhrase, identityFromPhrase } from '../crypto/identity';

const store = new Map<string, string>();

vi.mock('./idb', () => ({
  STORES: { vault: 'vault', prekeys: 'prekeys', letters: 'letters', places: 'places' },
  idb: vi.fn(async (_s: string, _m: string, run: (s: unknown) => { result?: unknown }) => {
    const shim = {
      get: (key: string) => ({ result: store.get(key) }),
      put: (value: string, key: string) => {
        store.set(key, value);
        return { result: undefined };
      },
      delete: (key: string) => {
        store.delete(key);
        return { result: undefined };
      },
    };
    return run(shim as never).result;
  }),
}));

const { generateInitialPreKeys, preKeyStoreState, reKeyDevice, preKeySecretsFor, rotateSignedPreKey } =
  await import('./prekeys');

const identity = identityFromPhrase(generateRecoveryPhrase());

beforeEach(() => store.clear());

describe('deciding whether this device still has its keys', () => {
  it('says healthy for a device that just registered', async () => {
    await generateInitialPreKeys(identity, 20);
    expect(await preKeyStoreState(identity, 1)).toBe('healthy');
  });

  it('says healthy after the signed prekey rotates', async () => {
    await generateInitialPreKeys(identity, 20);
    await rotateSignedPreKey(identity, 2);

    // Both, because a letter in flight was sealed against the old one.
    expect(await preKeyStoreState(identity, 2)).toBe('healthy');
    expect(await preKeyStoreState(identity, 1)).toBe('healthy');
  });

  it('says empty for a device that has been wiped', async () => {
    await generateInitialPreKeys(identity, 20);
    store.clear(); // cleared browser storage

    expect(await preKeyStoreState(identity, 1)).toBe('empty');
  });

  it('says empty when the store has no secret for the advertised key', async () => {
    await generateInitialPreKeys(identity, 20);

    // The server is handing out a signed prekey this device never made.
    expect(await preKeyStoreState(identity, 9)).toBe('empty');
  });

  /*
   * The dangerous one. A store that will not decrypt is not the same as a
   * store that is not there: re-keying on it would discard keys that are
   * still perfectly good and strand every letter in the air.
   */
  it('says unreadable rather than empty when the store will not open', async () => {
    await generateInitialPreKeys(identity, 20);
    store.set(identity.id, 'this-is-not-a-valid-sealed-blob');

    expect(await preKeyStoreState(identity, 1)).toBe('unreadable');
  });

  it('says unreadable for another identity’s store, never empty', async () => {
    await generateInitialPreKeys(identity, 20);

    const stranger = identityFromPhrase(generateRecoveryPhrase());
    store.set(stranger.id, store.get(identity.id)!);

    expect(await preKeyStoreState(stranger, 1)).toBe('unreadable');
  });
});

describe('re-keying a restored device', () => {
  it('produces a usable signed prekey and pool', async () => {
    const fresh = await reKeyDevice(identity, 2, 10, 100);

    expect(fresh.signedPreKey.id).toBe(2);
    expect(fresh.oneTimePreKeys).toHaveLength(10);
    expect(await preKeyStoreState(identity, 2)).toBe('healthy');

    const secrets = await preKeySecretsFor(identity, 2, fresh.oneTimePreKeys[0]!.id);
    expect(secrets).not.toBeNull();
  });

  it('never reissues an id that was already used', async () => {
    await generateInitialPreKeys(identity, 20);
    const fresh = await reKeyDevice(identity, 2, 10, 100);

    // Ids continue above the high-water mark the server reported, so a letter
    // in flight that names an old id can never be matched to a new secret.
    expect(Math.min(...fresh.oneTimePreKeys.map((k) => k.id))).toBeGreaterThan(100);
  });

  it('drops the old secrets, which are unusable anyway', async () => {
    await generateInitialPreKeys(identity, 20);
    await reKeyDevice(identity, 2, 10, 100);

    expect(await preKeySecretsFor(identity, 1, 1)).toBeNull();
  });
});
