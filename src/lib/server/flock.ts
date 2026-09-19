import 'server-only';

import * as db from '../db/queries';
import { hatchNames } from '../pigeon/names';
import { afterDelivery, statusOf, type PigeonState } from '../pigeon/life';
import { traitsFor } from '../pigeon/traits';

/** A bird as the client sees her: the stored facts plus how she is right now. */
export interface PigeonView {
  id: string;
  name: string;
  hatchedAt: number;
  place: PigeonState['place'];
  arrivesAt: number | null;
  canUrge: boolean;
  trips: number;
  bond: number;
  urges: number;
  traits: Array<{ id: string; name: string; note: string }>;
  stamina: number;
  hunger: number;
  spirits: number;
  mood: string;
  canFly: boolean;
  blockedBecause: string | null;
  readyAt: number | null;
  canFeed: boolean;
  canPet: boolean;
  urgesLeft: number;
}

export function viewOf(state: PigeonState, atMs: number, sentByViewer = false): PigeonView {
  const status = statusOf(state, atMs);

  return {
    id: state.id,
    name: state.name,
    hatchedAt: state.hatchedAt,
    place: state.place,
    arrivesAt: state.arrivesAt,
    // Only the person who sent her may push her on, so only they should be
    // offered the button.
    canUrge: state.place === 'flying' && sentByViewer && status.urgesLeft > 0,
    trips: state.trips,
    bond: state.bond,
    urges: state.urges,
    traits: traitsFor(state.id).map((t) => ({ id: t.id, name: t.name, note: t.note })),
    stamina: status.stamina,
    hunger: status.hunger,
    spirits: status.spirits,
    mood: status.mood,
    canFly: status.canFly,
    blockedBecause: status.blockedBecause,
    readyAt: status.readyAt,
    canFeed: status.canFeed,
    canPet: status.canPet,
    urgesLeft: status.urgesLeft,
  };
}

/**
 * Every bird in a nest, brought up to date.
 *
 * Landing arrived birds happens here rather than in a scheduled job, because
 * this app has no worker and does not need one: a bird that has arrived is
 * simply one whose arrival time is behind us. Doing it on read means the
 * moment anybody looks, the world is correct.
 */
export async function flockFor(nestId: string, viewerId: string, atMs: number) {
  const landed = await db.landArrivals(nestId);

  let rows = await db.listPigeons(nestId);

  /*
   * Hatch on demand if the nest somehow has no birds.
   *
   * They are normally hatched the moment a pair confirm each other, but that
   * is a separate statement from the confirmation itself: if it failed, or if
   * the nest predates birds existing at all, the pair would be left staring at
   * a nest they can never use and no way to fix it. Doing it here as well
   * makes that state self-healing.
   */
  if (rows.length === 0) {
    const nest = await db.findNest(nestId, viewerId);
    if (nest && nest.status === 'active') {
      await db.hatchPigeons(nestId, nest.low_user_id, nest.high_user_id, hatchNames());
      rows = await db.listPigeons(nestId);
    }
  }

  const states = rows.map((row) => db.toPigeonState(row, viewerId));

  /*
   * A delivery deepens the bond — for the bird that made it, and nobody else.
   *
   * `landArrivals` reports exactly which birds came in, and how much each one
   * gains depends on her own nature, so a Gentle bird attaches faster than a
   * Stubborn one.
   */
  if (landed.length > 0) {
    const arrived = new Set(landed);
    const bonds = states
      .filter((state) => arrived.has(state.id))
      .map((state) => [state.id, afterDelivery(state)] as [string, number]);

    if (bonds.length > 0) {
      await db.setBonds(nestId, bonds);

      // Reflect it in what we hand back, rather than showing yesterday's bond
      // until the next request happens to come along.
      const updated = new Map(bonds);
      for (const state of states) {
        const bond = updated.get(state.id);
        if (bond !== undefined) state.bond = bond;
      }
    }
  }

  return states.map((state) =>
    viewOf(state, atMs, state.place === 'flying' && rowFor(rows, state.id)?.flying_to !== viewerId),
  );
}

function rowFor(rows: db.PigeonRow[], id: string) {
  return rows.find((row) => row.id === id);
}
