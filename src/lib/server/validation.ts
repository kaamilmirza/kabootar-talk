import 'server-only';

import { z } from 'zod';

import { MAX_LETTER_CHARS } from '../crypto/envelope';

/**
 * Every field that crosses the network is described here.
 *
 * Length caps are not decoration: they are what stops a caller from using the
 * database as free storage, and they keep ciphertext fields to the size a real
 * letter produces.
 */

const B64 = /^[A-Za-z0-9_-]+$/;

export const b64Key = z.string().length(43).regex(B64);
export const b64Sig = z.string().length(86).regex(B64);
export const b64Hash = z.string().length(43).regex(B64);
export const b64Blob = z.string().min(32).max(16_384).regex(B64);

/** Crockford base32 of a 32-byte hash is always exactly 52 characters. */
export const userId = z.string().length(52).regex(/^[0-9A-HJKMNP-TV-Z]+$/);
export const uuid = z.uuid();

const preKeyId = z.number().int().min(0).max(2_000_000_000);

export const registerSchema = z.object({
  signingKey: b64Key,
  identityKey: b64Key,
  signedPreKey: z.object({
    id: preKeyId,
    publicKey: b64Key,
    signature: b64Sig,
  }),
  oneTimePreKeys: z
    .array(z.object({ id: preKeyId, publicKey: b64Key }))
    .max(200),
});

export const challengeSchema = z.object({ userId });

export const verifySchema = z.object({
  userId,
  nonce: z.string().length(43).regex(B64),
  signature: b64Sig,
});

export const preKeysSchema = z.object({
  oneTimePreKeys: z.array(z.object({ id: preKeyId, publicKey: b64Key })).min(1).max(200),
});

export const signedPreKeySchema = z.object({
  id: preKeyId,
  publicKey: b64Key,
  signature: b64Sig,
});

export const inviteSchema = z.object({ codeHash: b64Hash });

export const sessionHeaderSchema = z.object({
  ephemeralKey: b64Key,
  signedPreKeyId: preKeyId,
  oneTimePreKeyId: preKeyId.nullable(),
});

/**
 * The biggest a sealed letter can legitimately get.
 *
 * Worked out rather than guessed, because guessing got it wrong: the cap used
 * to be `MAX_LETTER_CHARS * 4`, which is fine for English and too small for
 * Urdu or Hindi. A full-length letter in a three-byte script seals to about
 * 32,100 base64 characters and was being rejected outright — in the app named
 * after the Urdu word for pigeon.
 *
 * Four bytes per character is the UTF-8 worst case, plus the JSON wrapper, the
 * nonce and the tag, then four base64 characters for every three bytes.
 */
const MAX_SEALED_BODY = Math.ceil(((MAX_LETTER_CHARS * 4 + 64 + 24 + 16) / 3) * 4);

export const sendLetterSchema = z.object({
  /** Which kabootar is carrying it. */
  pigeonId: uuid,
  /**
   * Her stamina once she is away, worked out on the device.
   *
   * The server cannot compute this: it depends on the distance, and the
   * distance is encrypted. So the client computes it and the server bounds it,
   * the same bargain made for the flight time.
   */
  staminaAfter: z.number().int().min(0).max(100),
  header: z.object({
    v: z.literal(1),
    nestId: uuid,
    senderId: userId,
    session: sessionHeaderSchema,
    departedAt: z.number().int().positive(),
    arrivesAt: z.number().int().positive(),
    mode: z.enum(['normal', 'express']),
  }),
  manifest: b64Blob,
  // Roughly the ciphertext ceiling for MAX_LETTER_CHARS of UTF-8 text.
  body: z.string().min(32).max(MAX_SEALED_BODY).regex(B64),
});

/**
 * A kept letter, on its way to or from the archive.
 *
 * The blob is the whole ArchivedLetter re-sealed on the device: the text, when
 * it was written, and the flight it made. The ceiling is the same worst-case
 * arithmetic the body uses, plus room for the manifest travelling with it.
 */
const MAX_ARCHIVE_BLOB = Math.ceil(((MAX_LETTER_CHARS * 4 + 8192 + 64 + 24 + 16) / 3) * 4);

export const archiveEntrySchema = z.object({
  letterId: uuid,
  blob: z.string().min(32).max(MAX_ARCHIVE_BLOB).regex(B64),
});

export const archivePutSchema = z.object({
  entries: z.array(archiveEntrySchema).min(1).max(50),
});

export type ArchiveEntryInput = z.infer<typeof archiveEntrySchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type SendLetterInput = z.infer<typeof sendLetterSchema>;
