import { describe, expect, it } from 'vitest';

import {
  afterDelivery,
  ageOf,
  bondLabel,
  canFeed,
  canPet,
  effectiveSpeed,
  feed,
  flightCost,
  LIFE,
  moodOf,
  pet,
  petsUsedToday,
  release,
  spiritsTarget,
  statusOf,
  urge,
  vitalsNow,
  type PigeonState,
} from './life';
import { combinedEffects, traitsFor, TRAITS } from './traits';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

const TORONTO_TO_HYDERABAD = 12_863;

function bird(over: Partial<PigeonState> = {}): PigeonState {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    name: 'Rani',
    hatchedAt: NOW - 10 * DAY,
    stamina: 100,
    hunger: 0,
    spirits: 80,
    vitalsAt: NOW,
    fedAt: NOW,
    pettedAt: NOW,
    petsToday: 0,
    petsDayAt: null,
    trips: 0,
    bond: 0,
    place: 'with-you',
    arrivesAt: null,
    urges: 0,
    ...over,
  };
}

describe('traits', () => {
  it('gives every bird two different traits', () => {
    for (let i = 0; i < 200; i++) {
      const traits = traitsFor(`pigeon-${i}`);
      expect(traits).toHaveLength(2);
      expect(traits[0].id).not.toBe(traits[1].id);
    }
  });

  it('gives the same bird the same traits every time, in any runtime', () => {
    expect(traitsFor('steady-id').map((t) => t.id)).toEqual(
      traitsFor('steady-id').map((t) => t.id),
    );
  });

  it('spreads traits across the whole set rather than favouring a few', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const t of traitsFor(`bird-${i}`)) seen.add(t.id);
    }
    expect(seen.size).toBe(TRAITS.length);
  });

  it('folds both traits into one set of effects', () => {
    const effects = combinedEffects('some-bird');
    expect(effects.speed).toBeGreaterThan(0.5);
    expect(effects.speed).toBeLessThan(2);
    expect(effects.recovery).toBeGreaterThan(0);
  });
});

