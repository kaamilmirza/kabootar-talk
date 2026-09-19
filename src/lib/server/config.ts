import 'server-only';

export const LIMITS = {
  /**
   * Nests one account can hold.
   *
   * Small on purpose. This is a tool for writing to one person, not a network:
   * there is no directory, no search, no way to be found, and both people must
   * agree before a single letter can move. Set it to 1 if you want the app to
   * be strictly one-to-one.
   */
  maxNests: 3,
  /** Birds hatched per nest, one at each end. */
  pigeonsPerNest: 2,
  /**
   * How many people must have chosen a city before it appears on the world
   * map. This number is the privacy guarantee: below it, nothing is shown.
   */
  worldMapMinimum: 3,
  /** Unredeemed invites one account can have outstanding. */
  maxOpenInvites: 3,
  invitesTtlMinutes: 60 * 24,
  challengeTtlSeconds: 120,
  sessionDays: 30,
  /** One-time prekeys a client uploads per batch, and when to top up. */
  preKeyBatch: 100,
  preKeyLowWater: 20,
  /**
   * How old a signed prekey may get before the client replaces it.
   *
   * This is the point of it being *signed* and medium-term rather than
   * permanent: rotating it bounds how much history a single compromised
   * secret could expose. It went unimplemented for a while, which quietly made
   * the signed prekey a long-term key.
   */
  signedPreKeyMaxAgeDays: 7,
} as const;

/**
 * Floors and ceilings on how long a letter may take.
 *
 * The server cannot check a claimed flight time against the real distance —
 * it never learns the coordinates. So it enforces absolute bounds instead, and
 * the recipient's client separately verifies the time against the distance it
 * decrypts. See `verifyItinerary` in the flight module.
 */
export const FLIGHT_BOUNDS = {
  normal: { minHours: 4, maxHours: 96 },
  express: { minHours: 0.5, maxHours: 10 },
} as const;

/**
 * Read a limit from the environment, falling back to the default.
 *
 * Worth having rather than hard-coding: these are per-IP, and a couple setting
 * up on the same home wifi shares one. The defaults suit a public deployment;
 * someone self-hosting for two people, or running the end-to-end tests, will
 * want them looser.
 */
function limit(name: string, fallback: number): number {
  const raw = process.env[`KABOOTAR_LIMIT_${name}`];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_LIMITS = {
  /** Sign-in attempts per IP. */
  auth: { hits: limit('AUTH', 30), windowSeconds: 600 },
  /** Account creation per IP — the main thing worth throttling. */
  register: { hits: limit('REGISTER', 5), windowSeconds: 3600 },
  /** Guesses at a pairing code per IP. */
  redeem: { hits: limit('REDEEM', 10), windowSeconds: 3600 },
} as const;

export const isProduction = process.env.NODE_ENV === 'production';
