/**
 * What makes one kabootar different from another.
 *
 * Every bird is hatched with two traits, drawn deterministically from its id,
 * and they are not decoration: each one changes how the bird actually flies.
 * A curious bird really does stop more often and take longer; a swift one
 * really does arrive sooner. Over weeks you learn your birds — that this one
 * dawdles and that one pushes through weather — which is the whole point of
 * them being individuals rather than a counter.
 */

export interface TraitEffects {
  /** Multiplier on ground speed. */
  speed?: number;
  /** Added to (or taken off) the number of rest stops. */
  restStops?: number;
  /** Multiplier on how long each rest lasts. */
  restLength?: number;
  /** How well it handles storms and headwinds. 1 is ordinary. */
  weather?: number;
  /** Multiplier on stamina recovery per hour. */
  recovery?: number;
  /** Multiplier on how quickly it grows attached to a route. */
  bonding?: number;
}

export interface Trait {
  id: string;
  name: string;
  /** Shown on the bird's card, in its own voice. */
  note: string;
  effects: TraitEffects;
}

export const TRAITS: Trait[] = [
  {
    id: 'swift',
    name: 'Swift',
    note: 'Wastes no time. Arrives before you expect her.',
    effects: { speed: 1.14 },
  },
  {
    id: 'curious',
    name: 'Curious',
    note: 'Stops to look at things. Everything, mostly.',
    effects: { restStops: 1, restLength: 1.15, speed: 0.96 },
  },
  {
    id: 'stormheart',
    name: 'Stormheart',
    note: 'Flies into weather that turns other birds back.',
    effects: { weather: 1.5 },
  },
  {
    id: 'night-eyed',
    name: 'Night-eyed',
    note: 'Sees in the dark. Does not slow when the sun goes.',
    effects: { weather: 1.15, speed: 1.04 },
  },
  {
    id: 'steady',
    name: 'Steady',
    note: 'Never hurries, never falters. Recovers quickly.',
    effects: { recovery: 1.3, speed: 0.98 },
  },
  {
    id: 'homesick',
    name: 'Homesick',
    note: 'Knows the way back and takes it fast.',
    effects: { speed: 1.08, restStops: -1 },
  },
  {
    id: 'gentle',
    name: 'Gentle',
    note: 'Sits on your hand. Grows attached quickly.',
    effects: { bonding: 1.6, recovery: 1.1 },
  },
  {
    id: 'stubborn',
    name: 'Stubborn',
    note: 'Rests exactly as long as she means to, and no less.',
    effects: { restLength: 1.35, weather: 1.2, recovery: 0.9 },
  },
  {
    id: 'greedy',
    name: 'Greedy',
    note: 'Always hungry. Worth the grain, usually.',
    effects: { recovery: 0.85, speed: 1.06 },
  },
  {
    id: 'featherlight',
    name: 'Featherlight',
    note: 'Tires slowly. Barely seems to work at it.',
    effects: { recovery: 1.25 },
  },
];

const BY_ID = new Map(TRAITS.map((t) => [t.id, t]));

/**
 * The two traits a bird hatched with.
 *
 * Derived from the bird's id rather than stored, so they can never drift out
 * of step with it, and so a bird restored on a new device is recognisably the
 * same bird.
 */
export function traitsFor(pigeonId: string): Trait[] {
  const seed = hash(pigeonId);

  const first = seed % TRAITS.length;
  // Offset by a coprime stride so the pair is never the same trait twice.
  let second = (first + 1 + ((seed >>> 8) % (TRAITS.length - 1))) % TRAITS.length;
  if (second === first) second = (first + 1) % TRAITS.length;

  return [TRAITS[first], TRAITS[second]];
}

export function traitById(id: string): Trait | undefined {
  return BY_ID.get(id);
}

/** Everything the two traits do, folded together. */
export function combinedEffects(pigeonId: string): Required<TraitEffects> {
  const base: Required<TraitEffects> = {
    speed: 1,
    restStops: 0,
    restLength: 1,
    weather: 1,
    recovery: 1,
    bonding: 1,
  };

  for (const trait of traitsFor(pigeonId)) {
    const e = trait.effects;
    base.speed *= e.speed ?? 1;
    base.restStops += e.restStops ?? 0;
    base.restLength *= e.restLength ?? 1;
    base.weather *= e.weather ?? 1;
    base.recovery *= e.recovery ?? 1;
    base.bonding *= e.bonding ?? 1;
  }

  return base;
}

/** FNV-1a, so the same id gives the same bird in every runtime. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export { hash as seedFromId };
