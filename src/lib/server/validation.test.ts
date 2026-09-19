import { describe, expect, it } from 'vitest';

import { sealLetter, type EnvelopeHeader } from '../crypto/envelope';
import { sendLetterSchema } from './validation';

/**
 * Size limits, checked against what the app is actually for.
 *
 * The cap on a sealed letter used to be `MAX_LETTER_CHARS * 4`, which is
 * generous for English and too small for Urdu or Hindi: a full-length letter
 * in a three-byte script seals to about 32,100 base64 characters and was
 * rejected outright, in the app named after the Urdu word for pigeon. These
 * exist so that can never quietly come back.
 */
describe('a sealed letter of every shape fits', () => {
  const secret = new Uint8Array(32).fill(7);
  const associated = new Uint8Array(16).fill(9);

  const header: EnvelopeHeader = {
    v: 1,
    nestId: '00000000-0000-4000-8000-000000000000',
    senderId: 'A'.repeat(52),
    session: { ephemeralKey: 'k'.repeat(43), signedPreKeyId: 1, oneTimePreKeyId: 2 },
    departedAt: 1_700_000_000_000,
    arrivesAt: 1_700_086_400_000,
    mode: 'normal',
  };

  const scripts: Array<[string, string]> = [
    ['English', 'a'],
    ['Devanagari', 'क'],
    ['Urdu', 'ک'],
    ['Chinese', '好'],
    ['emoji', '🕊'],
  ];

  for (const [name, char] of scripts) {
    it(`accepts 8,000 characters of ${name}`, () => {
      const letter = sealLetter({
        sharedSecret: secret,
        associatedData: associated,
        header,
        manifest: {
          from: { lat: 43.65, lon: -79.38, label: 'Toronto' },
          to: { lat: 17.38, lon: 78.48, label: 'Hyderabad' },
          mode: 'normal',
        },
        // 8,000 UTF-16 code units, which is what MAX_LETTER_CHARS counts.
        body: { text: char.repeat(8000 / char.length), writtenAt: header.departedAt },
      });

      const result = sendLetterSchema.safeParse({
        pigeonId: '00000000-0000-4000-8000-000000000001',
        staminaAfter: 20,
        header,
        manifest: letter.manifest,
        body: letter.body,
      });

      expect(result.success, result.success ? '' : JSON.stringify(result.error.issues[0])).toBe(
        true,
      );
    });
  }

  it('still refuses something far larger than any letter', () => {
    const result = sendLetterSchema.safeParse({
      pigeonId: '00000000-0000-4000-8000-000000000001',
      staminaAfter: 20,
      header,
      manifest: 'm'.repeat(200),
      body: 'b'.repeat(500_000),
    });

    expect(result.success).toBe(false);
  });
});
