/**
 * What the pigeon says to people who try to cheat time.
 *
 * The flight simulation runs on-device, so anyone curious enough will
 * eventually try winding their clock forward to land a letter early. That
 * attempt cannot work — the body ciphertext is simply not sent by the server
 * before the arrival time, and the arrival time is authenticated inside the
 * ciphertext, so it cannot be edited either.
 *
 * Since it cannot work, it may as well be funny. Poking at it is a reasonable
 * thing for a curious person to do, and being caught should feel like a wink
 * rather than a telling-off.
 */

/** Device clocks drift; this much skew is normal and gets no reaction. */
export const CLOCK_TOLERANCE_MS = 90_000;

export const TIME_TRAVELLER_LINES = [
  'The kabootar sees you changed your clock. The kabootar is unimpressed.',
  'Nice try. Birds do not observe daylight saving, and neither does this one.',
  'You can move your clock. You cannot move the bird.',
  'It still has to cross the Arctic, you know. Winding the clock does not help it.',
  'The pigeon has been flying since before you were born. It knows what time it is.',
  'Somewhere over Greenland, a bird just felt a disturbance and kept flying.',
  'Patience was rather the whole point of this, was it not?',
] as const;

export const EARLY_PEEK_LINES = [
  'That letter has not landed yet. The bird is doing its best.',
  'Still in the air. Come back when it gets there.',
  'The kabootar refuses to hand over a letter it has not delivered.',
  'Sealed until arrival. Even we cannot read it, and we are the ones holding it.',
] as const;

export function pickLine<T>(lines: readonly T[], seed: number): T {
  return lines[Math.abs(Math.floor(seed)) % lines.length];
}

export interface ClockCheck {
  /** Device clock minus server clock, in milliseconds. */
  skewMs: number;
  /** Beyond normal drift. */
  suspicious: boolean;
  /** Specifically running fast — the direction someone cheating would go. */
  aheadOfServer: boolean;
  line: string | null;
}

/**
 * Compare this device's clock against the server's.
 *
 * Every API response carries `x-kabootar-time`. A device running minutes fast
 * is either genuinely misconfigured or trying to hurry a pigeon along; either
 * way the app should show real progress based on server time, not local time.
 */
export function checkClock(deviceNow: number, serverNow: number): ClockCheck {
  const skewMs = deviceNow - serverNow;
  const suspicious = Math.abs(skewMs) > CLOCK_TOLERANCE_MS;
  const aheadOfServer = skewMs > CLOCK_TOLERANCE_MS;

  return {
    skewMs,
    suspicious,
    aheadOfServer,
    line: aheadOfServer ? pickLine(TIME_TRAVELLER_LINES, serverNow / 60_000) : null,
  };
}
