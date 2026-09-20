import { describe, expect, it } from 'vitest';

import {
  generateRecoveryPhrase,
  identityFromPhrase,
  isValidRecoveryPhrase,
  safetyCheck,
  sign,
  toPublicIdentity,
  verify,
} from './identity';
import { b64, open, seal, timingSafeEqual, unb64, utf8 } from './primitives';
import {
  acceptSession,
  createOneTimePreKeys,
  createSignedPreKey,
  initiateSession,
  verifyBundle,
  type PreKeyBundle,
} from './x3dh';
import {
  MAX_LETTER_CHARS,
  openBody,
  openManifest,
  sealLetter,
  type EnvelopeHeader,
  type FlightManifest,
  type LetterBody,
} from './envelope';

const PHRASE_A =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PHRASE_B =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

const alice = identityFromPhrase(PHRASE_A);
const bob = identityFromPhrase(PHRASE_B);

/** Bob publishes his prekeys; the server would hand this bundle to Alice. */
function bobsBundle() {
  const signed = createSignedPreKey(bob, 1);
  const oneTime = createOneTimePreKeys(3, 100);
  const pub = toPublicIdentity(bob);

  const bundle: PreKeyBundle = {
    userId: pub.id,
    signingKey: pub.signingKey,
    identityKey: pub.identityKey,
    signedPreKeyId: signed.record.id,
    signedPreKey: signed.record.publicKey,
    signedPreKeySignature: signed.signature,
    oneTimePreKey: { id: oneTime[0].id, key: oneTime[0].publicKey },
  };

  return { bundle, signedSecret: signed.record.secretKey, oneTimeSecret: oneTime[0].secretKey };
}

describe('identity', () => {
  it('generates twelve valid words', () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(isValidRecoveryPhrase(phrase)).toBe(true);
  });

  it('rebuilds exactly the same keys from the same phrase', () => {
    const again = identityFromPhrase(PHRASE_A);
    expect(again.id).toBe(alice.id);
    expect(b64(again.signing.publicKey)).toBe(b64(alice.signing.publicKey));
    expect(b64(again.agreement.publicKey)).toBe(b64(alice.agreement.publicKey));
  });

  it('tolerates sloppy retyping', () => {
    expect(identityFromPhrase(`  ${PHRASE_A.toUpperCase()}  `).id).toBe(alice.id);
  });

  it('refuses a phrase with a broken checksum', () => {
    expect(isValidRecoveryPhrase(PHRASE_A.replace('yellow', 'zoo'))).toBe(false);
    expect(() => identityFromPhrase('not even close')).toThrow();
  });

  it('gives different people different ids', () => {
    expect(alice.id).not.toBe(bob.id);
  });

  it('never reuses one key for two algorithms', () => {
    expect(b64(alice.signing.secretKey)).not.toBe(b64(alice.agreement.secretKey));
    expect(b64(alice.signing.publicKey)).not.toBe(b64(alice.agreement.publicKey));
  });

  it('signs and verifies', () => {
    const msg = utf8('a letter for her');
    expect(verify(alice.signing.publicKey, sign(alice, msg), msg)).toBe(true);
    expect(verify(bob.signing.publicKey, sign(alice, msg), msg)).toBe(false);
    expect(verify(alice.signing.publicKey, sign(alice, msg), utf8('tampered'))).toBe(false);
  });
});

describe('safety numbers', () => {
  const pubA = toPublicIdentity(alice);
  const pubB = toPublicIdentity(bob);

  it('matches regardless of which side computes it', () => {
    expect(safetyCheck(pubA, pubB)).toEqual(safetyCheck(pubB, pubA));
  });

  it('produces twelve groups of five digits and eight words', () => {
    const check = safetyCheck(pubA, pubB);
    expect(check.digits).toHaveLength(12);
    for (const group of check.digits) expect(group).toMatch(/^\d{5}$/);
    expect(check.words).toHaveLength(8);
    for (const word of check.words) expect(word).toMatch(/^[a-z]+$/);
  });

  it('changes completely if either key is swapped — this is what catches a MITM', () => {
    const impostor = toPublicIdentity(identityFromPhrase(generateRecoveryPhrase()));
    const honest = safetyCheck(pubA, pubB);
    const attacked = safetyCheck(pubA, impostor);

    expect(attacked.words).not.toEqual(honest.words);
    expect(attacked.digits).not.toEqual(honest.digits);
  });
});

