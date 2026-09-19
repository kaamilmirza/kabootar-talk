/**
 * What the kabootar is doing right now, and how to say it.
 *
 * Moods are chosen deterministically from the message seed, so both the sender
 * and the recipient watching from opposite sides of the planet see the same
 * bird doing the same thing at the same moment — with no server round-trip.
 */

import type { LandmarkKind } from './landmarks';

export type LegKind = 'flying' | 'resting';

export type FlightMood =
  // in the air
  | 'launch'
  | 'soaring'
  | 'tailwind'
  | 'headwind'
  | 'crosswind'
  | 'night'
  | 'storm'
  | 'high-altitude'
  | 'ocean-crossing'
  | 'final-approach'
  // on the ground
  | 'perched'
  | 'roosting'
  | 'ledge'
  | 'ship'
  | 'huddling'
  | 'hydrating'
  | 'foraging'
  | 'sheltering'
  | 'sleeping'
  | 'preening'
  | 'befriending';

export interface MoodProfile {
  kind: LegKind;
  /** Multiplier on ground covered per hour. Tailwinds are fast, storms are not. */
  speed: number;
  label: string;
  /** `{place}` is replaced with the nearest landmark phrase. */
  phrase: string;
  /** Drives wing-flap rate, bob amplitude and trail intensity in the 3D scene. */
  animation: {
    flapHz: number;
    bobAmplitude: number;
    /** Degrees of roll, for banking into crosswinds. */
    roll: number;
    trail: number;
  };
  emoji: string;
}

export const MOODS: Record<FlightMood, MoodProfile> = {
  launch: {
    kind: 'flying',
    speed: 0.85,
    label: 'Just launched',
    phrase: 'Climbing out {place}, finding the line home',
    animation: { flapHz: 9, bobAmplitude: 0.05, roll: 6, trail: 0.9 },
    emoji: '🕊️',
  },
  soaring: {
    kind: 'flying',
    speed: 1,
    label: 'Soaring',
    phrase: 'Soaring {place}',
    animation: { flapHz: 4.5, bobAmplitude: 0.022, roll: 2, trail: 0.6 },
    emoji: '🕊️',
  },
  tailwind: {
    kind: 'flying',
    speed: 1.45,
    label: 'Riding a tailwind',
    phrase: 'Riding a tailwind {place}, making good time',
    animation: { flapHz: 3, bobAmplitude: 0.014, roll: 0, trail: 1 },
    emoji: '💨',
  },
  headwind: {
    kind: 'flying',
    speed: 0.62,
    label: 'Into a headwind',
    phrase: 'Pushing into a headwind {place}',
    animation: { flapHz: 8, bobAmplitude: 0.045, roll: 4, trail: 0.35 },
    emoji: '🌬️',
  },
  crosswind: {
    kind: 'flying',
    speed: 0.82,
    label: 'Fighting a crosswind',
    phrase: 'Crabbing sideways through a crosswind {place}',
    animation: { flapHz: 6.5, bobAmplitude: 0.038, roll: 16, trail: 0.5 },
    emoji: '🌬️',
  },
  night: {
    kind: 'flying',
    speed: 0.78,
    label: 'Flying by starlight',
    phrase: 'Flying through the night {place}, navigating by stars',
    animation: { flapHz: 3.6, bobAmplitude: 0.018, roll: 1, trail: 0.4 },
    emoji: '🌙',
  },
  storm: {
    kind: 'flying',
    speed: 0.45,
    label: 'Threading a storm',
    phrase: 'Threading between thunderheads {place}',
    animation: { flapHz: 10, bobAmplitude: 0.075, roll: 22, trail: 0.25 },
    emoji: '⛈️',
  },
  'high-altitude': {
    kind: 'flying',
    speed: 0.9,
    label: 'High and cold',
    phrase: 'Climbing over the ice fields {place}, thin cold air',
    animation: { flapHz: 5.5, bobAmplitude: 0.03, roll: 3, trail: 0.75 },
    emoji: '❄️',
  },
  'ocean-crossing': {
    kind: 'flying',
    speed: 1.05,
    label: 'No land in sight',
    phrase: 'Out {place} with nowhere to land',
    animation: { flapHz: 4.2, bobAmplitude: 0.02, roll: 1, trail: 0.7 },
    emoji: '🌊',
  },
  'final-approach': {
    kind: 'flying',
    speed: 1.2,
    label: 'On final approach',
    phrase: 'Dropping low {place} — almost there',
    animation: { flapHz: 6, bobAmplitude: 0.028, roll: 8, trail: 1 },
    emoji: '🏁',
  },
  perched: {
    kind: 'resting',
    speed: 0,
    label: 'Resting',
    phrase: 'Perched on a rooftop {place}, catching its breath',
    animation: { flapHz: 0, bobAmplitude: 0.006, roll: 0, trail: 0 },
    emoji: '🪶',
  },
  roosting: {
    kind: 'resting',
    speed: 0,
    label: 'Roosting',
    phrase: 'Roosting in the branches {place}',
    animation: { flapHz: 0, bobAmplitude: 0.005, roll: 0, trail: 0 },
    emoji: '🌲',
  },
  ledge: {
    kind: 'resting',
    speed: 0,
    label: 'On a ledge',
    phrase: 'Tucked onto a rock ledge {place}',
    animation: { flapHz: 0, bobAmplitude: 0.005, roll: 0, trail: 0 },
    emoji: '⛰️',
  },
  ship: {
    kind: 'resting',
    speed: 0,
    label: 'Hitching a ride',
    phrase: 'Riding the rail of a trawler {place}, no land for hours',
    animation: { flapHz: 0, bobAmplitude: 0.02, roll: 3, trail: 0 },
    emoji: '🚢',
  },
  huddling: {
    kind: 'resting',
    speed: 0,
    label: 'Out of the wind',
    phrase: 'Huddled out of the wind {place}, feathers fluffed against the cold',
    animation: { flapHz: 0, bobAmplitude: 0.004, roll: 0, trail: 0 },
    emoji: '🥶',
  },
  hydrating: {
    kind: 'resting',
    speed: 0,
    label: 'Drinking',
    phrase: 'Stopped for water {place}',
    animation: { flapHz: 0, bobAmplitude: 0.012, roll: 0, trail: 0 },
    emoji: '💧',
  },
  foraging: {
    kind: 'resting',
    speed: 0,
    label: 'Foraging',
    phrase: 'Picking at seeds {place}',
    animation: { flapHz: 0, bobAmplitude: 0.014, roll: 0, trail: 0 },
    emoji: '🌾',
  },
  sheltering: {
    kind: 'resting',
    speed: 0,
    label: 'Waiting out weather',
    phrase: 'Hunkered down out of the weather {place}',
    animation: { flapHz: 0, bobAmplitude: 0.004, roll: 0, trail: 0 },
    emoji: '🌧️',
  },
  sleeping: {
    kind: 'resting',
    speed: 0,
    label: 'Asleep',
    phrase: 'Asleep {place}, head tucked into a wing',
    animation: { flapHz: 0, bobAmplitude: 0.003, roll: 0, trail: 0 },
    emoji: '😴',
  },
  preening: {
    kind: 'resting',
    speed: 0,
    label: 'Preening',
    phrase: 'Preening its flight feathers {place}',
    animation: { flapHz: 0, bobAmplitude: 0.01, roll: 0, trail: 0 },
    emoji: '🪶',
  },
  befriending: {
    kind: 'resting',
    speed: 0,
    label: 'Making friends',
    phrase: 'Being interrogated by the local pigeons {place}',
    animation: { flapHz: 0.6, bobAmplitude: 0.016, roll: 0, trail: 0 },
    emoji: '🐦',
  },
};

