'use client';

/**
 * Watching a letter travel.
 *
 * The globe gets the whole screen; the facts float over it in a sheet that
 * stays out of the way until it is pulled up. Other pigeons in the air can
 * be passed in, and are drawn as well, fainter, so this bird is seen among
 * the rest of the flock.
 *
 * Two clocks on purpose. The globe runs at frame rate, entirely outside React.
 * The panel updates a few times a minute, because "4,891 km flown" changing
 * sixty times a second is both unreadable and a waste of a battery.
 *
 * Nothing here talks to the server. The whole journey is computed on the
 * device from the itinerary, which is how this screen can show a route the
 * server is not allowed to know.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { GlobeFlight } from '@/components/globe/GlobeCanvas';
import { GlobeBoundary } from '@/components/globe/GlobeBoundary';
import { GlobeSheet } from '@/components/globe/GlobeSheet';
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

/** What a place is called, when the itinerary was built from a named one. */
export function placeLabel(p: object): string | undefined {
  const label = (p as { label?: unknown }).label;
  return typeof label === 'string' && label ? label : undefined;
}

/** How often the numbers under the globe refresh. */
const PANEL_TICK_MS = 4000;

export function FlightView({
  itinerary,
  pigeonName,
  letterId,
  mine = false,
  others = [],
  extra,
}: {
  itinerary: Itinerary;
  /** Her real name, rather than one invented from the letter's seed. */
  pigeonName?: string | null;
  letterId?: string;
  mine?: boolean;
  /** Other pigeons in the air, drawn alongside. */
  others?: GlobeFlight[];
  /** Anything else the page wants in the summary, such as the preview's controls. */
  extra?: ReactNode;
}) {
  const [status, setStatus] = useState(() => statusAt(itinerary, now()));

  const focusId = letterId ?? itinerary.seed;
  const flights = useMemo<GlobeFlight[]>(
    () => [
      {
        id: focusId,
        itinerary,
        name: pigeonName ?? itinerary.pigeonName,
        mine,
        fromLabel: placeLabel(itinerary.from),
        toLabel: placeLabel(itinerary.to),
      },
      ...others.filter((o) => o.id !== focusId),
    ],
    [focusId, itinerary, pigeonName, mine, others],
  );

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
    <div className="relative h-dvh w-full overflow-hidden bg-[#0c1236]">
      <GlobeBoundary>
        <GlobeCanvas flights={flights} focusId={focusId} getNow={getNow} />
      </GlobeBoundary>

      <GlobeSheet
        summary={
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-paper text-xl shadow-[0_3px_0_var(--color-line)]">
                {mood.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.75rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
                  {pigeonName ?? itinerary.pigeonName}
                </p>
                <p className="truncate text-[1rem] font-extrabold text-ink">{mood.label}</p>
              </div>
              <span className="shrink-0 text-right text-[0.8rem] font-extrabold text-sky-600">
                {landed ? 'Landed' : relativeTime(status.msRemaining)}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-[0.92rem] leading-snug font-bold text-ink-soft">{status.statusLine}</p>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-line" aria-label={`${Math.round(status.progress * 100)}% of the way`}>
              <div className="h-full rounded-full bg-amber-500 transition-[width] duration-700" style={{ width: `${Math.max(3, status.progress * 100)}%` }} />
            </div>
            {extra ? <div className="mt-3">{extra}</div> : null}
          </>
        }
        details={
        <div>
          <p className="mb-3 flex justify-between text-[0.8rem] font-extrabold text-ink-faint">
            <span>{Math.round(status.progress * 100)}% there</span>
            <span>{Math.round(itinerary.distanceKm).toLocaleString()} km in all</span>
          </p>

          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Flown" value={`${Math.round(status.kmFlown).toLocaleString()} km`} />
            <Stat label="To go" value={`${Math.round(status.kmRemaining).toLocaleString()} km`} />
            <Stat
              label={landed ? 'Status' : 'Arrives'}
              value={landed ? 'Landed' : relativeTime(status.msRemaining)}
              tone={landed ? 'grass' : 'sky'}
            />
          </dl>

          <Stops itinerary={itinerary} />
        </div>
        }
      />
    </div>
  );
}

/** Where she stops on the way, in order, ticked off as she goes. */
function Stops({ itinerary }: { itinerary: Itinerary }) {
  const stops = itinerary.legs.filter((l) => l.kind === 'resting');
  if (stops.length === 0) return null;
  const t = now();

  return (
    <div className="mt-5">
      <p className="mb-2 text-[0.75rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">Rest stops</p>
      <ol className="flex flex-col gap-1.5">
        {stops.map((leg, i) => {
          const done = t >= leg.endMs;
          const resting = t >= leg.startMs && t < leg.endMs;
          return (
            <li key={i} className="flex items-center gap-2.5 text-[0.9rem] font-bold text-ink-soft">
              <span
                className={`size-3 shrink-0 rounded-full border-2 ${
                  resting ? 'border-amber-600 bg-amber-500' : done ? 'border-slate-400 bg-slate-400' : 'border-sky-400 bg-paper'
                }`}
              />
              <span className={`min-w-0 flex-1 truncate ${done ? 'text-ink-faint line-through decoration-2' : ''}`}>
                {leg.landmark.name}
              </span>
              <span className="shrink-0 text-[0.75rem] text-ink-faint">
                {resting ? 'resting now' : done ? 'done' : `in ${relativeTime(leg.startMs - t)}`}
              </span>
            </li>
          );
        })}
      </ol>
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
    <div className={`min-w-0 rounded-2xl border-2 px-2.5 py-2 ${tones[tone]}`}>
      <dt className="text-[0.7rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[0.85rem] font-extrabold whitespace-nowrap">{value}</dd>
    </div>
  );
}
