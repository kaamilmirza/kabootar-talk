import { describe, expect, it } from 'vitest';

import { distanceKm, interpolate, samplePath } from './geo';
import { nearestLandmark } from './landmarks';
import {
  buildItinerary,
  plannedDurationMs,
  positionAt,
  statusAt,
  verifyItinerary,
  type Itinerary,
} from './schedule';
import { MOODS } from './states';

const TORONTO = { lat: 43.6532, lon: -79.3832 };
const HYDERABAD = { lat: 17.385, lon: 78.4867 };
const HOUR = 3_600_000;

const DEPARTED = Date.UTC(2026, 8, 18, 14, 0, 0);

function torontoToHyderabad(seed = 'letter-001'): Itinerary {
  const km = distanceKm(TORONTO, HYDERABAD);
  return buildItinerary({
    from: TORONTO,
    to: HYDERABAD,
    departedAt: DEPARTED,
    arrivesAt: DEPARTED + plannedDurationMs(km, 'normal'),
    seed,
  });
}

describe('geo', () => {
  it('measures Toronto to Hyderabad at roughly 12,900 km', () => {
    expect(distanceKm(TORONTO, HYDERABAD)).toBeGreaterThan(12_700);
    expect(distanceKm(TORONTO, HYDERABAD)).toBeLessThan(13_000);
  });

  it('routes the great circle over the high Arctic, not the Atlantic', () => {
    const midpoint = interpolate(TORONTO, HYDERABAD, 0.4);
    expect(midpoint.lat).toBeGreaterThan(70);
  });

  it('interpolates endpoints exactly', () => {
    expect(interpolate(TORONTO, HYDERABAD, 0).lat).toBeCloseTo(TORONTO.lat, 6);
    expect(interpolate(TORONTO, HYDERABAD, 1).lon).toBeCloseTo(HYDERABAD.lon, 6);
  });

  it('samples a continuous path', () => {
    const path = samplePath(TORONTO, HYDERABAD, 32);
    expect(path).toHaveLength(33);
    for (let i = 1; i < path.length; i++) {
      expect(distanceKm(path[i - 1], path[i])).toBeLessThan(600);
    }
  });
});

describe('duration', () => {
  it('puts Toronto to Hyderabad at about 24 hours', () => {
    const hours = plannedDurationMs(distanceKm(TORONTO, HYDERABAD)) / HOUR;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThan(25.5);
  });

  it('never delivers faster than the floor, however close the nests are', () => {
    expect(plannedDurationMs(1) / HOUR).toBeGreaterThanOrEqual(4);
  });

  it('makes an express kabootar meaningfully faster but not instant', () => {
    const km = distanceKm(TORONTO, HYDERABAD);
    const express = plannedDurationMs(km, 'express') / HOUR;
    expect(express).toBeGreaterThan(3);
    expect(express).toBeLessThan(5);
  });
});

describe('itinerary', () => {
  it('fills the departure-to-arrival window exactly', () => {
    const itin = torontoToHyderabad();
    expect(itin.legs[0].startMs).toBe(itin.departedAt);
    expect(itin.legs[itin.legs.length - 1].endMs).toBe(itin.arrivesAt);
  });

  it('has contiguous legs with no gaps or overlaps', () => {
    const itin = torontoToHyderabad();
    for (let i = 1; i < itin.legs.length; i++) {
      expect(itin.legs[i].startMs).toBeCloseTo(itin.legs[i - 1].endMs, 5);
      expect(itin.legs[i].startFrac).toBeCloseTo(itin.legs[i - 1].endFrac, 9);
    }
  });

  it('advances monotonically from 0 to 1', () => {
    const itin = torontoToHyderabad();
    expect(itin.legs[0].startFrac).toBe(0);
    expect(itin.legs[itin.legs.length - 1].endFrac).toBeCloseTo(1, 9);
  });

  it('rests on land, never in open water', () => {
    const itin = torontoToHyderabad();
    const rests = itin.legs.filter((l) => l.kind === 'resting');
    expect(rests.length).toBeGreaterThan(0);
    for (const rest of rests) {
      expect(MOODS[rest.mood].kind).toBe('resting');
    }
  });

  it('never rests twice in the same place in a row', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const rests = torontoToHyderabad(seed).legs.filter((l) => l.kind === 'resting');
      for (let i = 1; i < rests.length; i++) {
        expect(rests[i].landmark.name).not.toBe(rests[i - 1].landmark.name);
      }
    }
  });

  it('only rests at sea by catching a ship', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const leg of torontoToHyderabad(seed).legs) {
        if (leg.kind === 'resting' && leg.landmark.kind === 'sea') {
          expect(leg.mood).toBe('ship');
        }
      }
    }
  });

  it('keeps any single leg short enough for the weather to change', () => {
    const itin = torontoToHyderabad();
    const longest = Math.max(...itin.legs.map((l) => l.endMs - l.startMs));
    expect(longest).toBeLessThan(4 * HOUR);
  });

  it('is deterministic for the same seed and different across seeds', () => {
    const a = torontoToHyderabad('letter-001');
    const b = torontoToHyderabad('letter-001');
    const c = torontoToHyderabad('letter-002');

    expect(a.legs.map((l) => l.mood)).toEqual(b.legs.map((l) => l.mood));
    expect(a.pigeonName).toBe(b.pigeonName);
    expect(a.legs.map((l) => l.mood).join()).not.toBe(c.legs.map((l) => l.mood).join());
  });

  it('handles a zero-distance route without dividing by zero', () => {
    const itin = buildItinerary({
      from: TORONTO,
      to: TORONTO,
      departedAt: DEPARTED,
      arrivesAt: DEPARTED + 4 * HOUR,
      seed: 'same-place',
    });
    const status = statusAt(itin, DEPARTED + 2 * HOUR);
    expect(Number.isFinite(status.position.lat)).toBe(true);
    expect(Number.isFinite(status.position.lon)).toBe(true);
  });
});

