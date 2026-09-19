import { describe, expect, it } from 'vitest';

import { relativeTime } from './primitives';

/**
 * Durations are shown all over the app — when a bird lands, when she is fit to
 * fly, how long guessing is paused for. A lockout of thirty seconds described
 * as "0 minutes" reads as a bug rather than as a wait, which is exactly what
 * it did before these existed.
 */
describe('relativeTime', () => {
  it('never says zero of anything', () => {
    for (let ms = 1; ms < 2 * 3_600_000; ms += 997) {
      expect(relativeTime(ms)).not.toMatch(/^0 /);
    }
  });

  it('describes seconds as seconds', () => {
    expect(relativeTime(30_000)).toBe('30 seconds');
    expect(relativeTime(45_000)).toBe('45 seconds');
  });

  it('rounds the very short to a moment', () => {
    expect(relativeTime(3_000)).toBe('a moment');
    expect(relativeTime(1)).toBe('a moment');
  });

  it('says now for nothing left', () => {
    expect(relativeTime(0)).toBe('now');
    expect(relativeTime(-5_000)).toBe('now');
  });

  it('moves up through the units', () => {
    expect(relativeTime(90_000)).toBe('2 minutes');
    expect(relativeTime(30 * 60_000)).toBe('30 minutes');
    expect(relativeTime(3 * 3_600_000)).toBe('3 hours');
    expect(relativeTime(25 * 3_600_000)).toBe('1 day');
    expect(relativeTime(3 * 86_400_000)).toBe('3 days');
  });

  it('gets singulars right', () => {
    expect(relativeTime(60_000)).toBe('1 minute');
    expect(relativeTime(3_600_000 + 60_000)).toMatch(/^1h|1 hour/);
  });
});
