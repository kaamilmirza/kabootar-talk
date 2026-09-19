'use client';

/**
 * Watching a letter travel.
 *
 * Two clocks on purpose. The globe runs at frame rate, entirely outside React.
 * The panel below it updates a few times a minute, because "4,891 km flown"
 * changing sixty times a second is both unreadable and a waste of a battery.
 *
 * Nothing here talks to the server. The whole journey is computed on the
 * device from the itinerary, which is how this screen can show a route the
 * server is not allowed to know.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import { GlobeBoundary } from '@/components/globe/GlobeBoundary';
import { Kabootar } from '@/components/ui/Kabootar';
import { relativeTime } from '@/components/ui/primitives';
import { now } from '@/lib/client/api';
import { statusAt, type Itinerary } from '@/lib/flight/schedule';
import { MOODS } from '@/lib/flight/states';

const GlobeCanvas = dynamic(() => import('@/components/globe/GlobeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Kabootar mood="flying" className="size-24 opacity-60" animated />
    </div>
  ),
});

/** How often the numbers under the globe refresh. */
const PANEL_TICK_MS = 4000;

export function FlightView({
  itinerary,
  pigeonName,
}: {
  itinerary: Itinerary;
  /** Her real name, rather than one invented from the letter's seed. */
  pigeonName?: string | null;
}) {
  const [status, setStatus] = useState(() => statusAt(itinerary, now()));

  // Passed into the scene and called every frame. A stable identity matters:
  // a new function each render would remount the canvas.
  const getNow = useCallback(() => now(), []);

  useEffect(() => {
    // The itinerary is captured by the closure rather than through a ref: it
    // is already an effect dependency, so the timer is rebuilt whenever it
    // changes and there is nothing to keep in sync by hand.
    const refresh = () => setStatus(statusAt(itinerary, now()));

    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, PANEL_TICK_MS);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [itinerary]);

  const mood = MOODS[status.mood];
  const landed = status.phase === 'arrived';

  return (
    <div className="flex min-h-dvh flex-col bg-sky-100">
      {/* The globe gets the top half; the facts get the bottom. */}
      <div className="relative h-[46dvh] min-h-[280px] shrink-0">
        <GlobeBoundary>
          <GlobeCanvas itinerary={itinerary} getNow={getNow} />
        </GlobeBoundary>
      </div>

      <div className="relative -mt-6 flex-1 rounded-t-[2rem] border-t-2 border-line bg-cream">
        <div className="shell pt-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-paper text-2xl shadow-[0_3px_0_var(--color-line)]">
              {mood.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
                {pigeonName ?? itinerary.pigeonName}
              </p>
              <p className="truncate text-[1.05rem] font-extrabold text-ink">{mood.label}</p>
            </div>
          </div>

          <p className="mb-5 text-[1.0625rem] leading-relaxed font-bold text-ink-soft">
            {status.statusLine}
          </p>

          <Progress progress={status.progress} itinerary={itinerary} />

          <dl className="mt-5 grid grid-cols-3 gap-2.5">
            <Stat label="Flown" value={`${Math.round(status.kmFlown).toLocaleString()} km`} />
            <Stat label="To go" value={`${Math.round(status.kmRemaining).toLocaleString()} km`} />
            <Stat
              label={landed ? 'Status' : 'Arrives'}
              value={landed ? 'Landed' : relativeTime(status.msRemaining)}
              tone={landed ? 'grass' : 'sky'}
            />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Progress({ progress, itinerary }: { progress: number; itinerary: Itinerary }) {
  const stops = itinerary.legs.filter((l) => l.kind === 'resting');

  return (
    <div>
      <div className="relative h-4 rounded-full border-2 border-line bg-paper">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-amber-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(3, progress * 100)}%` }}
        />
        {stops.map((leg, i) => (
          <span
            key={i}
            title={leg.landmark.name}
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400"
            style={{ left: `${leg.startFrac * 100}%` }}
          />
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[0.85rem] font-extrabold text-ink-faint">
        <span>{Math.round(progress * 100)}% there</span>
        <span>{Math.round(itinerary.distanceKm).toLocaleString()} km total</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'sky' | 'grass';
}) {
  const tones = {
    plain: 'bg-paper border-line text-ink',
    sky: 'bg-sky-100 border-sky-400 text-sky-600',
    grass: 'bg-grass-100 border-grass-500 text-grass-600',
  };

  return (
    <div className={`rounded-2xl border-2 px-3 py-2.5 ${tones[tone]}`}>
      <dt className="text-[0.7rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.95rem] font-extrabold">{value}</dd>
    </div>
  );
}
