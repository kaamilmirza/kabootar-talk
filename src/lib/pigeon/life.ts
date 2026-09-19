/**
 * A kabootar's inner life.
 *
 * She is not a quota with a cooldown. She is tired or rested, fed or hungry,
 * cheerful or sulking, and those three things pull on each other: a hungry
 * bird loses heart, a bird left alone for two days loses more, and a bird in
 * poor spirits flies slower than one who has been fed and made a fuss of. Care
 * is not decoration on top of the mechanic — care *is* the mechanic.
 *
 * Everything drifts continuously from a timestamp rather than ticking on a
 * schedule, so nothing has to be running for her to get hungry. Read her at
 * any moment and you get the truth for that moment.
 *
 * Nothing here touches the network or the clock directly: every function takes
 * `atMs`. That is what makes the whole system testable, and it is tested.
 */

import { combinedEffects } from './traits';

export const LIFE = {
  /** Every vital runs 0 to 100. */
  max: 100,

  // --- stamina ------------------------------------------------------------
  /** She will not be released below this. */
  readyAt: 60,
  /** Recovered per hour at rest, before traits, food and bond. */
  recoveryPerHour: 2.5,
  /** A flight this far costs the full amount. */
  exhaustingDistanceKm: 13_000,
  minFlightCost: 12,
  maxFlightCost: 62,

  // --- hunger -------------------------------------------------------------
  /** Full to ravenous in about two days. */
  hungerPerHour: 2.1,
  /** Flying is hungry work, on top of the hourly drift. */
  hungerPerFlight: 25,
  feedSatisfies: 48,
  feedCooldownHours: 5,
  /** Being fed lifts the spirits too, and helps her recover. */
  feedCheer: 8,
  feedRecoveryBoost: 1.3,
  feedBoostHours: 12,

  // --- spirits ------------------------------------------------------------
  /** How fast spirits move towards where they are heading. */
  spiritsPerHour: 3.5,
  /** Below this she digs her heels in and will not go. */
  willNotFlyBelow: 20,
  petCheer: 7,
  /** Attention stops landing after this many in a day — she gets bored of it. */
  petsPerDay: 5,
  /** Hours of being ignored before she starts to mind. */
  patienceHours: 20,
  maxNeglectPenalty: 30,

  // --- bond ---------------------------------------------------------------
  bondPerTrip: 4,
  bondPerPet: 1,
  maxBond: 100,

  // --- urging -------------------------------------------------------------
  /** Each urge takes this share off whatever is left of the flight. */
  urgeSpeedup: 0.16,
  urgeStaminaCost: 13,
  urgeSpiritsCost: 11,
  maxUrgesPerFlight: 3,
} as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type PigeonPlace = 'with-you' | 'with-them' | 'flying';

export type Mood =
  | 'delighted'
  | 'content'
  | 'restless'
  | 'sulking'
  | 'hungry'
  | 'ravenous'
  | 'weary'
  | 'exhausted'
  | 'flying';

export interface MoodProfile {
  label: string;
  /** Said in the app, about her. */
  note: string;
  /** How she is drawn and animated. */
  face: 'happy' | 'flying' | 'sleeping' | 'waiting' | 'worried';
  /** What her state does to her flying. */
  speed: number;
}