describe('drift over time', () => {
  it('leaves a bird exactly as she was at the moment she was written', () => {
    const v = vitalsNow(bird(), NOW);
    expect(v.stamina).toBe(100);
    expect(v.hunger).toBe(0);
  });

  it('gets hungry on her own, with nothing running', () => {
    const v = vitalsNow(bird(), NOW + 24 * HOUR);
    expect(v.hunger).toBeGreaterThan(45);
    expect(v.hunger).toBeLessThan(60);
  });

  it('recovers stamina while resting', () => {
    const tired = bird({ stamina: 30 });
    expect(vitalsNow(tired, NOW + 10 * HOUR).stamina).toBeGreaterThan(50);
  });

  it('does not recover stamina while in the air', () => {
    const flying = bird({ stamina: 40, place: 'flying', arrivesAt: NOW + 20 * HOUR });
    expect(vitalsNow(flying, NOW + 10 * HOUR).stamina).toBe(40);
  });

  it('still gets hungry in the air', () => {
    const flying = bird({ place: 'flying', arrivesAt: NOW + 20 * HOUR });
    expect(vitalsNow(flying, NOW + 10 * HOUR).hunger).toBeGreaterThan(15);
  });

  it('never drifts outside 0 to 100', () => {
    const neglected = bird({ stamina: 5, hunger: 95, spirits: 5, fedAt: NOW - 30 * DAY });
    for (const days of [1, 7, 30, 365]) {
      const v = vitalsNow(neglected, NOW + days * DAY);
      for (const n of [v.stamina, v.hunger, v.spirits]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('spirits', () => {
  it('sits high for a bird who is fed, rested and visited', () => {
    const happy = bird();
    expect(spiritsTarget(happy, NOW, { stamina: 100, hunger: 10, spirits: 80 })).toBeGreaterThan(75);
  });

  it('falls when she is hungry', () => {
    const b = bird();
    const fed = spiritsTarget(b, NOW, { stamina: 100, hunger: 10, spirits: 80 });
    const starving = spiritsTarget(b, NOW, { stamina: 100, hunger: 95, spirits: 80 });
    expect(starving).toBeLessThan(fed - 20);
  });

  it('falls when she is worn out', () => {
    const b = bird();
    const rested = spiritsTarget(b, NOW, { stamina: 100, hunger: 10, spirits: 80 });
    const spent = spiritsTarget(b, NOW, { stamina: 5, hunger: 10, spirits: 80 });
    expect(spent).toBeLessThan(rested - 15);
  });

  it('falls when she is ignored, and keeps falling', () => {
    const b = bird();
    const vitals = { stamina: 100, hunger: 10, spirits: 80 };
    const soon = spiritsTarget(b, NOW + 12 * HOUR, vitals);
    const later = spiritsTarget(b, NOW + 3 * DAY, vitals);
    expect(later).toBeLessThan(soon);
  });

  it('is steadier in a bird that trusts you', () => {
    const vitals = { stamina: 100, hunger: 70, spirits: 60 };
    const stranger = spiritsTarget(bird({ bond: 0 }), NOW, vitals);
    const oldFriend = spiritsTarget(bird({ bond: 100 }), NOW, vitals);
    expect(oldFriend).toBeGreaterThan(stranger);
  });

  it('moves gradually, so one handful of grain does not undo two days alone', () => {
    const miserable = bird({ spirits: 10, hunger: 90, fedAt: NOW - 3 * DAY, pettedAt: NOW - 3 * DAY });
    const afterFeeding = feed(miserable, NOW);
    expect(afterFeeding.spirits).toBeLessThan(30);
  });
});

describe('mood', () => {
  const v = (over: Partial<{ stamina: number; hunger: number; spirits: number }> = {}) => ({
    stamina: 100,
    hunger: 10,
    spirits: 80,
    ...over,
  });

  it('reports flying above everything else', () => {
    expect(moodOf('flying', v({ stamina: 1, hunger: 100, spirits: 0 }))).toBe('flying');
  });

  it('puts exhaustion before hunger before sulking', () => {
    expect(moodOf('with-you', v({ stamina: 10, hunger: 100, spirits: 0 }))).toBe('exhausted');
    expect(moodOf('with-you', v({ stamina: 100, hunger: 90, spirits: 0 }))).toBe('ravenous');
    expect(moodOf('with-you', v({ stamina: 100, hunger: 10, spirits: 10 }))).toBe('sulking');
  });

  it('is delighted only when everything is right', () => {
    expect(moodOf('with-you', v({ stamina: 95, hunger: 10, spirits: 95 }))).toBe('delighted');
    expect(moodOf('with-you', v({ stamina: 95, hunger: 50, spirits: 95 }))).not.toBe('delighted');
  });

  it('always has a mood, whatever the numbers', () => {
    for (let s = 0; s <= 100; s += 7) {
      for (let h = 0; h <= 100; h += 7) {
        for (let sp = 0; sp <= 100; sp += 7) {
          const mood = moodOf('with-you', { stamina: s, hunger: h, spirits: sp });
          expect(mood).toBeTruthy();
        }
      }
    }
  });

  it('makes an unhappy bird slower than a delighted one', () => {
    expect(effectiveSpeed('x', 'delighted')).toBeGreaterThan(effectiveSpeed('x', 'sulking'));
    expect(effectiveSpeed('x', 'content')).toBeGreaterThan(effectiveSpeed('x', 'exhausted'));
  });
});

describe('being looked after', () => {
  it('feeding fills her up and cheers her a little', () => {
    const hungry = bird({ hunger: 80, spirits: 50 });
    const after = feed(hungry, NOW);
    expect(after.hunger).toBeLessThan(40);
    expect(after.spirits).toBeGreaterThan(50);
  });

  it('will not be fed again straight away', () => {
    const b = bird({ fedAt: NOW });
    expect(canFeed(b, NOW + HOUR)).toBe(false);
    expect(canFeed(b, NOW + LIFE.feedCooldownHours * HOUR)).toBe(true);
  });

  it('a bird who has never been fed can be fed', () => {
    expect(canFeed(bird({ fedAt: null }), NOW)).toBe(true);
  });

  it('petting lifts her spirits', () => {
    const b = bird({ spirits: 50 });
    expect(pet(b, NOW).spirits).toBeGreaterThan(50);
  });

  it('petting is worth less the more you do it', () => {
    const first = pet(bird({ spirits: 40, petsToday: 0, petsDayAt: NOW }), NOW).spirits;
    const fifth = pet(bird({ spirits: 40, petsToday: 4, petsDayAt: NOW }), NOW).spirits;
    expect(fifth).toBeLessThan(first);
  });

  it('she gets bored of being fussed over, until tomorrow', () => {
    const fussed = bird({ petsToday: LIFE.petsPerDay, petsDayAt: NOW });
    expect(canPet(fussed, NOW)).toBe(false);
    expect(canPet(fussed, NOW + DAY)).toBe(true);
    expect(petsUsedToday(fussed, NOW + DAY)).toBe(0);
  });

  it('neither feeding nor petting can push a vital past its limits', () => {
    const full = bird({ stamina: 100, hunger: 0, spirits: 100 });
    const fed = feed(full, NOW);
    expect(fed.hunger).toBe(0);
    expect(fed.spirits).toBeLessThanOrEqual(100);
    expect(pet(full, NOW).spirits).toBeLessThanOrEqual(100);
  });
});

describe('flying', () => {
  it('costs more the further she has to go', () => {
    expect(flightCost(100)).toBeLessThan(flightCost(5000));
    expect(flightCost(5000)).toBeLessThan(flightCost(TORONTO_TO_HYDERABAD));
  });

  it('never costs more than the ceiling, however absurd the distance', () => {
    expect(flightCost(500_000)).toBeLessThanOrEqual(LIFE.maxFlightCost);
  });

  it('leaves her tired, hungrier, and rather pleased with herself', () => {
    const before = bird();
    const after = release(before, NOW, TORONTO_TO_HYDERABAD);
    expect(after.stamina).toBeLessThan(50);
    expect(after.hunger).toBeGreaterThan(before.hunger);
    expect(after.spirits).toBeGreaterThan(before.spirits);
  });

  it('will not go out again until she has rested', () => {
    const justLanded = bird({ stamina: 38, vitalsAt: NOW });
    expect(statusOf(justLanded, NOW).canFly).toBe(false);
    expect(statusOf(justLanded, NOW).blockedBecause).toBe('tired');

    const readyAt = statusOf(justLanded, NOW).readyAt!;
    expect(readyAt).toBeGreaterThan(NOW);
    expect(statusOf(justLanded, readyAt + HOUR).canFly).toBe(true);
  });

  it('digs her heels in when her spirits are on the floor', () => {
    const miserable = bird({ spirits: 5, stamina: 100 });
    const status = statusOf(miserable, NOW);
    expect(status.canFly).toBe(false);
    expect(status.blockedBecause).toBe('unwilling');
  });

  it('cannot be sent from the far side of the world', () => {
    expect(statusOf(bird({ place: 'with-them' }), NOW).blockedBecause).toBe('away');
  });

  it('cannot be sent while she is already carrying something', () => {
    const flying = bird({ place: 'flying', arrivesAt: NOW + HOUR });
    expect(statusOf(flying, NOW).canFly).toBe(false);
    expect(statusOf(flying, NOW).blockedBecause).toBe('flying');
  });

  it('a rested, cheerful, well-fed bird is ready to go', () => {
    expect(statusOf(bird(), NOW).canFly).toBe(true);
  });
});

describe('urging her on', () => {
  const flying = (over: Partial<PigeonState> = {}) =>
    bird({ place: 'flying', arrivesAt: NOW + 20 * HOUR, stamina: 60, ...over });

  it('brings the arrival forward', () => {
    const result = urge(flying(), NOW)!;
    expect(result.arrivesAt).toBeLessThan(NOW + 20 * HOUR);
    expect(result.savedMs).toBeGreaterThan(0);
  });

  it('costs her, in both energy and temper', () => {
    const before = flying();
    const result = urge(before, NOW)!;
    expect(result.vitals.stamina).toBeLessThan(before.stamina);
    expect(result.vitals.spirits).toBeLessThan(before.spirits);
  });

  it('can only be done so many times', () => {
    expect(urge(flying({ urges: LIFE.maxUrgesPerFlight }), NOW)).toBeNull();
    expect(statusOf(flying({ urges: LIFE.maxUrgesPerFlight }), NOW).urgesLeft).toBe(0);
    expect(statusOf(flying({ urges: 1 }), NOW).urgesLeft).toBe(LIFE.maxUrgesPerFlight - 1);
  });

  it('does nothing to a bird who is not flying', () => {
    expect(urge(bird(), NOW)).toBeNull();
  });

  it('does nothing once she has already landed', () => {
    expect(urge(flying({ arrivesAt: NOW - HOUR }), NOW)).toBeNull();
  });

  it('takes less off the closer she already is', () => {
    const early = urge(flying({ arrivesAt: NOW + 20 * HOUR }), NOW)!;
    const late = urge(flying({ arrivesAt: NOW + 2 * HOUR }), NOW)!;
    expect(late.savedMs).toBeLessThan(early.savedMs);
  });

  it('leaves a bird urged to the limit genuinely wrecked', () => {
    let b = flying({ stamina: 70, spirits: 70 });
    for (let i = 0; i < LIFE.maxUrgesPerFlight; i++) {
      const result = urge(b, NOW)!;
      b = { ...b, ...result.vitals, urges: b.urges + 1, arrivesAt: result.arrivesAt };
    }
    expect(b.stamina).toBeLessThan(LIFE.readyAt);
    expect(urge(b, NOW)).toBeNull();
  });
});

describe('a life, accumulated', () => {
  it('grows the bond with every delivery', () => {
    expect(afterDelivery(bird({ bond: 0 }))).toBeGreaterThan(0);
  });

  it('never pushes the bond past its limit', () => {
    expect(afterDelivery(bird({ bond: LIFE.maxBond }))).toBe(LIFE.maxBond);
  });

  it('describes her age in words', () => {
    expect(ageOf(NOW, NOW)).toBe('hatched today');
    expect(ageOf(NOW - DAY, NOW)).toBe('one day old');
    expect(ageOf(NOW - 5 * DAY, NOW)).toBe('5 days old');
    expect(ageOf(NOW - 60 * DAY, NOW)).toBe('2 months old');
  });

  it('describes how well she knows the route', () => {
    expect(bondLabel(0)).toMatch(/new/i);
    expect(bondLabel(100)).toMatch(/sleep/i);
  });
});

describe('the care loop end to end', () => {
  it('a neglected bird becomes unflyable, and can be brought back', () => {
    // Left alone for three days after a hard flight.
    let b = bird({
      stamina: 35,
      hunger: 30,
      spirits: 60,
      vitalsAt: NOW,
      fedAt: NOW,
      pettedAt: NOW,
    });

    const later = NOW + 3 * DAY;
    const neglected = vitalsNow(b, later);
    expect(neglected.hunger).toBeGreaterThan(80);
    expect(neglected.spirits).toBeLessThan(40);

    // Rested, at least.
    expect(neglected.stamina).toBeGreaterThan(LIFE.readyAt);

    // Feed her, and she is materially better off.
    b = { ...b, ...feed({ ...b, vitalsAt: b.vitalsAt }, later), fedAt: later };
    expect(b.hunger).toBeLessThan(neglected.hunger);
    expect(b.spirits).toBeGreaterThan(neglected.spirits);
  });

  it('keeps a well-tended bird in good order indefinitely', () => {
    let b = bird();

    // Fed and visited once a day for a fortnight.
    for (let day = 1; day <= 14; day++) {
      const at = NOW + day * DAY;
      b = { ...b, ...feed(b, at), fedAt: at, pettedAt: at, petsToday: 0, petsDayAt: at };
    }

    const status = statusOf(b, NOW + 14 * DAY + HOUR);
    expect(status.canFly).toBe(true);
    expect(['content', 'delighted']).toContain(status.mood);
  });
});
