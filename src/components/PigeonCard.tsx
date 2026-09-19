'use client';

/**
 * A kabootar, and everything you can do for her.
 *
 * This is the screen the app is really about. The letters are the point, but
 * the bird is what makes the waiting bearable — so she gets a face that
 * changes, vitals you can read at a glance, and two things you can do right
 * now that visibly help. Feeding and petting are instant and physical: she
 * reacts, the numbers move, and you can see that you made her better.
 *
 * Every reaction is a CSS animation on a transform, not a React re-render
 * loop, so pressing the button feels immediate even on a slow phone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';
import { Button, Panel, TextButton, relativeTime } from '@/components/ui/primitives';
import { now } from '@/lib/client/api';
import { useKabootar, type Pigeon } from '@/lib/client/kabootar';
import { MOOD_PROFILES, ageOf, bondLabel } from '@/lib/pigeon/life';

interface PigeonCardProps {
  pigeon: Pigeon;
  onChange: (pigeon: Pigeon) => void;
}

type Reaction = 'fed' | 'petted' | 'urged' | null;

export function PigeonCard({ pigeon, onChange }: PigeonCardProps) {
  // Whether she can be pushed is the server's call: only the person who sent
  // her may do it, and the recipient should not be shown a button that only
  // ever returns an error.
  const canUrge = pigeon.canUrge;
  const { tend } = useKabootar();

  const [busy, setBusy] = useState<string | null>(null);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(pigeon.name);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const profile = MOOD_PROFILES[pigeon.mood];

  const act = useCallback(
    async (action: 'feed' | 'pet' | 'urge', shows: Reaction) => {
      setBusy(action);
      setError(null);
      try {
        const updated = await tend(pigeon.id, action);
        onChange(updated);

        setReaction(shows);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setReaction(null), 1400);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'She was not having it.');
      } finally {
        setBusy(null);
      }
    },
    [onChange, pigeon.id, tend],
  );

  const rename = async () => {
    const name = draftName.trim();
    if (!name || name === pigeon.name) return setRenaming(false);

    setBusy('rename');
    try {
      onChange(await tend(pigeon.id, 'rename', name));
      setRenaming(false);
    } catch {
      setError('That name would not stick.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start gap-4">
        <button
          onClick={() => pigeon.canPet && void act('pet', 'petted')}
          disabled={!pigeon.canPet || busy !== null}
          aria-label={pigeon.canPet ? `Pet ${pigeon.name}` : `${pigeon.name} has had enough fussing`}
          className="relative shrink-0 rounded-2xl p-1 transition-transform active:scale-95 disabled:active:scale-100"
        >
          <Kabootar
            mood={profile.face}
            className={`size-24 ${reaction === 'petted' ? 'bob' : ''}`}
            animated={pigeon.place === 'flying' || reaction !== null}
          />
          {reaction ? <Sparkle kind={reaction} /> : null}
        </button>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="mb-2 flex gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value.slice(0, 24))}
                onKeyDown={(e) => e.key === 'Enter' && void rename()}
                autoFocus
                className="min-w-0 flex-1 rounded-xl border-2 border-line bg-mist px-3 py-1.5 text-[1.05rem] font-extrabold text-ink outline-none focus:border-sky-500"
              />
              <TextButton onClick={() => void rename()}>Save</TextButton>
            </div>
          ) : (
            <button
              onClick={() => { setDraftName(pigeon.name); setRenaming(true); }}
              className="mb-0.5 block text-left text-[1.3rem] leading-tight font-extrabold text-ink"
            >
              {pigeon.name}
            </button>
          )}

          <p className="mb-2 text-[0.8rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">
            {profile.label} &middot; {ageOf(pigeon.hatchedAt, now())}
          </p>

          <p className="mb-3 text-[0.95rem] leading-snug font-bold text-ink-soft">
            {pigeon.place === 'with-them'
              ? 'At the other end of the world, waiting to be sent back.'
              : profile.note}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {pigeon.traits.map((t) => (
              <span
                key={t.id}
                title={t.note}
                className="rounded-full border-2 border-sky-400 bg-sky-100 px-2.5 py-0.5 text-[0.75rem] font-extrabold text-sky-600"
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Vital label="Energy" value={pigeon.stamina} tone="grass" />
        <Vital label="Fed" value={100 - pigeon.hunger} tone="amber" />
        <Vital label="Spirits" value={pigeon.spirits} tone="sky" />
      </dl>

      {pigeon.place === 'flying' ? (
        <p className="mt-3 text-[0.85rem] font-bold text-ink-faint">
          {pigeon.arrivesAt
            ? `Lands in ${relativeTime(pigeon.arrivesAt - now())}.`
            : 'On her way.'}
        </p>
      ) : pigeon.readyAt ? (
        <p className="mt-3 text-[0.85rem] font-bold text-ink-faint">
          Fit to fly again in {relativeTime(pigeon.readyAt - now())}.
        </p>
      ) : null}

      <p className="mt-1 text-[0.8rem] font-bold text-ink-faint">
        {bondLabel(pigeon.bond)} &middot; {pigeon.trips}{' '}
        {pigeon.trips === 1 ? 'delivery' : 'deliveries'}
      </p>

      {error ? (
        <p className="mt-3 text-[0.85rem] font-bold text-coral-600">{error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          tone="amber"
          className="flex-1"
          disabled={!pigeon.canFeed}
          busy={busy === 'feed'}
          onClick={() => void act('feed', 'fed')}
        >
          {pigeon.canFeed ? 'Feed her' : 'Just fed'}
        </Button>

        {canUrge && pigeon.place === 'flying' ? (
          <Button
            tone="coral"
            className="flex-1"
            disabled={pigeon.urgesLeft === 0}
            busy={busy === 'urge'}
            onClick={() => void act('urge', 'urged')}
          >
            {pigeon.urgesLeft > 0 ? `Hurry her (${pigeon.urgesLeft})` : 'Pushed enough'}
          </Button>
        ) : null}
      </div>

      {canUrge && pigeon.place === 'flying' && pigeon.urgesLeft > 0 ? (
        <p className="mt-2 text-[0.8rem] leading-relaxed font-semibold text-ink-faint">
          She will get there sooner, and she will arrive wrecked. She will not
          be going anywhere else today.
        </p>
      ) : null}
    </Panel>
  );
}

function Vital({ label, value, tone }: { label: string; value: number; tone: 'grass' | 'amber' | 'sky' }) {
  const bar = { grass: 'bg-grass-500', amber: 'bg-amber-500', sky: 'bg-sky-500' }[tone];
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div>
      <dt className="mb-1 text-[0.7rem] font-extrabold tracking-[0.06em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd>
        <div className="h-2.5 overflow-hidden rounded-full border-2 border-line bg-paper">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </dd>
    </div>
  );
}

/** The little burst that says the thing you pressed actually landed. */
function Sparkle({ kind }: { kind: NonNullable<Reaction> }) {
  const mark = { fed: '🌾', petted: '💛', urged: '💨' }[kind];

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-1 right-0 animate-[bob_1.4s_ease-out] text-2xl"
    >
      {mark}
    </span>
  );
}
