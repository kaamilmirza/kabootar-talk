'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FlightView } from '@/components/FlightView';
import { skyFlights } from '@/components/globe/sky';
import type { GlobeFlight } from '@/components/globe/GlobeCanvas';
import { Guard } from '@/components/Guard';
import { Kabootar } from '@/components/ui/Kabootar';
import { Screen } from '@/components/ui/primitives';
import { itineraryFor, useKabootar, type Letter } from '@/lib/client/kabootar';
import type { Itinerary } from '@/lib/flight/schedule';

export default function FlightPage() {
  return (
    <Guard>
      <Flight />
    </Guard>
  );
}

function Flight() {
  const { id } = useParams<{ id: string }>();
  const { status, nests, loadLetters, loadSky } = useKabootar();

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [pigeonName, setPigeonName] = useState<string | null>(null);
  const [nestId, setNestId] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [missing, setMissing] = useState(false);
  const [others, setOthers] = useState<GlobeFlight[]>([]);

  useEffect(() => {
    if (status !== 'ready') return;

    void (async () => {
      // There are at most a handful of nests, so a linear search is simpler
      // than threading a letter index through the whole app.
      for (const nest of nests) {
        let letters: Letter[] = [];
        try {
          letters = await loadLetters(nest.id);
        } catch {
          continue;
        }

        const letter = letters.find((l) => l.id === id);
        if (!letter) continue;

        const built = itineraryFor(letter);
        if (built) {
          setItinerary(built);
          setPigeonName(letter.pigeonName);
          setMine(letter.mine);
          setNestId(nest.id);
          return;
        }
      }

      setMissing(true);
    })();
  }, [id, loadLetters, nests, status]);

  // The rest of the flock, drawn fainter around this bird. Read-only: see
  // `loadSky` for why this does not go through `loadLetters`.
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    void loadSky()
      .then((letters) => {
        if (!cancelled) setOthers(skyFlights(letters).filter((f) => f.id !== id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, loadSky, status]);

  if (itinerary) {
    return (
      <div className="relative">
        <Link
          href={nestId ? `/nest/${nestId}` : '/'}
          className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-30 rounded-2xl border-2 border-line bg-paper px-4 py-2 text-[0.85rem] font-extrabold text-ink-soft uppercase shadow-[0_3px_0_var(--color-line)]"
        >
          &lsaquo; Back
        </Link>
        <FlightView itinerary={itinerary} pigeonName={pigeonName} letterId={id} mine={mine} others={others} />
      </div>
    );
  }

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <Kabootar mood={missing ? 'worried' : 'flying'} className="size-28" animated />
        {missing ? (
          <>
            <p className="text-center text-[1rem] font-bold text-ink-soft">
              We cannot find that pigeon.
            </p>
            <Link
              href="/"
              className="text-[0.9rem] font-extrabold text-sky-500 uppercase"
            >
              Back to your coop
            </Link>
          </>
        ) : (
          <p className="text-[0.95rem] font-bold text-ink-faint">Finding the bird&hellip;</p>
        )}
      </div>
    </Screen>
  );
}