describe('x3dh', () => {
  it('lets both sides derive the same secret while offline', () => {
    const { bundle, signedSecret, oneTimeSecret } = bobsBundle();

    const sent = initiateSession(alice, bundle);
    const received = acceptSession({
      self: bob,
      senderIdentityKey: toPublicIdentity(alice).identityKey,
      header: sent.header,
      signedPreKeySecret: signedSecret,
      oneTimePreKeySecret: oneTimeSecret,
    });

    expect(timingSafeEqual(sent.sharedSecret, received.sharedSecret)).toBe(true);
    expect(timingSafeEqual(sent.associatedData, received.associatedData)).toBe(true);
  });

  it('still works when the one-time prekey pool has run dry', () => {
    const { bundle, signedSecret } = bobsBundle();
    delete bundle.oneTimePreKey;

    const sent = initiateSession(alice, bundle);
    const received = acceptSession({
      self: bob,
      senderIdentityKey: toPublicIdentity(alice).identityKey,
      header: sent.header,
      signedPreKeySecret: signedSecret,
    });

    expect(sent.header.oneTimePreKeyId).toBeNull();
    expect(timingSafeEqual(sent.sharedSecret, received.sharedSecret)).toBe(true);
  });

  it('gives every letter a different secret', () => {
    const { bundle } = bobsBundle();
    const one = initiateSession(alice, bundle);
    const two = initiateSession(alice, bundle);
    expect(timingSafeEqual(one.sharedSecret, two.sharedSecret)).toBe(false);
  });

  it('rejects a bundle whose signed prekey was swapped by the server', () => {
    const { bundle } = bobsBundle();
    const attacker = createSignedPreKey(identityFromPhrase(generateRecoveryPhrase()), 1);
    bundle.signedPreKey = attacker.record.publicKey;

    expect(() => verifyBundle(bundle)).toThrow(/signature is invalid/i);
    expect(() => initiateSession(alice, bundle)).toThrow();
  });

  it('rejects a bundle relabelled with somebody else’s user id', () => {
    const { bundle } = bobsBundle();
    bundle.userId = toPublicIdentity(alice).id;
    expect(() => verifyBundle(bundle)).toThrow(/does not match/i);
  });

  it('rejects a bundle where the whole identity was substituted', () => {
    const { bundle } = bobsBundle();
    const impostor = identityFromPhrase(generateRecoveryPhrase());
    const impostorSigned = createSignedPreKey(impostor, 1);
    const impostorPub = toPublicIdentity(impostor);

    // The server keeps Bob's advertised id but serves the impostor's keys.
    bundle.signingKey = impostorPub.signingKey;
    bundle.identityKey = impostorPub.identityKey;
    bundle.signedPreKey = impostorSigned.record.publicKey;
    bundle.signedPreKeySignature = impostorSigned.signature;

    expect(() => verifyBundle(bundle)).toThrow(/does not match/i);
  });

  it('refuses to open a letter whose one-time prekey is already gone', () => {
    const { bundle, signedSecret } = bobsBundle();
    const sent = initiateSession(alice, bundle);

    expect(() =>
      acceptSession({
        self: bob,
        senderIdentityKey: toPublicIdentity(alice).identityKey,
        header: sent.header,
        signedPreKeySecret: signedSecret,
      }),
    ).toThrow(/no longer holds/i);
  });
});

