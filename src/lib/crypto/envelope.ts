/**
 * The letter format.
 *
 * Each letter is sealed twice, under two keys derived from the same session:
 *
 *   manifest  the route — both cities and the flight mode. Released the moment
 *             the letter is sent, so the recipient can watch the pigeon cross
 *             the Arctic all day without being able to read a word of it.
 *   body      what you actually wrote. The server refuses to hand this over
 *             before the arrival time.
 *
 * The header — including `arrivesAt` — is authenticated data on both seals. A
 * server that tries to bring a letter forward, change who sent it, or move it
 * to a different nest does not get a readable letter out the other side; it
 * gets a decryption failure that the app shows as tampering.
 */

import type { FlightMode } from '../flight/schedule';

import { b64, concat, derive, open, seal, unb64, utf8 } from './primitives';
import type { SessionHeader } from './x3dh';

const INFO_MANIFEST = 'letter/manifest/v1';
const INFO_BODY = 'letter/body/v1';

/** Longest letter we accept, in characters. Long enough for a real letter. */
export const MAX_LETTER_CHARS = 20_000;

export interface Place {
  lat: number;
  lon: number;
  /** What the sender calls it — "Toronto". Never seen by the server. */
  label: string;
}

export interface FlightManifest {
  from: Place;
  to: Place;
  mode: FlightMode;
}

export interface LetterBody {
  text: string;
  /** When the sender actually wrote it, by their own clock. */
  writtenAt: number;
}

export interface EnvelopeHeader {
  v: 1;
  nestId: string;
  senderId: string;
  session: SessionHeader;
  departedAt: number;
  arrivesAt: number;
  mode: FlightMode;
}

export interface SealedLetter {
  header: EnvelopeHeader;
  manifest: string;
  body: string;
}

/**
 * Byte-exact header encoding, used as associated data.
 *
 * Written out field by field rather than via JSON.stringify, because object
 * key order is not something to bet a security property on. The unit separator
 * cannot occur in any of these fields, so the encoding is unambiguous.
 */
function headerBytes(h: EnvelopeHeader): Uint8Array {
  return utf8(
    [
      'kabootar/envelope/v1',
      h.v,
      h.nestId,
      h.senderId,
      h.session.ephemeralKey,
      h.session.signedPreKeyId,
      h.session.oneTimePreKeyId ?? '-',
      h.departedAt,
      h.arrivesAt,
      h.mode,
    ].join(''),
  );
}

function aad(header: EnvelopeHeader, associatedData: Uint8Array): Uint8Array {
  return concat(headerBytes(header), associatedData);
}

export interface SealLetterInput {
  sharedSecret: Uint8Array;
  associatedData: Uint8Array;
  header: EnvelopeHeader;
  manifest: FlightManifest;
  body: LetterBody;
}

export function sealLetter(input: SealLetterInput): SealedLetter {
  const { sharedSecret, header } = input;

  if (input.body.text.length > MAX_LETTER_CHARS) {
    throw new Error(`A letter can be at most ${MAX_LETTER_CHARS} characters.`);
  }

  const associated = aad(header, input.associatedData);

  return {
    header,
    manifest: b64(
      seal(derive(sharedSecret, INFO_MANIFEST), utf8(JSON.stringify(input.manifest)), associated),
    ),
    body: b64(seal(derive(sharedSecret, INFO_BODY), utf8(JSON.stringify(input.body)), associated)),
  };
}

export interface OpenLetterInput {
  sharedSecret: Uint8Array;
  associatedData: Uint8Array;
  header: EnvelopeHeader;
}

export function openManifest(input: OpenLetterInput, manifest: string): FlightManifest {
  const plaintext = open(
    derive(input.sharedSecret, INFO_MANIFEST),
    unb64(manifest),
    aad(input.header, input.associatedData),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as FlightManifest;
}

export function openBody(input: OpenLetterInput, body: string): LetterBody {
  const plaintext = open(
    derive(input.sharedSecret, INFO_BODY),
    unb64(body),
    aad(input.header, input.associatedData),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as LetterBody;
}
