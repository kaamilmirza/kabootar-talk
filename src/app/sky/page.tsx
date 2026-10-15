'use client';

/**
 * The sky: every one of your pigeons in the air, on one globe.
 *
 * Letters both ways across every nest, each bird with her own colour and her
 * own trail, plus any that landed in the last few hours, so the route a
 * letter just took is still there to look at.
 *
 * Looking is all this page does. The list comes from `loadSky`, which never
 * opens a letter, never burns a key and never tells the server anything was
 * read — so visiting here changes nothing about any letter, in the air or
 * landed. The routes themselves are computed on this device, as everywhere
 * else in the app.
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { GlobeBoundary } from '@/components/globe/GlobeBoundary';
import { GlobeSheet } from '@/components/globe/GlobeSheet';
import { skyFlights } from '@/components/globe/sky';
import { flightColor } from '@/components/globe/store';
import { Guard } from '@/components/Guard';
import { Kabootar } from '@/components/ui/Kabootar';
import { relativeTime } from '@/components/ui/primitives';
import { now } from '@/lib/client/api';
import { useKabootar, type SkyLetter } from '@/lib/client/kabootar';
import { statusAt } from '@/lib/flight/schedule';
import { MOODS } from '@/lib/flight/states';

const GlobeCanvas = dynamic(() => import('@/components/globe/GlobeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Kabootar mood="flying" className="size-24 opacity-60" animated />
    </div>
  ),
});

/** How often the list is fetched again, so new departures appear. */
const REFRESH_MS = 60_000;

export default function SkyPage() {
  return (
    <Guard>
      <Sky />
    </Guard>
  );
}

function Sky() {
  const { status, loadSky } = useKabootar();
  const [letters, setLetters] = useState<SkyLetter[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;

    const load = () =>
      loadSky()
        .then((next) => {
          if (!cancelled) setLetters(next);
        })
        .catch(() => {
          if (!cancelled) setLetters((prev) => prev ?? []);
        });

    const first = setTimeout(load, 0);
    const timer = setInterval(load, REFRESH_MS);
    // The list's "arrives in" times move on even when nothing new arrives.
    const clock = setInterval(() => tick((n) => n + 1), 15_000);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [loadSky, status]);

  const flights = useMemo(() => skyFlights(letters ?? []), [letters]);
  const getNow = useCallback(() => now(), []);

  const t = now();
  const flying = flights.filter((f) => f.itinerary.arrivesAt > t);
  const landed = flights.length - flying.length;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0c1236]">
      {letters === null ? (
        <div className="flex h-full items-center justify-center">
          <Kabootar mood="flying" className="size-24 opacity-60" animated />
        </div>
      ) : (
        <GlobeBoundary>
          <GlobeCanvas flights={flights} focusId={focusId} getNow={getNow} />
        </GlobeBoundary>
      )}

      <Link
        href="/"
        className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-30 rounded-2xl border-2 border-line bg-paper px-4 py-2 text-[0.85rem] font-extrabold text-ink-soft uppercase shadow-[0_3px_0_var(--color-line)]"
      >
        &lsaquo; Coop
      </Link>

      <GlobeSheet
        summary={
          <>
            <h1 className="mb-1 text-[1.4rem] leading-tight font-extrabold text-ink">Pigeons in the air</h1>
            <p className="text-[0.95rem] leading-relaxed font-bold text-ink-faint">
              {letters === null
                ? 'Looking up…'
                : flying.length === 0
                  ? landed > 0
                    ? `Nobody flying right now. ${landed === 1 ? 'One landed' : `${landed} landed`} recently.`
                    : 'Nobody flying right now. Send a letter and she will appear here.'
                  : `${flying.length} ${flying.length === 1 ? 'pigeon' : 'pigeons'} on the way${landed ? `, ${landed} just landed` : ''}.`}
            </p>
          </>
        }
        detailsLabel="All pigeons"
        details={
        flights.length > 0 ? (
          <ol className="flex flex-col gap-2 pt-1 pb-2">
            {flights.map((f, i) => {
              const s = statusAt(f.itinerary, t);
              const mood = MOODS[s.mood];
              const arrived = s.phase === 'arrived';
              return (
                <li key={f.id}>
                  <div
                    className={`flex items-center gap-3 rounded-2xl border-2 bg-paper px-3 py-2.5 ${
                      focusId === f.id ? 'border-sky-400' : 'border-line'
                    }`}
                  >
                    <button
                      onClick={() => setFocusId(f.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-label={`Show ${f.name} on the globe`}
                    >
                      <span className="size-3.5 shrink-0 rounded-full border-2 border-ink/20" style={{ background: flightColor(i) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.95rem] font-extrabold text-ink">
                          {f.name} <span className="text-ink-faint">{arrived ? '✉️' : mood.emoji}</span>
                        </span>
                        <span className="block truncate text-[0.8rem] font-bold text-ink-faint">
                          {f.fromLabel} → {f.toLabel} · {f.mine ? 'from you' : 'to you'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[0.75rem] font-extrabold text-sky-600">
                        {arrived ? 'landed' : relativeTime(s.msRemaining)}
                      </span>
                    </button>
                    <Link
                      href={`/flight/${f.id}`}
                      className="shrink-0 rounded-xl bg-sky-100 px-2 py-1 text-[0.7rem] font-extrabold text-sky-600 uppercase"
                    >
                      Details
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null
        }
      />
    </div>
  );
}
