'use client';

/**
 * A nest: the letters between two people, and the one you are writing.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Compose } from '@/components/Compose';
import { Guard } from '@/components/Guard';
import { PigeonCard } from '@/components/PigeonCard';
import { SafetyWords } from '@/components/SafetyWords';
import { Kabootar } from '@/components/ui/Kabootar';
import { Button, Notice, Panel, Screen, TextButton, relativeTime } from '@/components/ui/primitives';
import { useClockCheck, useNow } from '@/lib/client/hooks';
import { itineraryFor, useKabootar, type Letter, type Pigeon } from '@/lib/client/kabootar';
import { statusAt } from '@/lib/flight/schedule';
import { MOODS } from '@/lib/flight/states';

export default function NestPage() {
  return (
    <Guard>
      <Nest />
    </Guard>
  );
}

function Nest() {
  const { id: nestId } = useParams<{ id: string }>();
  const { status, nests, loadLetters, loadFlock, refresh } = useKabootar();

  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [flock, setFlock] = useState<Pigeon[]>([]);
  const [writing, setWriting] = useState(false);
  const [showSafety, setShowSafety] = useState(false);

  const nest = nests.find((n) => n.id === nestId);

  const reload = useCallback(async () => {
    if (status !== 'ready') return;
    try {
      const [next, birds] = await Promise.all([loadLetters(nestId), loadFlock(nestId)]);
      setLetters(next);
      setFlock(birds);
    } catch {
      setLetters([]);
    }
  }, [loadFlock, loadLetters, nestId, status]);

  // One effect, not two. Letters land on a schedule and birds come home on
  // their own, so the screen has to re-check periodically — but the first
  // fetch is queued rather than run synchronously, which keeps React from
  // cascading renders on mount.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void reload();
    };

    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [reload]);

  return (
    <Screen>
      <header className="mb-5 flex items-center justify-between">
        <Link
          href="/"
          className="rounded-xl px-2 py-2 text-[0.9rem] font-extrabold text-ink-faint uppercase"
        >
          &lsaquo; Coop
        </Link>
        <TextButton onClick={() => setShowSafety((v) => !v)}>
          {showSafety ? 'Hide' : 'Verify'}
        </TextButton>
      </header>

      {showSafety && nest ? (
        <div className="mb-5">
          <Panel tone="sky">
            <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">Safety words</h2>
            <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
              These should be identical on both your screens. If they change
              without one of you reinstalling, stop and ask why.
            </p>
            <SafetyWords nest={nest} />
          </Panel>
        </div>
      ) : null}

      <ClockWarning />

      {writing ? (
        <Compose
          nestId={nestId}
          flock={flock}
          onSent={() => {
            setWriting(false);
            void reload();
            void refresh();
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <>
          <section className="mb-6">
            <h2 className="mb-3 text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
              Your kabootars
            </h2>
            <div className="flex flex-col gap-3">
              {flock.map((bird) => (
                <PigeonCard
                  key={bird.id}
                  pigeon={bird}
                  onChange={(updated) =>
                    setFlock((current) => current.map((p) => (p.id === updated.id ? updated : p)))
                  }
                />
              ))}
            </div>
          </section>

          <div className="mb-6">
            <Button full disabled={!flock.some((p) => p.canFly)} onClick={() => setWriting(true)}>
              Write a letter
            </Button>
            {!flock.some((p) => p.canFly) ? (
              <p className="mt-3 text-center text-[0.9rem] leading-relaxed font-bold text-ink-faint">
                Nobody is fit to fly just now. Feed them, make a fuss of them,
                and wait for one to come home.
              </p>
            ) : null}
          </div>

          <LetterList letters={letters} />
        </>
      )}
    </Screen>
  );
}

function ClockWarning() {
  const check = useClockCheck();
  if (!check?.aheadOfServer) return null;

  return (
    <div className="mb-5">
      <Notice tone="amber">
        {check.line} Your clock is about {relativeTime(Math.abs(check.skewMs))} fast, so we
        are using ours.
      </Notice>
    </div>
  );
}

function LetterList({ letters }: { letters: Letter[] | null }) {
  if (letters === null) {
    return (
      <p className="pulse-soft py-10 text-center text-[0.95rem] font-bold text-ink-faint">
        Checking the coop&hellip;
      </p>
    );
  }

  if (letters.length === 0) {
    return (
      <div className="py-10 text-center">
        <Kabootar mood="waiting" className="mx-auto mb-5 size-28 opacity-80" animated />
        <p className="text-[1rem] leading-relaxed font-bold text-ink-soft">
          No letters yet.
          <br />
          Somebody has to go first.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {letters.map((letter, i) => (
        <li key={letter.id} className="pop-in" style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}>
          <LetterCard letter={letter} />
        </li>
      ))}
    </ol>
  );
}

function LetterCard({ letter }: { letter: Letter }) {
  // Letter cards refresh far more slowly than the flight screen: a progress
  // bar in a list does not need to move every second.
  const clock = useNow(15_000);
  const itinerary = itineraryFor(letter);
  const status = itinerary ? statusAt(itinerary, clock) : null;

  if (letter.status === 'locked') {
    return (
      <Panel>
        <p className="text-[0.95rem] leading-relaxed font-semibold text-ink-faint">
          This device does not have the key this letter was sealed for —
          either it was read somewhere else, or this browser was cleared since
          it was sent. Both fix themselves: the words are on their way back.
        </p>
      </Panel>
    );
  }

  if (status && status.phase !== 'arrived') {
    const mood = MOODS[status.mood];

    return (
      <Link
        href={`/flight/${letter.id}`}
        className="press block border-2 border-sky-400 bg-sky-100 p-4 shadow-[0_var(--lip)_0_var(--color-sky-400)]"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[0.75rem] font-extrabold tracking-[0.08em] text-sky-600 uppercase">
            {letter.mine ? 'Yours, in flight' : 'On its way to you'}
          </span>
          <span className="shrink-0 text-[0.85rem] font-extrabold text-sky-600">
            {Math.round(status.progress * 100)}%
          </span>
        </div>

        <p className="mb-3 flex items-start gap-2 text-left text-[1rem] leading-snug font-bold text-ink">
          <span className="shrink-0">{mood.emoji}</span>
          <span>{status.statusLine}</span>
        </p>

        <div className="mb-2.5 h-3 rounded-full border-2 border-sky-400 bg-paper">
          <div
            className="h-full rounded-full bg-amber-500 transition-[width] duration-700"
            style={{ width: `${Math.max(3, status.progress * 100)}%` }}
          />
        </div>

        <p className="text-[0.85rem] font-bold text-sky-600">
          {letter.pigeonName ?? 'She'} arrives in {relativeTime(status.msRemaining)} &middot;
          watch &rsaquo;
        </p>
      </Link>
    );
  }

  return (
    <article className="overflow-hidden rounded-[1.25rem] border-2 border-line bg-paper shadow-[0_4px_0_var(--color-line)]">
      <div className="airmail h-2.5" />
      <div className="p-5">
        <header className="mb-3 flex items-baseline justify-between gap-3 text-[0.75rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">
          <span>{letter.mine ? 'You wrote' : 'They wrote'}</span>
          <span>
            {new Date(letter.writtenAt ?? letter.departedAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            })}
          </span>
        </header>

        {letter.text ? (
          <p className="letter-face whitespace-pre-wrap">{letter.text}</p>
        ) : (
          <p className="text-[0.95rem] font-semibold text-ink-faint">
            Fetching this one from your other devices…
          </p>
        )}

        {itinerary ? (
          <footer className="mt-4 border-t-2 border-line pt-3 text-[0.8rem] font-bold text-ink-faint">
            Carried by {letter.pigeonName ?? 'a kabootar'} &middot;{' '}
            {Math.round(itinerary.distanceKm).toLocaleString()} km &middot;{' '}
            <Link href={`/flight/${letter.id}`} className="text-sky-500 underline underline-offset-2">
              see the journey
            </Link>
          </footer>
        ) : null}
      </div>
    </article>
  );
}
