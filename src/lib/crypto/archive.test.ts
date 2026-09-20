/**
 * Keeping letters, and the two things that have to hold for it to be safe.
 *
 * One: the same recovery phrase on a different device must produce the same
 * key, because that is the entire mechanism by which history follows you
 * around without anything being transferred.
 *
 * Two: a blob must only ever open as the letter it was sealed for. The server
 * chooses which blob it returns under which id, so a substitution has to fail
 * loudly rather than show the right words against the wrong date.
 */

import { describe, expect, it } from 'vitest';

import { archiveKey, openArchiveEntry, sealArchiveEntry, type ArchivedLetter } from './archive';
import { generateRecoveryPhrase, identityFromPhrase } from './identity';
import { b64, unb64 } from './primitives';

const LETTER_A = '11111111-1111-4111-8111-111111111111';
const LETTER_B = '22222222-2222-4222-8222-222222222222';

function letter(id: string, text = 'The roof is finished.'): ArchivedLetter {
  return {
    letterId: id,
    nestId: '33333333-3333-4333-8333-333333333333',
    direction: 'received',
    text,
    writtenAt: 1_700_000_000_000,
    departedAt: 1_700_000_100_000,
    arrivesAt: 1_700_086_500_000,
    manifest: {
      from: { lat: 43.6532, lon: -79.3832, label: 'Toronto' },
      to: { lat: 17.385, lon: 78.4867, label: 'Hyderabad' },
      mode: 'normal',
    },
  };
}

describe('the archive key', () => {
  it('is the same on every device restored from the same phrase', () => {
    const phrase = generateRecoveryPhrase();

    // Two independent restores of the same twelve words: a phone and a laptop
    // that have never spoken to each other.
    const phone = identityFromPhrase(phrase);
    const laptop = identityFromPhrase(phrase);

    expect(b64(archiveKey(laptop))).toBe(b64(archiveKey(phone)));
  });

  it('is different for every identity', () => {
    const mine = identityFromPhrase(generateRecoveryPhrase());
    const theirs = identityFromPhrase(generateRecoveryPhrase());

    expect(b64(archiveKey(theirs))).not.toBe(b64(archiveKey(mine)));
  });

  it('is not the identity key itself', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());
    expect(b64(archiveKey(id))).not.toBe(b64(id.signing.secretKey));
  });
});

describe('a kept letter', () => {
  it('opens on another device with the same phrase', () => {
    const phrase = generateRecoveryPhrase();
    const phone = identityFromPhrase(phrase);
    const laptop = identityFromPhrase(phrase);

    const blob = sealArchiveEntry(phone, letter(LETTER_A));
    const back = openArchiveEntry(laptop, LETTER_A, blob);

    expect(back).not.toBeNull();
    expect(back!.text).toBe('The roof is finished.');
    expect(back!.manifest.to.label).toBe('Hyderabad');
    expect(back!.writtenAt).toBe(1_700_000_000_000);
  });

  it('survives the round trip with every field intact', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());
    const original = letter(LETTER_A);

    expect(openArchiveEntry(id, LETTER_A, sealArchiveEntry(id, original))).toEqual(original);
  });

  it('keeps long text, and text that is not English', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());

    // Three bytes per character in UTF-8, which is what broke the send path
    // once already.
    const urdu = 'خط لکھنے میں وقت لگتا ہے۔ '.repeat(400);
    const blob = sealArchiveEntry(id, letter(LETTER_A, urdu));

    expect(openArchiveEntry(id, LETTER_A, blob)!.text).toBe(urdu);
  });

  it('cannot be opened by anybody else', () => {
    const mine = identityFromPhrase(generateRecoveryPhrase());
    const theirs = identityFromPhrase(generateRecoveryPhrase());

    const blob = sealArchiveEntry(mine, letter(LETTER_A));
    expect(openArchiveEntry(theirs, LETTER_A, blob)).toBeNull();
  });

  it('refuses to open as a different letter', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());

    // A server handing back letter A's blob under letter B's id.
    const blob = sealArchiveEntry(id, letter(LETTER_A));
    expect(openArchiveEntry(id, LETTER_B, blob)).toBeNull();
  });

  it('refuses a blob somebody has edited', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());

    const bytes = unb64(sealArchiveEntry(id, letter(LETTER_A)));
    bytes[bytes.length - 9] ^= 0x01;

    expect(openArchiveEntry(id, LETTER_A, b64(bytes))).toBeNull();
  });

  it('refuses rubbish instead of throwing', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());

    expect(openArchiveEntry(id, LETTER_A, 'not-base64-at-all')).toBeNull();
    expect(openArchiveEntry(id, LETTER_A, '')).toBeNull();
  });

  it('seals to something the server cannot read', () => {
    const id = identityFromPhrase(generateRecoveryPhrase());
    const blob = sealArchiveEntry(id, letter(LETTER_A, 'The roof is finished.'));

    // The plaintext must not be recoverable from the blob by looking at it.
    const raw = new TextDecoder().decode(unb64(blob));
    expect(raw).not.toContain('roof');
    expect(raw).not.toContain('Hyderabad');
  });
});
