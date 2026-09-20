'use client';

/**
 * The landing page.
 *
 * It has one job: explain what this is and why it is slow, to somebody who has
 * never heard of it, without hectoring them. The argument is stated once and
 * then left alone — anyone who has ever felt their phone go off during dinner
 * already agrees, and anyone who has not will not be talked round by a landing
 * page.
 *
 * Sections rise into view through a single IntersectionObserver rather than a
 * scroll handler, and every animation on the page moves only transform or
 * opacity, so the whole thing composites and nothing runs while you scroll.
 */

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';
import { Button, TextButton } from '@/components/ui/primitives';

import {
  Feather,
  GrainArt,
  LetterArt,
  MoodTrio,
  NoisyPhone,
  RouteArt,
  SealLock,
  StampArt,
} from './art';

interface LandingProps {
  /**
   * Given when the app itself is showing this page, so "Start a coop" moves
   * straight into setup. Left out on the standalone `/about` route, where the
   * same buttons become ordinary links — which is what lets that page be
   * served as static HTML and read with no JavaScript at all.
   */
  onBegin?: () => void;
  onRestore?: () => void;
}

export function Landing({ onBegin, onRestore }: LandingProps) {
  useReveal();

  return (
    <main className="min-h-dvh overflow-x-hidden bg-cream">
      <Hero onBegin={onBegin} onRestore={onRestore} />
      <TheCase />
      <HowItWorks />
      <TheBird />
      <TheJourney />
      <WhatWeKnow />
      <ReadTheCode />
      <Closing onBegin={onBegin} />
    </main>
  );
}

// --- hero --------------------------------------------------------------------

function Hero({ onBegin, onRestore }: LandingProps) {
  return (
    <header className="relative overflow-hidden">
      {/* a soft sky behind the bird, drawn with colour rather than an image */}
      <div className="pointer-events-none absolute inset-0 bg-sky-100" aria-hidden />
      <div
        className="pointer-events-none absolute -top-24 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-paper/60 blur-2xl"
        aria-hidden
      />

      <div className="shell relative flex flex-col items-center pt-[max(3rem,env(safe-area-inset-top))] pb-14 text-center">
        <div className="float mb-6">
          <Kabootar className="size-40" />
        </div>

        <h1 className="text-[2.9rem] leading-[0.95] font-extrabold tracking-tight text-ink">
          Kabootar
          <span className="block text-grass-500">Talk</span>
        </h1>

        <p className="mx-auto mt-6 max-w-[20rem] text-[1.15rem] leading-relaxed font-bold text-ink-soft">
          One letter a day, carried by a bird that actually has to fly there.
        </p>

        <p className="mx-auto mt-3 max-w-[20rem] text-[0.98rem] leading-relaxed font-semibold text-ink-faint">
          Toronto to Hyderabad takes about a day. Not because we made you wait —
          because that is how far it is.
        </p>

        <div className="mt-9 flex w-full max-w-xs flex-col gap-3">
          <StartButton onBegin={onBegin} />
          {onRestore ? (
            <TextButton onClick={onRestore}>I have a recovery phrase</TextButton>
          ) : (
            <Link
              href="/"
              className="rounded-xl px-4 py-2.5 text-[0.95rem] font-extrabold tracking-wide text-ink-faint uppercase"
            >
              I have a recovery phrase
            </Link>
          )}
        </div>

        <div className="mt-10 flex items-center gap-3 text-ink-faint">
          <Feather className="size-6 float" />
          <span className="text-[0.8rem] font-extrabold tracking-[0.2em] uppercase">
            Scroll
          </span>
          <Feather className="size-6 float" />
        </div>
      </div>
    </header>
  );
}

// --- the argument ------------------------------------------------------------

function TheCase() {
  return (
    <Section>
      <div className="mx-auto max-w-[22rem]">
        <Eyebrow>Why it is slow</Eyebrow>
        <h2 className="mb-5 text-[1.9rem] leading-[1.1] font-extrabold text-ink">
          Everything else arrives instantly.
        </h2>

        <div className="mb-8">
          <NoisyPhone className="mx-auto w-full max-w-[16rem]" />
        </div>

        <div className="flex flex-col gap-4 text-[1.02rem] leading-relaxed font-semibold text-ink-soft">
          <p>
            Messages land before you have finished thinking them. A reply that
            takes an hour reads as a slight. Two people can exchange four
            hundred words a day and none of them get remembered.
          </p>
          <p>
            Somewhere along the way, writing to someone stopped being a thing
            you did and became a thing you were always doing.
          </p>
          <p className="text-ink">
            This is a small argument with that. One letter. One bird. A day for
            it to cross the world, and nothing you can do to hurry it that does
            not cost the bird something.
          </p>
        </div>
      </div>
    </Section>
  );
}

