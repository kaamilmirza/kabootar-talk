'use client';

/**
 * Pairing, both halves of it.
 *
 * Giving out a code and using someone's code are the only two ways a nest can
 * come into existence, and the person who issued the code still has to approve
 * whoever turned up. Three deliberate acts between two people, which is why
 * nobody can ever write to you unasked.
 */

import { useState } from 'react';

import { Button, Notice, Panel, TextArea, TextButton } from '@/components/ui/primitives';
import { useKabootar } from '@/lib/client/kabootar';
import { isValidInviteCode } from '@/lib/crypto/invite';

type Mode = 'idle' | 'inviting' | 'redeeming';

export function Pairing() {
  const { createInvite, redeemInvite } = useKabootar();

  const [mode, setMode] = useState<Mode>('idle');
  const [code, setCode] = useState('');
  const [entered, setEntered] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    setError(null);
    setBusy(true);
    setMode('inviting');
    try {
      setCode(await createInvite());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a code.');
      setMode('idle');
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    setError(null);
    setBusy(true);
    try {
      await redeemInvite(entered);
      setEntered('');
      setMode('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the words and copy them by hand.');
    }
  };

  if (mode === 'inviting') {
    return (
      <Panel tone="sky">
        <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">Give them these six words</h2>
        <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
          Works once, expires in a day, and never reaches our server — only a
          slow hash of it does.
        </p>

        {busy ? (
          <p className="pulse-soft py-6 text-center text-[0.95rem] font-bold text-ink-faint">
            Making a code&hellip;
          </p>
        ) : (
          <>
            <div className="pop-in mb-4 rounded-2xl border-2 border-sky-400 bg-paper px-4 py-4 text-center text-[1.1rem] leading-relaxed font-extrabold text-sky-600 select-all">
              {code}
            </div>

            <div className="flex gap-2">
              <Button tone="sky" className="flex-1" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <TextButton onClick={() => setMode('idle')}>Done</TextButton>
            </div>

            <p className="mt-4 text-[0.85rem] leading-relaxed font-semibold text-ink-faint">
              When they use it, you will be asked to approve them before
              anything can be sent either way.
            </p>
          </>
        )}
      </Panel>
    );
  }

  if (mode === 'redeeming') {
    const valid = isValidInviteCode(entered);

    return (
      <Panel>
        <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">Enter their six words</h2>
        <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
          They will need to approve you before either of you can write.
        </p>

        <TextArea
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          rows={2}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="six words"
          className="mb-4"
        />

        <div className="flex gap-2">
          <Button className="flex-1" disabled={!valid} busy={busy} onClick={() => void redeem()}>
            Pair
          </Button>
          <TextButton onClick={() => setMode('idle')}>Cancel</TextButton>
        </div>

        {busy ? (
          <p className="pulse-soft mt-4 text-center text-[0.85rem] font-bold text-ink-faint">
            Hashing the code&hellip;
          </p>
        ) : null}

        {error ? (
          <div className="mt-4">
            <Notice tone="coral">{error}</Notice>
          </div>
        ) : null}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button tone="sky" full onClick={() => void invite()}>
        Invite someone
      </Button>
      <TextButton onClick={() => setMode('redeeming')}>I have a pairing code</TextButton>
      {error ? <Notice tone="coral">{error}</Notice> : null}
    </div>
  );
}
