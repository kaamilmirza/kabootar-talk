/**
 * The city list, shared by the picker and the world map.
 *
 * Drawn from the same bundled landmark set the flight simulation uses, so a
 * place you can send from is always a place the pigeon knows how to describe.
 * Naming a city is also the only shape a location can take anywhere in this
 * app: there is no free-form coordinate input, which is what stops the
 * opt-in world map from ever becoming a way to leak a precise position.
 */

import type { Place } from './crypto/envelope';
import { LANDMARKS } from './flight/landmarks';

export const CITIES: Place[] = LANDMARKS.filter((l) => l.kind === 'city')
  .map((l) => ({ lat: l.lat, lon: l.lon, label: l.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function searchCities(query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return CITIES.slice(0, limit);

  return CITIES.filter((c) => c.label.toLowerCase().includes(q)).slice(0, limit);
}