describe('letters', () => {
  const manifest: FlightManifest = {
    from: { lat: 43.6532, lon: -79.3832, label: 'Toronto' },
    to: { lat: 17.385, lon: 78.4867, label: 'Hyderabad' },
    mode: 'normal',
  };
  const body: LetterBody = { text: 'Assalamu alaikum. I have been thinking...', writtenAt: 1_700_000 };

  function sealed() {
    const { bundle, signedSecret, oneTimeSecret } = bobsBundle();
    const session = initiateSession(alice, bundle);

    const header: EnvelopeHeader = {
      v: 1,
      nestId: 'nest-1',
      senderId: alice.id,
      session: session.header,
      departedAt: 1_700_000,
      arrivesAt: 1_700_000 + 24 * 3_600_000,
      mode: 'normal',
    };

    const letter = sealLetter({
      sharedSecret: session.sharedSecret,
      associatedData: session.associatedData,
      header,
      manifest,
      body,
    });

    const received = acceptSession({
      self: bob,
      senderIdentityKey: toPublicIdentity(alice).identityKey,
      header: session.header,
      signedPreKeySecret: signedSecret,
      oneTimePreKeySecret: oneTimeSecret,
    });

    return {
      letter,
      opener: {
        sharedSecret: received.sharedSecret,
        associatedData: received.associatedData,
        header: letter.header,
      },
    };
  }

  it('round-trips the route and the words', () => {
    const { letter, opener } = sealed();
    expect(openManifest(opener, letter.manifest)).toEqual(manifest);
    expect(openBody(opener, letter.body)).toEqual(body);
  });

  it('keeps the route and the words under separate keys', () => {
    const { letter, opener } = sealed();
    expect(() => openBody(opener, letter.manifest)).toThrow();
    expect(() => openManifest(opener, letter.body)).toThrow();
  });

  it('breaks if the server brings the arrival time forward', () => {
    const { letter, opener } = sealed();
    const rushed = { ...opener, header: { ...letter.header, arrivesAt: Date.now() } };

    expect(() => openBody(rushed, letter.body)).toThrow();
    expect(() => openManifest(rushed, letter.manifest)).toThrow();
  });

  it('breaks if the server rewrites the sender', () => {
    const { letter, opener } = sealed();
    const forged = { ...opener, header: { ...letter.header, senderId: bob.id } };
    expect(() => openBody(forged, letter.body)).toThrow();
  });

  it('breaks if the server moves the letter to another nest', () => {
    const { letter, opener } = sealed();
    const moved = { ...opener, header: { ...letter.header, nestId: 'someone-elses-nest' } };
    expect(() => openBody(moved, letter.body)).toThrow();
  });

  it('breaks if a single ciphertext byte is flipped', () => {
    const { letter, opener } = sealed();
    const bytes = unb64(letter.body);
    bytes[bytes.length - 3] ^= 0x01;
    expect(() => openBody(opener, b64(bytes))).toThrow();
  });

  it('cannot be opened by a third party holding the ciphertext', () => {
    const { letter } = sealed();
    const eve = identityFromPhrase(generateRecoveryPhrase());
    const wrong = {
      sharedSecret: eve.agreement.secretKey,
      associatedData: utf8('guess'),
      header: letter.header,
    };
    expect(() => openBody(wrong, letter.body)).toThrow();
  });

  it('refuses to seal a letter longer than the limit', () => {
    const { bundle } = bobsBundle();
    const session = initiateSession(alice, bundle);
    expect(() =>
      sealLetter({
        sharedSecret: session.sharedSecret,
        associatedData: session.associatedData,
        header: {
          v: 1,
          nestId: 'n',
          senderId: alice.id,
          session: session.header,
          departedAt: 0,
          arrivesAt: 1,
          mode: 'normal',
        },
        manifest,
        body: { text: 'x'.repeat(MAX_LETTER_CHARS + 1), writtenAt: 0 },
      }),
    ).toThrow(/at most/i);
  });
});

describe('primitives', () => {
  it('seals and opens', () => {
    const key = new Uint8Array(32).fill(9);
    const blob = seal(key, utf8('salam'), utf8('aad'));
    expect(new TextDecoder().decode(open(key, blob, utf8('aad')))).toBe('salam');
  });

  it('rejects the wrong associated data', () => {
    const key = new Uint8Array(32).fill(9);
    const blob = seal(key, utf8('salam'), utf8('aad'));
    expect(() => open(key, blob, utf8('different'))).toThrow();
  });

  it('uses a fresh nonce every time', () => {
    const key = new Uint8Array(32).fill(9);
    const a = seal(key, utf8('same'), utf8('aad'));
    const b = seal(key, utf8('same'), utf8('aad'));
    expect(b64(a)).not.toBe(b64(b));
  });

  it('compares in constant time, including on length mismatch', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
