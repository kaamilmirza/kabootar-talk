/**
 * Turns two points and a departure time into a full pigeon itinerary.
 *
 * The whole simulation is a pure function of (from, to, departedAt, arrivesAt,
 * seed). Nothing is stored, nothing is polled, and both ends of the
 * conversation independently compute an identical bird. The server only ever
 * knows `arrivesAt` — never where the pigeon is, or where either nest is.
 */

import { combinedEffects, type TraitEffects } from '../pigeon/traits';
import { bearingDeg, distanceKm, interpolate, type LatLon } from './geo';
import {
  isLandable,
  nearestLandmark,
  placePhrase,
  type Landmark,
} from './landmarks';
import {
  MOODS,
  PIGEON_NAMES,
  restMoodsFor,
  type FlightMood,
  type LegKind,
} from './states';

export type FlightMode = 'normal' | 'express';

/**
 * Tuning for how long a letter takes. Exported so a fork can make their own
 * pigeons faster or slower without touching the simulation itself.
 *
 * The defaults put Toronto -> Hyderabad (12,863 km) at almost exactly 24h:
 *   3h + 12863/600 = 24.4h
 */
export const FLIGHT_CONFIG = {
  /** Fixed overhead: finding the wind, climbing out, the last descent. */
  baseHours: 3,
  /** Effective ground speed once the bird is up, in km/h. */
  kmPerHour: 600,
  minHours: 4,
  maxHours: 96,
  /** An express kabootar is this many times faster. */
  expressSpeedup: 6,
  expressMinHours: 0.5,
  expressMaxHours: 10,
  /** Share of the journey spent on the ground. */
  restShare: 0.28,
  expressRestShare: 0.06,
  /** Roughly one rest stop per this many km. */
  kmPerStop: 2200,
  maxStops: 6,
  /** Longest stretch of route covered without the weather getting a re-roll. */
  maxSegmentFraction: 0.1,
} as const;

export type FlightConfig = typeof FLIGHT_CONFIG;

const HOUR_MS = 3_600_000;

// --- deterministic randomness ----------------------------------------------

