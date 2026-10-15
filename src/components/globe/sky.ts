/**
 * Letters, as the globe wants them.
 *
 * Kept out of the 3D bundle so a page can build its list of flights without
 * loading three.js to do it.
 */

import type { SkyLetter } from '@/lib/client/kabootar';

import type { GlobeFlight } from './store';

export function skyFlights(letters: SkyLetter[]): GlobeFlight[] {
  return letters.map((l) => ({
    id: l.id,
    itinerary: l.itinerary,
    name: l.pigeonName ?? l.itinerary.pigeonName,
    mine: l.mine,
    fromLabel: l.manifest.from.label,
    toLabel: l.manifest.to.label,
  }));
}
