'use client';

/**
 * Where each nest's two ends are.
 *
 * Coordinates are chosen once per nest and then travel inside every letter's
 * encrypted manifest, so the server never sees them. The first letter in a
 * nest carries both ends; after that each side learns the other's location by
 * decrypting a letter, which is the only place it could have come from.
 */

import type { Place } from '../crypto/envelope';
import type { Identity } from '../crypto/identity';
import { b64, derive, open, seal, unb64, utf8 } from '../crypto/primitives';
import { idb, STORES } from './idb';

const AAD = utf8('kabootar/places/v1');

export interface NestPlaces {
  from: Place;
  to: Place;
}

type PlaceBook = Record<string, NestPlaces>;

function bookKey(identity: Identity): Uint8Array {
  return derive(identity.signing.secretKey, 'places/v1');
}

async function load(identity: Identity): Promise<PlaceBook> {
  const blob = await idb<string | undefined>(STORES.places, 'readonly', (s) => s.get(identity.id));
  if (!blob) return {};

  try {
    return JSON.parse(new TextDecoder().decode(open(bookKey(identity), unb64(blob), AAD))) as PlaceBook;
  } catch {
    return {};
  }
}

export async function placesFor(identity: Identity, nestId: string): Promise<NestPlaces | null> {
  return (await load(identity))[nestId] ?? null;
}

export async function rememberPlaces(
  identity: Identity,
  nestId: string,
  places: NestPlaces,
): Promise<void> {
  const book = await load(identity);
  book[nestId] = places;

  const blob = b64(seal(bookKey(identity), utf8(JSON.stringify(book)), AAD));
  await idb(STORES.places, 'readwrite', (s) => s.put(blob, identity.id));
}

export { CITIES, searchCities } from '../cities';