/** mulberry32 — small, fast, and identical across every JS engine. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the seed string, so any message id works as a seed. */
export function seedToInt(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

// --- duration ---------------------------------------------------------------

/**
 * How long a letter over this distance should take, in milliseconds.
 *
 * `speed` is the carrying bird's own: a swift kabootar really does get there
 * sooner, and a curious one really does take longer. It is the same number the
 * itinerary uses, so the estimate a sender sees and the flight the recipient
 * watches agree.
 */
export function plannedDurationMs(
  km: number,
  mode: FlightMode = 'normal',
  cfg: FlightConfig = FLIGHT_CONFIG,
  speed = 1,
): number {
  const raw = (cfg.baseHours + km / cfg.kmPerHour) / Math.max(0.5, speed);
  const hours =
    mode === 'express'
      ? clamp(raw / cfg.expressSpeedup, cfg.expressMinHours, cfg.expressMaxHours)
      : clamp(raw, cfg.minHours, cfg.maxHours);
  return Math.round(hours * HOUR_MS);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// --- the itinerary ----------------------------------------------------------

export interface Leg {
  kind: LegKind;
  mood: FlightMood;
  /** Absolute epoch milliseconds. */
  startMs: number;
  endMs: number;
  /** Fraction of the great circle covered at each end of the leg. */
  startFrac: number;
  endFrac: number;
  /** The place this leg is named after — a rest stop, or a flyover. */
  landmark: Landmark;
}

export interface Itinerary {
  from: LatLon;
  to: LatLon;
  distanceKm: number;
  departedAt: number;
  arrivesAt: number;
  durationMs: number;
  mode: FlightMode;
  seed: string;
  pigeonName: string;
  legs: Leg[];
}

export interface BuildItineraryInput {
  from: LatLon;
  to: LatLon;
  departedAt: number;
  /** Authoritative arrival stamped by the server. The schedule fills this window. */
  arrivesAt: number;
  seed: string;
  mode?: FlightMode;
  /**
   * The bird carrying it. Her traits shape the journey — how often she comes
   * down, how long she sits, and how much the weather bothers her.
   */
  pigeonId?: string;
}

export function buildItinerary(
  input: BuildItineraryInput,
  cfg: FlightConfig = FLIGHT_CONFIG,
): Itinerary {
  const { from, to, departedAt, arrivesAt, seed, mode = 'normal', pigeonId } = input;
  const durationMs = Math.max(1, arrivesAt - departedAt);
  const km = distanceKm(from, to);

  // Seeded by the letter and the bird together, so the same bird on the same
  // route behaves consistently, and two birds sent the same day do not.
  const rng = makeRng(seedToInt(pigeonId ? `${seed}:${pigeonId}` : seed));
  const traits: Required<TraitEffects> = pigeonId
    ? combinedEffects(pigeonId)
    : { speed: 1, restStops: 0, restLength: 1, weather: 1, recovery: 1, bonding: 1 };

  const stops =
    mode === 'express'
      ? km > 4000
        ? 1
        : 0
      : clamp(
          Math.round(km / cfg.kmPerStop) + traits.restStops,
          1,
          cfg.maxStops,
        );

  const baseRestShare = mode === 'express' ? cfg.expressRestShare : cfg.restShare;
  const restShare = stops === 0 ? 0 : clamp(baseRestShare * traits.restLength, 0.02, 0.5);
  const restMs = durationMs * restShare;
  const flyMs = durationMs - restMs;

  const boundaries = planStopFractions(from, to, stops, rng);
  const segments = planSegments(boundaries, cfg.maxSegmentFraction);
  const flySegments = segments.filter((s) => s.kind === 'flying');

  // Two passes: moods depend on when the bird is somewhere (for night flying),
  // but timing depends on mood (for wind speed). Estimate, then settle.
  const provisional = provisionalTimes(flySegments, departedAt, flyMs);
  const moods = flySegments.map((seg, i) =>
    chooseFlyMood({
      span: [seg.a, seg.b],
      from,
      to,
      index: i,
      total: flySegments.length,
      atMs: provisional[i],
      rng,
      weather: traits.weather,
    }),
  );

  const flyDurations = distributeFlyTime(flySegments, moods, flyMs);
  const restDurations = distributeRestTime(stops, restMs, rng);

  const legs: Leg[] = [];
  let cursor = departedAt;
  let flyIndex = 0;

  for (const seg of segments) {
    if (seg.kind === 'flying') {
      const end = cursor + flyDurations[flyIndex];
      legs.push({
        kind: 'flying',
        mood: moods[flyIndex],
        startMs: cursor,
        endMs: end,
        startFrac: seg.a,
        endFrac: seg.b,
        landmark: nearestLandmark(interpolate(from, to, (seg.a + seg.b) / 2)).landmark,
      });
      cursor = end;
      flyIndex++;
    } else {
      const where = nearestLandmark(interpolate(from, to, seg.at)).landmark;
      const end = cursor + restDurations[seg.stopIndex];
      legs.push({
        kind: 'resting',
        mood: pick(rng, restMoodsFor(where.kind)),
        startMs: cursor,
        endMs: end,
        startFrac: seg.at,
        endFrac: seg.at,
        landmark: where,
      });
      cursor = end;
    }
  }

  // Absorb rounding drift into the final leg so the bird lands exactly on time.
  if (legs.length > 0) legs[legs.length - 1].endMs = arrivesAt;

  return {
    from,
    to,
    distanceKm: km,
    departedAt,
    arrivesAt,
    durationMs,
    mode,
    seed,
    pigeonName: pick(rng, PIGEON_NAMES),
    legs,
  };
}

/**
 * Where along the route the bird comes down, nudged towards somewhere it can
 * actually land. A pigeon does not rest in the middle of the Barents Sea.
 */
function planStopFractions(
  from: LatLon,
  to: LatLon,
  stops: number,
  rng: () => number,
): number[] {
  if (stops === 0) return [];

  const raw: number[] = [];
  let acc = 0;
  const weights = Array.from({ length: stops + 1 }, () => 0.7 + rng() * 0.6);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < stops; i++) {
    acc += weights[i];
    raw.push(acc / total);
  }

  const SEARCH = 0.08;
  const STEP = 0.004;
  // Keep stops far enough apart that the bird never rests twice in one place.
  const minGap = Math.max(0.06, (1 / (stops + 1)) * 0.55);

  const placed: number[] = [];
  let previous: Landmark | null = null;
  let floor = 0.05;

  for (const f of raw) {
    let best = clamp(f, floor, 0.95);
    let bestScore = Infinity;

    for (let d = -SEARCH; d <= SEARCH + 1e-9; d += STEP) {
      const candidate = clamp(f + d, floor, 0.95);
      if (candidate < floor) continue;

      const { landmark, distanceKm: dist } = nearestLandmark(interpolate(from, to, candidate));

      // Prefer land, prefer being close to it, prefer somewhere new, and
      // prefer not dragging the stop far from where it was planned.
      let score = dist + Math.abs(d) * 1500;
      if (!isLandable(landmark)) score += 4000;
      if (previous && landmark.name === previous.name) score += 6000;

      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    placed.push(best);
    previous = nearestLandmark(interpolate(from, to, best)).landmark;
    floor = best + minGap;
    if (floor > 0.95) break;
  }

  return placed;
}

type Segment =
  | { kind: 'flying'; a: number; b: number }
  | { kind: 'resting'; at: number; stopIndex: number };

/**
 * Chop the route into flying segments and rest stops.
 *
 * Long flying stretches are subdivided so the weather can change mid-ocean —
 * otherwise a six-hour leg would report the same thunderstorm all evening.
 */
function planSegments(boundaries: number[], maxSpan: number): Segment[] {
  const segments: Segment[] = [];
  const edges = [0, ...boundaries, 1];

  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    const parts = Math.max(1, Math.ceil((b - a) / maxSpan));

    for (let k = 0; k < parts; k++) {
      segments.push({
        kind: 'flying',
        a: a + ((b - a) * k) / parts,
        b: a + ((b - a) * (k + 1)) / parts,
      });
    }

    if (i < boundaries.length) {
      segments.push({ kind: 'resting', at: boundaries[i], stopIndex: i });
    }
  }

  return segments;
}

function provisionalTimes(
  segments: Array<{ a: number; b: number }>,
  departedAt: number,
  flyMs: number,
): number[] {
  const out: number[] = [];
  let t = departedAt;
  for (const { a, b } of segments) {
    const d = (b - a) * flyMs;
    out.push(t + d / 2);
    t += d;
  }
  return out;
}

/**
 * Time per flying leg. A leg's duration is its share of the route divided by
 * how fast that leg's weather lets the bird move, normalised to fill the
 * window exactly.
 */
function distributeFlyTime(
  segments: Array<{ a: number; b: number }>,
  moods: FlightMood[],
  flyMs: number,
): number[] {
  const costs = segments.map(({ a, b }, i) => (b - a) / MOODS[moods[i]].speed);
  const total = costs.reduce((x, y) => x + y, 0) || 1;
  return costs.map((c) => (c / total) * flyMs);
}

function distributeRestTime(stops: number, restMs: number, rng: () => number): number[] {
  if (stops === 0) return [];
  const weights = Array.from({ length: stops }, () => 0.6 + rng() * 0.8);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * restMs);
}