// --- how it works ------------------------------------------------------------

const STEPS = [
  {
    n: '01',
    title: 'Pair with one person',
    body: 'Six words, handed over once. There is no directory, no search, and no way to be found. They approve you; you approve them. Nobody else can ever write to you.',
    art: <StampArt className="size-24" />,
  },
  {
    n: '02',
    title: 'Write something worth the trip',
    body: 'Real paper, a serif face, and room to think. You are not going to say it again in ten minutes, so you say it properly the first time.',
    art: <LetterArt className="w-full max-w-[13rem]" />,
  },
  {
    n: '03',
    title: 'Give it to a bird',
    body: 'A nest keeps two kabootars, one at each end. You hand the letter to whichever is standing with you, and she goes.',
    art: <GrainArt className="w-full max-w-[13rem]" />,
  },
  {
    n: '04',
    title: 'Then wait',
    body: 'She is on the other side of the world now, and she stays there until they write back with her. If both birds are at their end, you cannot write. There is nothing to write with.',
    art: <RouteArt className="w-full max-w-[14rem]" />,
  },
];

function HowItWorks() {
  return (
    <Section tone="paper">
      <div className="mx-auto max-w-[24rem]">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mb-9 text-[1.9rem] leading-[1.1] font-extrabold text-ink">
          Four things, and then patience.
        </h2>

        <ol className="flex flex-col gap-8">
          {STEPS.map((step) => (
            <li key={step.n} className="reveal">
              <div className="mb-4 flex justify-center">{step.art}</div>

              <div className="rounded-[1.25rem] border-2 border-line bg-cream p-5">
                <span className="mb-2 block text-[0.8rem] font-extrabold tracking-[0.18em] text-grass-500">
                  {step.n}
                </span>
                <h3 className="mb-2 text-[1.2rem] leading-tight font-extrabold text-ink">
                  {step.title}
                </h3>
                <p className="text-[0.98rem] leading-relaxed font-semibold text-ink-soft">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// --- the bird ----------------------------------------------------------------

function TheBird() {
  return (
    <Section>
      <div className="mx-auto max-w-[22rem]">
        <Eyebrow>Your kabootars</Eyebrow>
        <h2 className="mb-4 text-[1.9rem] leading-[1.1] font-extrabold text-ink">
          She is not a progress bar.
        </h2>

        <p className="mb-7 text-[1.02rem] leading-relaxed font-semibold text-ink-soft">
          Every bird hatches with a name and two traits, and they are not
          decoration. A <strong className="text-ink">Curious</strong> one really
          does stop more often and take longer. A{' '}
          <strong className="text-ink">Swift</strong> one really does arrive
          sooner. A <strong className="text-ink">Stormheart</strong> flies into
          weather that turns other birds back.
        </p>

        <div className="mb-7">
          <MoodTrio className="w-full" />
        </div>

        <div className="flex flex-col gap-3">
          <Fact title="She gets tired">
            A twelve-thousand-kilometre crossing nearly empties her. She will
            not go out again until she has rested, and no button makes that
            shorter.
          </Fact>
          <Fact title="She gets hungry">
            On her own, whether or not you have the app open. Feed her.
          </Fact>
          <Fact title="She gets low">
            Hunger drags her spirits down, and so does being ignored. A bird in
            poor spirits flies slower. Leave her long enough and she will simply
            refuse to go, and you will have to win her round.
          </Fact>
          <Fact title="You can hurry her" tone="coral">
            Mid-flight, three times at most. She gets there sooner and she
            arrives wrecked, and she is going nowhere else that day. It is
            offered honestly and priced honestly.
          </Fact>
        </div>
      </div>
    </Section>
  );
}

function Fact({
  title,
  children,
  tone = 'plain',
}: {
  title: string;
  children: ReactNode;
  tone?: 'plain' | 'coral';
}) {
  const skin =
    tone === 'coral'
      ? 'border-coral-500 bg-coral-100'
      : 'border-line bg-paper';

  return (
    <div className={`reveal rounded-2xl border-2 p-4 ${skin}`}>
      <h3 className="mb-1 text-[1.02rem] font-extrabold text-ink">{title}</h3>
      <p className="text-[0.93rem] leading-relaxed font-semibold text-ink-soft">{children}</p>
    </div>
  );
}

// --- the journey -------------------------------------------------------------

function TheJourney() {
  return (
    <Section tone="sky">
      <div className="mx-auto max-w-[22rem]">
        <Eyebrow>The journey</Eyebrow>
        <h2 className="mb-4 text-[1.9rem] leading-[1.1] font-extrabold text-ink">
          You can watch her the whole way.
        </h2>

        <p className="mb-6 text-[1.02rem] leading-relaxed font-semibold text-ink-soft">
          A real great-circle route on a real map. Toronto to Hyderabad arcs up
          over the Arctic, because that is genuinely the short way. She rests,
          she meets weather, and she flies through the night with the terminator
          moving across the globe behind her.
        </p>

        <div className="rounded-[1.25rem] border-2 border-sky-400 bg-paper p-5">
          <p className="mb-3 text-[0.8rem] font-extrabold tracking-[0.14em] text-sky-600 uppercase">
            Somewhere over the Barents Sea
          </p>
          <p className="letter-face text-ink">
            &ldquo;Riding the rail of a trawler over the Greenland Sea, no land
            for hours.&rdquo;
          </p>
          <p className="mt-3 text-[0.85rem] font-bold text-ink-faint">
            4,891 km flown &middot; 7,972 to go
          </p>
        </div>

        <p className="mt-6 text-[0.93rem] leading-relaxed font-semibold text-ink-faint">
          All of it computed on your own device, from the letter itself. The
          server is never told where either of you is, so it could not draw this
          map even if it wanted to.
        </p>
      </div>
    </Section>
  );
}

// --- privacy -----------------------------------------------------------------

const GUARANTEES = [
  ['No account', 'No email, no phone number, no password. Your identity is twelve words that never leave your device, and a short PIN to unlock them each day.'],
  ['No readable letters', 'Everything is end-to-end encrypted. The server stores ciphertext it has no key for.'],
  ['No early delivery', 'The arrival time is sealed inside the letter. A server that tried to hand one over early would destroy it in the attempt.'],
  ['No location', 'Both cities are encrypted inside the letter. Nothing in the database says where anybody is.'],
  ['No way in', 'Letters are opened with a key that is destroyed on use. Even with the database and both phones, yesterday cannot be reread.'],
];

function WhatWeKnow() {
  return (
    <Section tone="paper">
      <div className="mx-auto max-w-[22rem]">
        <Eyebrow>What we know about you</Eyebrow>
        <h2 className="mb-6 text-[1.9rem] leading-[1.1] font-extrabold text-ink">
          Almost nothing, and that is on purpose.
        </h2>

        <div className="mb-7">
          <SealLock className="mx-auto w-full max-w-[13rem]" />
        </div>

        <ul className="flex flex-col gap-3">
          {GUARANTEES.map(([title, body]) => (
            <li key={title} className="reveal flex gap-3 rounded-2xl border-2 border-grass-500 bg-grass-100 p-4">
              <span className="mt-0.5 shrink-0 text-lg" aria-hidden>
                ✓
              </span>
              <span>
                <strong className="block text-[1rem] font-extrabold text-ink">{title}</strong>
                <span className="text-[0.92rem] leading-relaxed font-semibold text-ink-soft">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-[0.9rem] leading-relaxed font-semibold text-ink-faint">
          What a stolen database would contain: two opaque ids wrote to each
          other, and roughly when. That is the floor for any system that
          delivers anything at all. It is also honest work rather than a
          promise — the whole thing is open source, and the part worth reading
          is about six hundred lines.
        </p>
      </div>
    </Section>
  );
}

// --- closing -----------------------------------------------------------------

/*
 * The claims above, made checkable.
 *
 * Folded away because almost nobody wants it, and the few who do want the
 * files rather than a description of them. `details` rather than state, so it
 * works with JavaScript off like the rest of this page.
 */
const REPO = 'https://github.com/kaamilmirza/kabootar-talk';

function ReadTheCode() {
  return (
    <section className="bg-mist py-14">
      <div className="shell">
        <details className="group">
          <summary className="cursor-pointer list-none text-center text-[0.95rem] font-extrabold tracking-[0.06em] text-ink-faint uppercase hover:text-sky-500">
            Read the code
          </summary>

          <div className="mt-8">
            <p className="mb-7 text-[1rem] leading-relaxed font-semibold text-ink-soft">
              Every claim on this page is checkable. Four files are worth your
              time.
            </p>

            <Where
              path="src/lib/db/schema.sql"
              note="Every column the server has. If the database leaked, this file is the whole of what leaked."
            />
            <Where
              path="src/lib/db/queries.ts"
              note="Every database access in one file. Read it and you know exactly what the server can do."
            />
            <Where
              path="src/lib/crypto/"
              note="About 600 lines. Key agreement, the letter envelope, the archive."
            />
            <Where
              path="next.config.ts"
              note="The browser policy. connect-src 'self' means an injected script has nowhere to send anything."
            />

            <h3 className="mt-10 mb-4 text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
              Three things worth seeing
            </h3>

            <Snippet
              code={'case when arrives_at <= now() then body else null end'}
              note="The server cannot hand over a letter early, because the body is not selected until the arrival time. The gate is in SQL, not in the app."
            />
            <Snippet
              code={'header    jsonb  not null\nmanifest  text   not null\nbody      text   not null'}
              note="All three are ciphertext. There is no column for a name, an email, or a location, so there is none to leak."
            />
            <Snippet
              code={"derive(identity.signing.secretKey, 'archive/v1')"}
              note="The key your kept letters are sealed with, derived from your twelve words. Every device you own arrives at the same key without it ever being sent anywhere."
            />

            <p className="mt-8 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
              It is not audited. It is a careful implementation of
              well-understood primitives, and you can check that claim yourself.
            </p>

            <a
              href={REPO}
              className="mt-5 inline-block text-[1rem] font-extrabold text-sky-500 underline underline-offset-2"
            >
              github.com/kaamilmirza/kabootar-talk
            </a>
          </div>
        </details>
      </div>
    </section>
  );
}

function Where({ path, note }: { path: string; note: string }) {
  return (
    <div className="mb-5 border-l-2 border-line pl-4">
      <a
        href={`${REPO}/blob/main/${path}`}
        className="block font-mono text-[0.9rem] font-bold break-all text-sky-600 underline underline-offset-2"
      >
        {path}
      </a>
      <p className="mt-1 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">{note}</p>
    </div>
  );
}

function Snippet({ code, note }: { code: string; note: string }) {
  return (
    <div className="mb-6">
      <pre className="overflow-x-auto rounded-xl border-2 border-line bg-ink px-4 py-3.5 font-mono text-[0.8rem] leading-relaxed text-paper">
        <code>{code}</code>
      </pre>
      <p className="mt-2 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">{note}</p>
    </div>
  );
}

function Closing({ onBegin }: { onBegin?: () => void }) {
  return (
    <section className="relative overflow-hidden bg-sky-100 py-16">
      <div className="shell relative flex flex-col items-center text-center">
        <div className="glide mb-6">
          <Kabootar mood="flying" className="size-28" />
        </div>

        <h2 className="mb-4 max-w-[18rem] text-[1.8rem] leading-[1.15] font-extrabold text-ink">
          Some things are worth saying slowly.
        </h2>

        <p className="mb-8 max-w-[19rem] text-[1rem] leading-relaxed font-semibold text-ink-soft">
          Pick one person. Write them something real. Give it to a bird and let
          her take her time about it.
        </p>

        <div className="w-full max-w-xs">
          <StartButton onBegin={onBegin} />
        </div>

        <p className="mt-10 text-[0.8rem] font-semibold text-ink-faint">
          Free, open source, and built for two people.
        </p>
      </div>
    </section>
  );
}

// --- shared ------------------------------------------------------------------

/** A button in the app, a link on the standalone page. */
function StartButton({ onBegin }: { onBegin?: () => void }) {
  if (onBegin) {
    return (
      <Button full onClick={onBegin}>
        Start a coop
      </Button>
    );
  }

  return (
    <Link
      href="/"
      className="press inline-flex w-full items-center justify-center bg-grass-500 px-6 py-3.5 text-[1.0625rem] tracking-wide text-white uppercase shadow-[0_var(--lip)_0_var(--color-grass-600)]"
    >
      Start a coop
    </Link>
  );
}

function Section({
  children,
  tone = 'cream',
}: {
  children: ReactNode;
  tone?: 'cream' | 'paper' | 'sky';
}) {
  const skin = { cream: 'bg-cream', paper: 'bg-paper', sky: 'bg-sky-100' }[tone];

  return (
    <section className={`${skin} py-14`}>
      <div className="shell reveal">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[0.8rem] font-extrabold tracking-[0.18em] text-ink-faint uppercase">
      {children}
    </p>
  );
}

/**
 * Reveal sections as they come into view.
 *
 * One observer for the whole page, and each element is unobserved the moment
 * it has been shown — so there is no growing list of callbacks and nothing at
 * all runs once you have scrolled past.
 *
 * The ordering matters. Sections are visible until this hook adds
 * `reveal-ready`, which is what hides them; so if there is no JavaScript, no
 * IntersectionObserver, or the tab never gets a rendering opportunity, the
 * page simply renders in full rather than rendering blank. A fallback timer
 * covers the last case: an observer that has not reported anything after a
 * couple of seconds is not going to.
 */
function useReveal() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const root = document.documentElement;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    const showAll = () => targets.forEach((el) => el.classList.add('shown'));

    if (typeof IntersectionObserver === 'undefined') {
      showAll();
      return;
    }

    // Only now is it safe to hide anything.
    root.classList.add('reveal-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('shown');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    targets.forEach((el) => observer.observe(el));

    // Belt and braces: never leave the page blank because motion did not run.
    const rescue = setTimeout(showAll, 2500);

    return () => {
      clearTimeout(rescue);
      observer.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);
}
