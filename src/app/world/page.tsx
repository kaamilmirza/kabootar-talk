'use client';

/**
 * The world map.
 *
 * Everywhere people send kabootars from, as points of light. Deliberately
 * modest about what it shows: cities, counts, and nothing else — no arcs
 * timed to real letters, no names, no moment anything moved. Appearing here
 * is opt-in and says only "somebody sends from this city", which is why the
 * map can exist at all in an app whose whole point is that the server does
 * not know where you are.
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import type { Beacon } from '@/components/globe/Beacons';
import { Guard } from '@/components/Guard';
import { Kabootar } from '@/components/ui/Kabootar';
import { Notice, Panel, TextButton } from '@/components/ui/primitives';
import { get, post } from '@/lib/client/api';
import { searchCities } from '@/lib/cities';
import { distanceKm } from '@/lib/flight/geo';
import { buildItinerary, plannedDurationMs } from '@/lib/flight/schedule';

const GlobeCanvas = dynamic(() => import('@/components/globe/GlobeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Kabootar mood="flying" className="size-24 opacity-60" animated />
    </div>
  ),
});

const JOINED_KEY = 'kabootar.worldmap.city';

interface WorldResponse {
  minimum: number;
  /** The server's answer, which is the only one that counts. */
  joined: boolean;
  cities: Beacon[];
}

export default function WorldPage() {
  return (
    <Guard>
      <World />
    </Guard>
  );
}

function World() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Queued rather than run straight through, so the first paint is not
    // chased by a second render in the same tick.
    const id = setTimeout(async () => {
      // Which city is remembered locally; *whether* you joined comes from the
      // server, so clearing browser storage cannot make the app offer to add
      // you a second time when it would only be refused.
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(JOINED_KEY);
      } catch {
        // Private browsing, or storage turned off. The map still works.
      }

      try {
        const data = await get<WorldResponse>('/api/world');
        if (cancelled) return;

        setWorld(data);
        if (data.joined) setJoined(remembered ?? 'a city you chose');
      } catch {
        if (!cancelled) setWorld({ minimum: 3, joined: false, cities: [] });
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, []);

  const join = async (city: string) => {
    setBusy(true);
    try {
      await post('/api/world', { city });
      try {
        localStorage.setItem(JOINED_KEY, city);
      } catch {
        // Not being able to remember it locally is not a reason to fail.
      }
      setJoined(city);
      setWorld(await get<WorldResponse>('/api/world'));
    } finally {
      setBusy(false);
    }
  };

  // A still globe needs something to look at; this simply holds the camera.
  const getNow = useCallback(() => Date.now(), []);
  const itinerary = useIdleItinerary();

  return (
    <div className="flex min-h-dvh flex-col bg-sky-100">
      <div className="relative h-[46dvh] min-h-[280px] shrink-0">
        <GlobeCanvas itinerary={itinerary} getNow={getNow} beacons={world?.cities ?? []} />
        <Link
          href="/"
          className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-10 rounded-2xl border-2 border-line bg-paper px-4 py-2 text-[0.85rem] font-extrabold text-ink-soft uppercase shadow-[0_3px_0_var(--color-line)]"
        >
          &lsaquo; Coop
        </Link>
      </div>

      <div className="relative -mt-6 flex-1 rounded-t-[2rem] border-t-2 border-line bg-cream">
        <div className="shell pt-6">
          <h1 className="mb-1 text-[1.6rem] leading-tight font-extrabold text-ink">
            Kabootars of the world
          </h1>
          <p className="mb-5 text-[0.95rem] leading-relaxed font-bold text-ink-faint">
            {world === null
              ? 'Looking…'
              : world.cities.length === 0
                ? 'Nowhere on the map yet. Cities appear once a few people have added them.'
                : `${world.cities.length} ${world.cities.length === 1 ? 'city' : 'cities'} sending letters.`}
          </p>

          {joined ? (
            <Notice tone="grass">
              You are on the map as <strong>{joined}</strong>. Only the city is
              shared, only as a count, and never alongside a letter or a time.
            </Notice>
          ) : (
            <Panel>
              <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">Add your city?</h2>
              <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
                Entirely optional, and the only thing in this app that tells the
                server anything about where you are. It adds one to a city&rsquo;s
                count — never your name, never a letter, never a time. Cities
                with fewer than {world?.minimum ?? 3} people are not shown at
                all, so you are never the only dot.
              </p>

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a city"
                className="mb-2 w-full rounded-2xl border-2 border-line bg-mist px-4 py-3 text-[1.0625rem] font-bold text-ink outline-none focus:border-sky-500 focus:bg-paper"
              />

              {query ? (
                <ul className="max-h-44 overflow-y-auto rounded-2xl border-2 border-line">
                  {searchCities(query).map((city) => (
                    <li key={city.label}>
                      <button
                        disabled={busy}
                        onClick={() => void join(city.label)}
                        className="w-full px-4 py-3 text-left text-[0.95rem] font-bold text-ink hover:bg-sky-100 disabled:opacity-50"
                      >
                        {city.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          )}

          {world && world.cities.length > 0 ? (
            <ol className="mt-5 flex flex-col gap-2 pb-4">
              {world.cities.slice(0, 12).map((city) => (
                <li
                  key={city.label}
                  className="flex items-center justify-between rounded-2xl border-2 border-line bg-paper px-4 py-2.5"
                >
                  <span className="text-[0.95rem] font-extrabold text-ink">{city.label}</span>
                  <span className="text-[0.85rem] font-extrabold text-amber-600">
                    {city.senders}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="pb-6 text-center">
            <TextButton onClick={() => void get<WorldResponse>('/api/world').then(setWorld)}>
              Refresh
            </TextButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A slow idle circuit, purely so the globe has a reason to turn.
 *
 * No real letter is involved and none is implied — this is the map, not a
 * flight, and nothing here corresponds to anybody's actual pigeon.
 */
function useIdleItinerary() {
  const [itinerary] = useState(() => {
    const from = { lat: 20, lon: -60 };
    const to = { lat: 35, lon: 100 };
    const departedAt = Date.now() - 6 * 3_600_000;

    return buildItinerary({
      from,
      to,
      departedAt,
      arrivesAt: departedAt + plannedDurationMs(distanceKm(from, to)) * 4,
      seed: 'world-map-idle',
    });
  });

  return itinerary;
}