/** Local solar hour (0..24) at a longitude — good enough to know if it is dark. */
export function localSolarHour(lon: number, atMs: number): number {
  const utcHours = (atMs / HOUR_MS) % 24;
  return (((utcHours + lon / 15) % 24) + 24) % 24;
}

function isNight(hour: number): boolean {
  return hour >= 19.5 || hour < 5.5;
}

function chooseFlyMood(args: {
  span: [number, number];
  from: LatLon;
  to: LatLon;
  index: number;
  total: number;
  atMs: number;
  rng: () => number;
  weather: number;
}): FlightMood {
  const { span, from, to, index, total, atMs, rng, weather } = args;
  const mid = interpolate(from, to, (span[0] + span[1]) / 2);
  const { landmark } = nearestLandmark(mid);

  if (index === 0) return 'launch';
  if (index === total - 1) return 'final-approach';

  // Weather beats geography beats time of day. A hardy bird meets less of it:
  // storms and headwinds find her less often, and tailwinds just as often.
  const hardiness = Math.max(0.3, weather);
  const roll = rng();
  if (roll < 0.1 / hardiness) return 'storm';
  if (roll < 0.28) return 'tailwind';
  if (roll < 0.28 + 0.12 / hardiness) return 'headwind';
  if (roll < 0.4 + 0.1 / hardiness) return 'crosswind';

  if (landmark.kind === 'ice' || Math.abs(mid.lat) > 70) return 'high-altitude';
  if (landmark.kind === 'sea') return 'ocean-crossing';
  if (isNight(localSolarHour(mid.lon, atMs))) return 'night';

  return 'soaring';
}

