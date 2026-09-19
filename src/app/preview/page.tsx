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
import { distanceKm } from '@/lib/flight/geo';
import { buildItinerary, plannedDurationMs } from '@/lib/flight/schedule';

const TORONTO = { lat: 43.6532, lon: -79.3832, label: 'Toronto' };
const HYDERABAD = { lat: 17.385, lon: 78.4867, label: 'Hyderabad' };

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

  /*
   * No `key` on FlightView. Keying it on the slider would tear down and
   * rebuild the Canvas on every drag, and each rebuild takes a fresh WebGL
   * context the browser never gives back — a dozen drags and the context is
   * lost. Passing a new itinerary is enough; the scene updates in place.
   */
  return (
    <div className="relative">
      <FlightView itinerary={itinerary} />

      <div className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-10 px-3">
        <div className="panel mx-auto flex max-w-sm flex-col gap-2 p-3 shadow-[0_4px_0_var(--color-line)]">
          <label className="flex items-center gap-3 text-[0.8rem] font-extrabold text-ink-faint uppercase">
            <span className="shrink-0">Flight</span>
            <input
              type="range"
              min={0}
              max={100}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="h-2 flex-1 accent-grass-500"
            />
            <span className="w-10 shrink-0 text-right text-ink">{percent}%</span>
          </label>

          <button
            onClick={() => setSeed(`preview-${Math.random().toString(36).slice(2, 8)}`)}
            className="text-[0.8rem] font-extrabold text-sky-500 uppercase"
          >
            Another bird
          </button>
        </div>
      </div>
    </div>
  );
}