describe('statusAt', () => {
  it('reports waiting before release and landed after arrival', () => {
    const itin = torontoToHyderabad();
    expect(statusAt(itin, itin.departedAt - HOUR).phase).toBe('waiting');
    expect(statusAt(itin, itin.arrivesAt + HOUR).phase).toBe('arrived');
    expect(statusAt(itin, itin.arrivesAt + HOUR).progress).toBe(1);
  });

  it('never moves backwards over the whole flight', () => {
    const itin = torontoToHyderabad();
    let last = -1;
    for (let t = itin.departedAt; t <= itin.arrivesAt; t += 5 * 60_000) {
      const s = statusAt(itin, t);
      expect(s.progress).toBeGreaterThanOrEqual(last - 1e-9);
      expect(s.progress).toBeLessThanOrEqual(1 + 1e-9);
      last = s.progress;
    }
  });

  it('keeps kmFlown and kmRemaining adding up to the route', () => {
    const itin = torontoToHyderabad();
    const s = statusAt(itin, itin.departedAt + 10 * HOUR);
    expect(s.kmFlown + s.kmRemaining).toBeCloseTo(itin.distanceKm, 3);
  });

  it('always produces a readable status line with a real place in it', () => {
    const itin = torontoToHyderabad();
    for (let t = itin.departedAt; t < itin.arrivesAt; t += 30 * 60_000) {
      const s = statusAt(itin, t);
      expect(s.statusLine).not.toContain('{place}');
      expect(s.statusLine.length).toBeGreaterThan(8);
    }
  });

  it('crosses the Arctic partway through the journey', () => {
    const itin = torontoToHyderabad();
    const arctic = [...Array(48)].some((_, i) => {
      const s = statusAt(itin, itin.departedAt + (i / 48) * itin.durationMs);
      return s.position.lat > 65;
    });
    expect(arctic).toBe(true);
  });
});

describe('positionAt', () => {
  it('agrees with statusAt about where the bird is', () => {
    const itin = torontoToHyderabad();
    for (let i = 0; i <= 20; i++) {
      const t = itin.departedAt + (i / 20) * itin.durationMs;
      const cheap = positionAt(itin, t);
      const full = statusAt(itin, t);

      expect(cheap.progress).toBeCloseTo(full.progress, 9);
      expect(cheap.position.lat).toBeCloseTo(full.position.lat, 9);
      expect(cheap.mood).toBe(full.mood);
    }
  });

  it('is cheap enough to call on every animation frame', () => {
    // The render loop calls this 60 times a second. An earlier version used
    // statusAt here, which samples the route and scans every landmark, and it
    // froze the tab. 10,000 calls should be a few milliseconds, not seconds.
    const itin = torontoToHyderabad();
    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      positionAt(itin, itin.departedAt + (i / 10_000) * itin.durationMs);
    }

    expect(performance.now() - start).toBeLessThan(150);
  });

  it('finds the right leg at every boundary', () => {
    const itin = torontoToHyderabad();
    for (const leg of itin.legs) {
      expect(positionAt(itin, leg.startMs).leg).toBe(leg);
      expect(positionAt(itin, leg.endMs - 1).leg).toBe(leg);
    }
  });
});

describe('verifyItinerary', () => {
  it('accepts an honestly scheduled flight', () => {
    expect(verifyItinerary(torontoToHyderabad())).toBeCloseTo(1, 2);
  });

  it('catches a client that asked for an impossibly quick pigeon', () => {
    const itin = buildItinerary({
      from: TORONTO,
      to: HYDERABAD,
      departedAt: DEPARTED,
      arrivesAt: DEPARTED + 4 * HOUR,
      seed: 'cheater',
    });
    expect(verifyItinerary(itin)).toBeLessThan(0.6);
  });
});

describe('landmarks', () => {
  it('prefers a nearby city over the ocean it sits beside', () => {
    expect(nearestLandmark({ lat: 69.65, lon: 18.96 }).landmark.name).toBe('Tromso');
  });

  it('names open water when there is nothing else around', () => {
    expect(nearestLandmark({ lat: 74, lon: 38 }).landmark.name).toBe('Barents Sea');
  });

  it('always returns something, even mid-Pacific', () => {
    expect(nearestLandmark({ lat: -5, lon: -150 }).landmark).toBeDefined();
  });
});