export const MOOD_PROFILES: Record<Mood, MoodProfile> = {
  delighted: {
    label: 'Delighted',
    note: 'Strutting about with her chest out. She would fly anywhere for you.',
    face: 'happy',
    speed: 1.1,
  },
  content: {
    label: 'Content',
    note: 'Settled and easy. Watching the window.',
    face: 'happy',
    speed: 1,
  },
  restless: {
    label: 'Restless',
    note: 'Shifting from foot to foot. She would like some attention.',
    face: 'waiting',
    speed: 0.94,
  },
  sulking: {
    label: 'Sulking',
    note: 'Turned her back to you. She has been left alone too long.',
    face: 'worried',
    speed: 0.82,
  },
  hungry: {
    label: 'Hungry',
    note: 'Eyeing your hands for grain.',
    face: 'waiting',
    speed: 0.93,
  },
  ravenous: {
    label: 'Ravenous',
    note: 'Pecking at nothing. She needs feeding before anything else.',
    face: 'worried',
    speed: 0.8,
  },
  weary: {
    label: 'Weary',
    note: 'Sitting low, feathers loose. Still getting her breath back.',
    face: 'sleeping',
    speed: 0.9,
  },
  exhausted: {
    label: 'Exhausted',
    note: 'Flat out and fast asleep. She has earned it.',
    face: 'sleeping',
    speed: 0.75,
  },
  flying: {
    label: 'In flight',
    note: 'Out over the world with a letter.',
    face: 'flying',
    speed: 1,
  },
};

/** What is written in the database, plus where she currently is. */
export interface PigeonState {
  id: string;
  name: string;
  hatchedAt: number;

  /** Vitals as last written, and the moment they were true. */
  stamina: number;
  hunger: number;
  spirits: number;
  vitalsAt: number;

  fedAt: number | null;
  pettedAt: number | null;
  petsToday: number;
  petsDayAt: number | null;

  trips: number;
  bond: number;

  place: PigeonPlace;
  arrivesAt: number | null;
  urges: number;
}

export interface Vitals {
  stamina: number;
  hunger: number;
  spirits: number;
}

export interface PigeonStatus extends Vitals {
  mood: Mood;
  profile: MoodProfile;
  /** Can she be given a letter right now? */
  canFly: boolean;
  /** Why not, if not. */
  blockedBecause: 'tired' | 'unwilling' | 'flying' | 'away' | null;
  /** When she will be fit, if it is only a matter of resting. */
  readyAt: number | null;
  canFeed: boolean;
  canPet: boolean;
  /** Urges left on the flight she is currently making. */
  urgesLeft: number;
}

// --- drift -------------------------------------------------------------------

function recoveryRate(pigeon: PigeonState, atMs: number): number {
  const traits = combinedEffects(pigeon.id);
  const fedRecently = pigeon.fedAt !== null && atMs - pigeon.fedAt < LIFE.feedBoostHours * HOUR_MS;
  const bondBonus = 1 + (pigeon.bond / LIFE.maxBond) * 0.15;

  return (
    LIFE.recoveryPerHour * traits.recovery * bondBonus * (fedRecently ? LIFE.feedRecoveryBoost : 1)
  );
}

/**
 * Where her spirits are heading.
 *
 * Hunger and exhaustion drag it down, and so does being ignored. This is what
 * makes looking after her matter: leave her a couple of days and she will be
 * genuinely miserable, and a miserable bird is a slow one.
 */
export function spiritsTarget(pigeon: PigeonState, atMs: number, vitals: Vitals): number {
  let target = 82;

  if (vitals.hunger > 55) target -= (vitals.hunger - 55) * 0.85;
  if (vitals.stamina < 45) target -= (45 - vitals.stamina) * 0.55;

  const lastSeen = Math.max(pigeon.fedAt ?? 0, pigeon.pettedAt ?? 0, pigeon.hatchedAt);
  const ignoredHours = Math.max(0, (atMs - lastSeen) / HOUR_MS - LIFE.patienceHours);
  target -= Math.min(LIFE.maxNeglectPenalty, ignoredHours * 1.1);

  // A bird that trusts you is harder to put out of sorts.
  target += (pigeon.bond / LIFE.maxBond) * 10;

  return clamp(target, 0, LIFE.max);
}

