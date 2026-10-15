'use client';

/**
 * A pigeon in flight with no database and no account behind it.
 *
 * Kept because the flight simulation is the part of this app most worth
 * looking at while tuning it, and spinning up an account and waiting a real
 * day is a poor way to check whether a storm looks right.
 */

import { useState } from 'react';

import { FlightView } from '@/components/FlightView';
import type { GlobeFlight } from '@/components/globe/GlobeCanvas';
import { distanceKm } from '@/lib/flight/geo';
import { buildItinerary, plannedDurationMs } from '@/lib/flight/schedule';

const TORONTO = { lat: 43.6532, lon: -79.3832, label: 'Toronto' };
const HYDERABAD = { lat: 17.385, lon: 78.4867, label: 'Hyderabad' };

/** A few more birds, so a crowded sky can be tuned too. */
const FLOCK: Array<{ from: typeof TORONTO; to: typeof TORONTO; at: number; name: string }> = [
  { from: { lat: 51.5072, lon: -0.1276, label: 'London' }, to: { lat: 6.5244, lon: 3.3792, label: 'Lagos' }, at: 0.6, name: 'Moti' },
  { from: { lat: 35.6762, lon: 139.6503, label: 'Tokyo' }, to: { lat: -33.8688, lon: 151.2093, label: 'Sydney' }, at: 0.25, name: 'Sitara' },
  { from: { lat: -23.5505, lon: -46.6333, label: 'São Paulo' }, to: { lat: 40.4168, lon: -3.7038, label: 'Madrid' }, at: 0.8, name: 'Badal' },
];

export default function PreviewPage() {
  const [percent, setPercent] = useState(35);
  const [seed, setSeed] = useState('preview-1');

  const duration = plannedDurationMs(distanceKm(TORONTO, HYDERABAD), 'normal');

  // Pinned once rather than read on every render: reading the clock during
  // render makes the component impure, and the scrubber only needs a fixed
  // reference point to slide the departure against.
  const [anchor] = useState(() => Date.now());
  const departedAt = anchor - duration * (percent / 100);

  const itinerary = buildItinerary({
    from: TORONTO,
    to: HYDERABAD,
    departedAt,
    arrivesAt: departedAt + duration,
    seed,
  });

  const [others] = useState<GlobeFlight[]>(() =>
    FLOCK.map((bird, i) => {
      const length = plannedDurationMs(distanceKm(bird.from, bird.to), 'normal');
      const left = anchor - length * bird.at;
      return {
        id: `preview-flock-${i}`,
        itinerary: buildItinerary({ from: bird.from, to: bird.to, departedAt: left, arrivesAt: left + length, seed: `flock-${i}` }),
        name: bird.name,
        mine: i % 2 === 0,
        fromLabel: bird.from.label,
        toLabel: bird.to.label,
      };
    }),
  );

  const controls = (
    <div className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2 shadow-[0_2px_0_var(--color-line)]">
      <span className="shrink-0 text-[0.7rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">Preview</span>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        aria-label="How far along the flight"
        className="h-2 min-w-0 flex-1 accent-grass-500"
      />
      <span className="w-9 shrink-0 text-right text-[0.8rem] font-extrabold text-ink">{percent}%</span>
      <button
        onClick={() => setSeed(`preview-${Math.random().toString(36).slice(2, 8)}`)}
        className="shrink-0 text-[0.7rem] font-extrabold text-sky-500 uppercase"
      >
        New bird
      </button>
    </div>
  );

  /*
   * No `key` on FlightView. Keying it on the slider would tear down and
   * rebuild the Canvas on every drag, and each rebuild takes a fresh WebGL
   * context the browser never gives back — a dozen drags and the context is
   * lost. Passing a new itinerary is enough; the scene updates in place.
   */
  return <FlightView itinerary={itinerary} others={others} extra={controls} />;
}
