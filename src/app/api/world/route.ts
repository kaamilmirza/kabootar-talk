import { z } from 'zod';

import * as db from '@/lib/db/queries';
import { CITIES } from '@/lib/cities';
import { LIMITS } from '@/lib/server/config';
import { assertSameOrigin, badRequest, json, parseBody, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';

/**
 * The world map.
 *
 * Aggregate counts per city, and only for cities that several people have
 * chosen. Nobody is ever the only dot: below the threshold a city simply does
 * not appear. There is no row anywhere linking a person, a letter, or a time
 * to a place — joining the map says "somebody, at some point, sends from here"
 * and nothing more.
 */
export const GET = route(async () => {
  const userId = await requireUserId();

  const [beacons, joined] = await Promise.all([
    db.listBeacons(LIMITS.worldMapMinimum),
    db.hasJoinedWorldMap(userId),
  ]);

  const known = new Map(CITIES.map((c) => [c.label, c]));

  return json({
    minimum: LIMITS.worldMapMinimum,
    joined,
    cities: beacons
      .map((b) => {
        const city = known.get(b.city);
        return city ? { label: city.label, lat: city.lat, lon: city.lon, senders: b.senders } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
  });
});

const joinSchema = z.object({ city: z.string().min(1).max(64) });

/** Opt in, by naming one of the bundled cities. Never a coordinate. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const userId = await requireUserId();

  const { city } = await parseBody(request, joinSchema);

  // Only cities from the bundled list, so this can never become a channel for
  // smuggling a precise location onto the server.
  if (!CITIES.some((c) => c.label === city)) throw badRequest('Not a city we know.');

  // Once per account, ever. Otherwise one person could add themselves three
  // times and put their own city over the threshold, which would make the
  // "several distinct people" guarantee a lie.
  const counted = await db.recordBeacon(userId, city);
  if (!counted) throw badRequest('You are already on the map.');

  return json({ ok: true });
});