/** Every vital brought up to date, without writing anything. */
export function vitalsNow(pigeon: PigeonState, atMs: number): Vitals {
  const hours = Math.max(0, (atMs - pigeon.vitalsAt) / HOUR_MS);

  // A bird in the air is working, not resting — but she is still getting hungry.
  const stamina =
    pigeon.place === 'flying'
      ? pigeon.stamina
      : clamp(pigeon.stamina + hours * recoveryRate(pigeon, atMs), 0, LIFE.max);

  const hunger = clamp(pigeon.hunger + hours * LIFE.hungerPerHour, 0, LIFE.max);

  // Spirits chase their target rather than jumping to it, so a single handful
  // of grain does not instantly undo two days of being forgotten.
  const target = spiritsTarget(pigeon, atMs, { stamina, hunger, spirits: pigeon.spirits });
  const drift = hours * LIFE.spiritsPerHour;
  const spirits =
    pigeon.spirits < target
      ? Math.min(target, pigeon.spirits + drift)
      : Math.max(target, pigeon.spirits - drift);

  return { stamina: round(stamina), hunger: round(hunger), spirits: round(spirits) };
}

// --- reading her -------------------------------------------------------------

export function moodOf(place: PigeonPlace, v: Vitals): Mood {
  if (place === 'flying') return 'flying';

  // Most pressing thing first: she can only be one of these at a time.
  if (v.stamina < 25) return 'exhausted';
  if (v.hunger > 78) return 'ravenous';
  if (v.spirits < 28) return 'sulking';
  if (v.hunger > 58) return 'hungry';
  if (v.stamina < 55) return 'weary';
  if (v.spirits < 50) return 'restless';
  if (v.spirits > 85 && v.stamina > 80 && v.hunger < 35) return 'delighted';

  return 'content';
}

export function statusOf(pigeon: PigeonState, atMs: number): PigeonStatus {
  const v = vitalsNow(pigeon, atMs);
  const mood = moodOf(pigeon.place, v);

  const flying = pigeon.place === 'flying';
  const away = pigeon.place === 'with-them';

  const tired = v.stamina < LIFE.readyAt;
  const unwilling = v.spirits < LIFE.willNotFlyBelow;

  const blockedBecause = flying
    ? 'flying'
    : away
      ? 'away'
      : unwilling
        ? 'unwilling'
        : tired
          ? 'tired'
          : null;

  return {
    ...v,
    mood,
    profile: MOOD_PROFILES[mood],
    canFly: blockedBecause === null,
    blockedBecause,
    readyAt: !flying && !away && tired ? whenRested(pigeon, atMs, v.stamina) : null,
    canFeed: !flying && canFeed(pigeon, atMs),
    canPet: !flying && canPet(pigeon, atMs),
    urgesLeft: flying ? Math.max(0, LIFE.maxUrgesPerFlight - pigeon.urges) : 0,
  };
}

function whenRested(pigeon: PigeonState, atMs: number, stamina: number): number {
  const rate = recoveryRate(pigeon, atMs);
  if (rate <= 0) return atMs;
  return atMs + ((LIFE.readyAt - stamina) / rate) * HOUR_MS;
}

export function canFeed(pigeon: PigeonState, atMs: number): boolean {
  if (pigeon.fedAt === null) return true;
  return atMs - pigeon.fedAt >= LIFE.feedCooldownHours * HOUR_MS;
}

/** Attention is welcome, but she gets bored of being fussed over. */
export function petsUsedToday(pigeon: PigeonState, atMs: number): number {
  if (pigeon.petsDayAt === null) return 0;
  if (atMs - pigeon.petsDayAt >= DAY_MS) return 0;
  return pigeon.petsToday;
}

export function canPet(pigeon: PigeonState, atMs: number): boolean {
  return petsUsedToday(pigeon, atMs) < LIFE.petsPerDay;
}

// --- doing things to her -----------------------------------------------------

export interface VitalsWrite extends Vitals {
  vitalsAt: number;
}

export function feed(pigeon: PigeonState, atMs: number): VitalsWrite {
  const v = vitalsNow(pigeon, atMs);
  return {
    vitalsAt: atMs,
    stamina: clamp(v.stamina + 5, 0, LIFE.max),
    hunger: clamp(v.hunger - LIFE.feedSatisfies, 0, LIFE.max),
    spirits: clamp(v.spirits + LIFE.feedCheer, 0, LIFE.max),
  };
}