// --- reading the itinerary --------------------------------------------------

export type FlightPhase = 'waiting' | 'flying' | 'arrived';

/**
 * Where the bird is, and nothing else.
 *
 * Deliberately cheap, because the 3D scene calls it on every animation frame.
 * It walks a handful of legs and does one spherical interpolation — no
 * allocation beyond the returned object, no scanning the landmark table, and
 * no building strings. Calling the full `statusAt` at 60fps froze the tab.
 */
export interface FlightPosition {
  phase: FlightPhase;
  /** 0..1 along the great circle. */
  progress: number;
  position: LatLon;
  kmFlown: number;
  kmRemaining: number;
  msRemaining: number;
  mood: FlightMood;
  leg: Leg | null;
}

export function positionAt(itin: Itinerary, nowMs: number): FlightPosition {
  if (nowMs >= itin.arrivesAt) {
    return {
      phase: 'arrived',
      progress: 1,
      position: itin.to,
      kmFlown: itin.distanceKm,
      kmRemaining: 0,
      msRemaining: 0,
      mood: 'final-approach',
      leg: itin.legs[itin.legs.length - 1] ?? null,
    };
  }

  if (nowMs < itin.departedAt) {
    return {
      phase: 'waiting',
      progress: 0,
      position: itin.from,
      kmFlown: 0,
      kmRemaining: itin.distanceKm,
      msRemaining: itin.arrivesAt - nowMs,
      mood: 'launch',
      leg: null,
    };
  }

  const leg = findLeg(itin, nowMs);
  const span = Math.max(1, leg.endMs - leg.startMs);
  const t = clamp((nowMs - leg.startMs) / span, 0, 1);
  const progress = leg.startFrac + (leg.endFrac - leg.startFrac) * t;

  return {
    phase: 'flying',
    progress,
    position: interpolate(itin.from, itin.to, progress),
    kmFlown: itin.distanceKm * progress,
    kmRemaining: itin.distanceKm * (1 - progress),
    msRemaining: itin.arrivesAt - nowMs,
    mood: leg.mood,
    leg,
  };
}

/** Binary search, so a long itinerary costs no more than a short one. */
function findLeg(itin: Itinerary, nowMs: number): Leg {
  const legs = itin.legs;
  let low = 0;
  let high = legs.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (nowMs < legs[mid].startMs) high = mid - 1;
    else if (nowMs >= legs[mid].endMs) low = mid + 1;
    else return legs[mid];
  }

  return legs[Math.min(Math.max(low, 0), legs.length - 1)];
}

export interface FlightStatus extends FlightPosition {
  /** Compass bearing the bird is pointed, in degrees. */
  heading: number;
  landmark: Landmark;
  /** Ready-to-render sentence, e.g. "Riding a tailwind near Samarkand". */
  statusLine: string;
}

/**
 * The readable version: everything in `positionAt`, plus the nearest named
 * place and a sentence about it.
 *
 * Scanning the landmark table is the expensive part, so this is for the text
 * panel — which refreshes every few seconds — never for the render loop.
 */
export function statusAt(itin: Itinerary, nowMs: number): FlightStatus {
  const base = positionAt(itin, nowMs);
  const landmark = nearestLandmark(base.position).landmark;

  const heading =
    base.phase === 'flying'
      ? bearingDeg(base.position, interpolate(itin.from, itin.to, Math.min(1, base.progress + 0.004)))
      : bearingDeg(itin.from, itin.to);

  const statusLine =
    base.phase === 'arrived'
      ? `Landed ${placePhrase(landmark)}`
      : base.phase === 'waiting'
        ? `Waiting to be released ${placePhrase(landmark)}`
        : MOODS[base.mood].phrase.replace('{place}', placePhrase(landmark));

  return { ...base, heading, landmark, statusLine };
}

/**
 * Does a claimed arrival time match the distance the letter actually has to
 * cover? Run by the recipient after decrypting the manifest — the server
 * cannot check this, because it never learns the coordinates.
 *
 * Returns the ratio of claimed to expected duration. Below ~0.6 means the
 * sender's client asked for a suspiciously quick pigeon.
 */
export function verifyItinerary(itin: Itinerary, cfg: FlightConfig = FLIGHT_CONFIG): number {
  const expected = plannedDurationMs(itin.distanceKm, itin.mode, cfg);
  return itin.durationMs / expected;
}