export const FLYING_MOODS = (Object.keys(MOODS) as FlightMood[]).filter(
  (m) => MOODS[m].kind === 'flying',
);

export const RESTING_MOODS = (Object.keys(MOODS) as FlightMood[]).filter(
  (m) => MOODS[m].kind === 'resting',
);

/**
 * Rest moods that make sense for where the bird actually came down. A pigeon
 * does not perch on a rooftop in the middle of the Greenland Sea — out there
 * it catches a ship, which is what real exhausted racing pigeons do.
 */
export function restMoodsFor(kind: LandmarkKind): FlightMood[] {
  switch (kind) {
    case 'city':
      return ['perched', 'befriending', 'foraging', 'preening', 'hydrating'];
    case 'sea':
      return ['ship'];
    case 'ice':
      return ['huddling', 'ship'];
    case 'desert':
      return ['hydrating', 'sheltering', 'ledge'];
    case 'range':
      return ['ledge', 'preening', 'sheltering'];
    case 'forest':
      return ['roosting', 'foraging', 'preening', 'sleeping'];
    case 'island':
      return ['perched', 'preening', 'foraging', 'ship'];
    default:
      return ['foraging', 'hydrating', 'preening', 'sleeping'];
  }
}

/**
 * Names for the bird carrying each letter. Deterministic per message, so a
 * letter always arrives carried by the same pigeon you watched leave.
 */
export const PIGEON_NAMES = [
  'Noor', 'Heer', 'Chand', 'Baadal', 'Mithu', 'Kesar', 'Moti', 'Zara',
  'Firoza', 'Sultan', 'Bulbul', 'Raja', 'Rani', 'Munna', 'Sona', 'Laila',
  'Pari', 'Sitara', 'Shabnam', 'Barkat', 'Gulab', 'Meher', 'Anmol', 'Roshan',
  'Saba', 'Nargis', 'Jugnu', 'Kajal', 'Shehzad', 'Yasmin', 'Iqbal', 'Almas',
  'Zohra', 'Parwaz', 'Sahar', 'Mahtab', 'Neelam', 'Rehan', 'Tara', 'Qasim',
] as const;
