'use client';

/**
 * Writing a letter.
 *
 * The interface argues, gently, for taking your time: a serif face on real
 * paper, a wide measure, and a visible price. The constraint is the feature.
 */

import { useEffect, useState } from 'react';

import {
  Button,
  Label,
  Notice,
  Panel,
  TextButton,
  relativeTime,
} from '@/components/ui/primitives';
import { useKabootar, type Pigeon } from '@/lib/client/kabootar';
import { searchCities } from '@/lib/client/places';
import { MAX_LETTER_CHARS, type Place } from '@/lib/crypto/envelope';
import { distanceKm } from '@/lib/flight/geo';
import { plannedDurationMs } from '@/lib/flight/schedule';
import { effectiveSpeed, MOOD_PROFILES } from '@/lib/pigeon/life';
import { Kabootar } from '@/components/ui/Kabootar';

interface ComposeProps {
  nestId: string;
  flock: Pigeon[];
  onSent: () => void;
  onCancel: () => void;
}

export function Compose({ nestId, flock, onSent, onCancel }: ComposeProps) {
  const { places, sendLetter } = useKabootar();

  const available = flock.filter((p) => p.canFly);

  const [text, setText] = useState('');
  const [pigeonId, setPigeonId] = useState<string | null>(available[0]?.id ?? null);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void places(nestId).then((known) => {
      if (known) {
        setFrom(known.from);
        setTo(known.to);
      }
    });
  }, [nestId, places]);

  const pigeon = available.find((p) => p.id === pigeonId) ?? available[0] ?? null;
  const ready = text.trim().length > 0 && from !== null && to !== null && pigeon !== null;

  const send = async () => {
    if (!from || !to || !pigeon) return;
    setError(null);
    setBusy(true);
    try {
      await sendLetter({ nestId, pigeon, text, mode: 'normal', from, to });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The pigeon would not take it.');
    } finally {
      setBusy(false);
    }
  };

  if (!from || !to) {
    return <PlacePicker from={from} to={to} onFrom={setFrom} onTo={setTo} onCancel={onCancel} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Real paper, with an airmail edge. */}
      <div className="overflow-hidden rounded-[1.25rem] border-2 border-line bg-paper shadow-[0_4px_0_var(--color-line)]">
        <div className="airmail h-2.5" />
        <div className="p-5">
          <div className="mb-3 flex items-baseline justify-between text-[0.8rem] font-extrabold text-ink-faint uppercase">
            <span>
              {from.label} &rarr; {to.label}
            </span>
            <span>
              {text.length}/{MAX_LETTER_CHARS}
            </span>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LETTER_CHARS))}
            rows={12}
            autoFocus
            placeholder="Take your time. This one has a long way to go."
            className="letter-face w-full resize-none bg-transparent outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      <Panel>
        <fieldset>
          <legend className="mb-1 text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
            Who is taking it
          </legend>
          <p className="mb-3 text-[0.85rem] leading-relaxed font-semibold text-ink-faint">
            Only a bird standing with you can carry a letter, and only if she is
            up to the trip.
          </p>

          <div className="flex flex-col gap-2">
            {available.map((bird) => (
              <PigeonChoice
                key={bird.id}
                pigeon={bird}
                checked={pigeon?.id === bird.id}
                onSelect={() => setPigeonId(bird.id)}
                eta={
                  from && to
                    ? plannedDurationMs(
                        distanceKm(from, to),
                        'normal',
                        undefined,
                        effectiveSpeed(bird.id, bird.mood),
                      )
                    : null
                }
              />
            ))}
          </div>
        </fieldset>
      </Panel>

      {available.length === 0 ? (
        <Notice tone="amber">
          No kabootar is with you just now. Either they are both out over the
          world, or the one that is here needs feeding and resting first.
        </Notice>
      ) : null}

      {error ? <Notice tone="coral">{error}</Notice> : null}

      <div className="flex flex-col gap-2">
        <Button full disabled={!ready} busy={busy} onClick={() => void send()}>
          Release the kabootar
        </Button>
        <TextButton onClick={onCancel}>Not yet</TextButton>
      </div>
    </div>
  );
}

function PigeonChoice({
  pigeon,
  checked,
  onSelect,
  eta,
}: {
  pigeon: Pigeon;
  checked: boolean;
  onSelect: () => void;
  eta: number | null;
}) {
  const profile = MOOD_PROFILES[pigeon.mood];

  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-2.5 transition-colors ${
        checked ? 'border-grass-500 bg-grass-100' : 'border-line bg-paper'
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="size-5 shrink-0 accent-grass-500"
      />
      <Kabootar mood={profile.face} className="size-10 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[1rem] font-extrabold text-ink">{pigeon.name}</span>
        <span className="block text-[0.8rem] font-semibold text-ink-faint">
          {profile.label}
          {eta ? ` · about ${relativeTime(eta)}` : ''}
        </span>
      </span>
    </label>
  );
}

/** Asked once per nest. Never sent to the server. */
function PlacePicker({
  from,
  to,
  onFrom,
  onTo,
  onCancel,
}: {
  from: Place | null;
  to: Place | null;
  onFrom: (p: Place) => void;
  onTo: (p: Place) => void;
  onCancel: () => void;
}) {
  return (
    <Panel>
      <h2 className="mb-1.5 text-[1.15rem] font-extrabold text-ink">Where are you both?</h2>
      <p className="mb-5 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
        This sets how far the pigeon has to fly. Both cities are encrypted
        inside the letter, so the server never learns either one.
      </p>

      <CitySelect label="You are in" value={from} onChange={onFrom} />
      <div className="h-4" />
      <CitySelect label="They are in" value={to} onChange={onTo} />

      <div className="mt-5">
        <TextButton onClick={onCancel}>Cancel</TextButton>
      </div>
    </Panel>
  );
}

function CitySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place) => void;
}) {
  const [query, setQuery] = useState('');
  const results = searchCities(query);

  return (
    <div>
      <Label>{label}</Label>

      <input
        value={value && !query ? value.label : query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a city"
        className="w-full rounded-2xl border-2 border-line bg-mist px-4 py-3.5 text-[1.0625rem] font-bold text-ink outline-none focus:border-sky-500 focus:bg-paper"
      />

      {query ? (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-2xl border-2 border-line">
          {results.map((city) => (
            <li key={city.label}>
              <button
                onClick={() => {
                  onChange(city);
                  setQuery('');
                }}
                className="w-full px-4 py-3 text-left text-[0.95rem] font-bold text-ink hover:bg-sky-100"
              >
                {city.label}
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-4 py-3 text-[0.95rem] font-semibold text-ink-faint">
              No city by that name.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
