'use client';

/**
 * Home: your birds, your nests, and anyone waiting to be let in.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Pairing } from '@/components/Pairing';
import { SafetyWords } from '@/components/SafetyWords';
import { Kabootar } from '@/components/ui/Kabootar';
import { Button, Notice, Panel, Screen, TextButton } from '@/components/ui/primitives';
import { useKabootar, type Nest } from '@/lib/client/kabootar';

export function Coop() {
  const { nests, refresh, confirmNest, lock } = useKabootar();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const active = nests.filter((n) => n.status === 'active');
  const waiting = nests.filter((n) => n.awaitingYou);
  const sent = nests.filter((n) => n.status === 'pending' && !n.awaitingYou);

  const approve = async (nest: Nest) => {
    setBusyId(nest.id);
    try {
      await confirmNest(nest.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen>
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Kabootar className="size-12" />
          <h1 className="text-[1.6rem] leading-none font-extrabold tracking-tight text-ink">
            Your coop
          </h1>
        </div>
        <TextButton onClick={lock}>Lock</TextButton>
      </header>

      {waiting.length > 0 ? (
        <Section label="Waiting for you">
          {waiting.map((nest) => (
            <Panel key={nest.id} tone="amber">
              <p className="mb-1.5 text-[1.05rem] font-extrabold text-ink">
                Someone used your pairing code.
              </p>
              <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
                Check that these eight words are identical on both your screens
                before you approve. If they are not, someone is in the middle.
              </p>

              <SafetyWords nest={nest} />

              <div className="mt-4">
                <Button full busy={busyId === nest.id} onClick={() => void approve(nest)}>
                  The words match
                </Button>
              </div>
            </Panel>
          ))}
        </Section>
      ) : null}

      {active.length > 0 ? (
        <Section label="Nests">
          {active.map((nest, i) => (
            <Link
              key={nest.id}
              href={`/nest/${nest.id}`}
              className="press pop-in flex items-center gap-4 border-2 border-line bg-paper p-4 shadow-[0_var(--lip)_0_var(--color-line)]"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <Kabootar className="size-11 shrink-0" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[1.05rem] font-extrabold text-ink">Your nest</span>
                <span className="mt-0.5 block truncate text-[0.8rem] font-bold text-ink-faint">
                  {nest.partner.id.slice(0, 10)}&hellip;
                </span>
              </span>
              <span className="text-xl text-ink-faint">&rsaquo;</span>
            </Link>
          ))}
        </Section>
      ) : null}

      {sent.length > 0 ? (
        <Section label="Sent">
          <Notice tone="sky">
            Waiting for them to approve you. Nothing can be sent either way
            until they do.
          </Notice>
        </Section>
      ) : null}

      <section className="mt-7">
        {active.length === 0 && waiting.length === 0 && sent.length === 0 ? (
          <div className="mb-5 text-center">
            <p className="text-[1rem] leading-relaxed font-bold text-ink-soft">
              Nothing here yet.
              <br />
              Send someone a pairing code, or use theirs.
            </p>
          </div>
        ) : (
          <SectionLabel>Add someone</SectionLabel>
        )}
        <Pairing />
      </section>

      <div className="mt-7">
        <Link
          href="/world"
          className="press flex items-center gap-3 border-2 border-sky-400 bg-sky-100 p-4 shadow-[0_var(--lip)_0_var(--color-sky-400)]"
        >
          <span className="text-2xl">🌍</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[1rem] font-extrabold text-ink">Kabootars of the world</span>
            <span className="block text-[0.8rem] font-bold text-sky-600">
              Where else letters are flying from
            </span>
          </span>
          <span className="text-xl text-sky-600">&rsaquo;</span>
        </Link>
      </div>

      <footer className="mt-auto pt-10 text-center text-[0.8rem] leading-relaxed font-semibold text-ink-faint">
        End-to-end encrypted. The server stores ciphertext and a delivery time,
        and nothing else.
        <Link href="/about" className="mt-2 block text-sky-500 underline underline-offset-2">
          How it all works
        </Link>
      </footer>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
      {children}
    </h2>
  );
}