export function pet(pigeon: PigeonState, atMs: number): VitalsWrite {
  const v = vitalsNow(pigeon, atMs);
  // Diminishing: the fifth scratch of the day is worth less than the first.
  const used = petsUsedToday(pigeon, atMs);
  const worth = LIFE.petCheer * (1 - used / (LIFE.petsPerDay + 1));

  return {
    vitalsAt: atMs,
    stamina: v.stamina,
    hunger: v.hunger,
    spirits: clamp(v.spirits + worth, 0, LIFE.max),
  };
}

/** What a flight costs her, before it starts. */
export function flightCost(distanceKm: number): number {
  const share = Math.min(1, distanceKm / LIFE.exhaustingDistanceKm);
  return Math.round(LIFE.minFlightCost + (LIFE.maxFlightCost - LIFE.minFlightCost) * share);
}

export function release(pigeon: PigeonState, atMs: number, distanceKm: number): VitalsWrite {
  const v = vitalsNow(pigeon, atMs);
  return {
    vitalsAt: atMs,
    stamina: clamp(v.stamina - flightCost(distanceKm), 0, LIFE.max),
    hunger: clamp(v.hunger + LIFE.hungerPerFlight, 0, LIFE.max),
    // Birds like having a job.
    spirits: clamp(v.spirits + 4, 0, LIFE.max),
  };
}

export interface UrgeResult {
  vitals: VitalsWrite;
  /** The new arrival time. */
  arrivesAt: number;
  /** How much sooner she will now get there. */
  savedMs: number;
}

/**
 * Push her to fly harder.
 *
 * This is the one place the app lets you have what you want immediately, and
 * it charges for it honestly: she arrives sooner and she arrives wrecked, and
 * she will not be going anywhere again today. Three times is the most she will
 * take.
 */
export function urge(pigeon: PigeonState, atMs: number): UrgeResult | null {
  if (pigeon.place !== 'flying' || pigeon.arrivesAt === null) return null;
  if (pigeon.urges >= LIFE.maxUrgesPerFlight) return null;

  const remaining = pigeon.arrivesAt - atMs;
  if (remaining <= 0) return null;

  const savedMs = Math.round(remaining * LIFE.urgeSpeedup);
  const v = vitalsNow(pigeon, atMs);

  return {
    arrivesAt: pigeon.arrivesAt - savedMs,
    savedMs,
    vitals: {
      vitalsAt: atMs,
      stamina: clamp(v.stamina - LIFE.urgeStaminaCost, 0, LIFE.max),
      hunger: clamp(v.hunger + 5, 0, LIFE.max),
      spirits: clamp(v.spirits - LIFE.urgeSpiritsCost, 0, LIFE.max),
    },
  };
}

/** Bond after a delivery lands, respecting how attachable this bird is. */
export function afterDelivery(pigeon: PigeonState): number {
  const traits = combinedEffects(pigeon.id);
  return Math.min(LIFE.maxBond, Math.round(pigeon.bond + LIFE.bondPerTrip * traits.bonding));
}

/** How fast she flies, given who she is and how she feels. */
export function effectiveSpeed(pigeonId: string, mood: Mood): number {
  return combinedEffects(pigeonId).speed * MOOD_PROFILES[mood].speed;
}

// --- describing her ----------------------------------------------------------

/** "three days old", "a month old" — birds are described, not dated. */
export function ageOf(hatchedAt: number, atMs: number): string {
  const days = Math.floor((atMs - hatchedAt) / DAY_MS);
  if (days < 1) return 'hatched today';
  if (days === 1) return 'one day old';
  if (days < 30) return `${days} days old`;

  const months = Math.floor(days / 30);
  return months === 1 ? 'a month old' : `${months} months old`;
}

export function bondLabel(bond: number): string {
  if (bond >= 80) return 'Knows the way in her sleep';
  if (bond >= 55) return 'Knows this route well';
  if (bond >= 30) return 'Learning the route';
  if (bond >= 10) return 'Has made the trip before';
  return 'New to this route';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
