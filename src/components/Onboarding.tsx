'use client';

/**
 * First run.
 *
 * The one genuinely important screen in the app, because it is where someone
 * learns that twelve words are the whole account and that nobody can send them
 * back. It is deliberately slower than the rest: a confirm step, and no way
 * past it without acknowledging what the words are for.
 */

import { useEffect, useMemo, useState } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';
import {
  Button,
  Field,
  Label,
  Notice,
  Panel,
  Screen,
  TextArea,
  TextButton,
  Title,
} from '@/components/ui/primitives';
import { useKabootar } from '@/lib/client/kabootar';
import { isValidRecoveryPhrase, normalizePhrase } from '@/lib/crypto/identity';
import {
  PIN_LENGTH,
  PrfUnsupportedError,
  platformAuthenticatorAvailable,
} from '@/lib/client/vault';

type Step = 'welcome' | 'phrase' | 'confirm' | 'lock' | 'restore';

export function Onboarding({ start = 'welcome' }: { start?: 'welcome' | 'phrase' | 'restore' }) {
  const { createPhrase, finishSetup, restoreFromPhrase } = useKabootar();

  // The landing page sends people straight to the step they asked for, so
  // "Start a coop" does not land on a second welcome screen.
  const [step, setStep] = useState<Step>(() => (start === 'phrase' ? 'phrase' : start));

  // Generated in the initialiser, not an effect: arriving from the landing
  // page on the words step should show twelve words on the first paint, with
  // no flash of an empty list and no second render to get there.
  const [phrase, setPhrase] = useState(() => (start === 'phrase' ? createPhrase() : ''));
  const [typed, setTyped] = useState('');
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(start === 'restore');
  const [passkeyRefused, setPasskeyRefused] = useState(false);

  const words = useMemo(() => (phrase ? phrase.split(' ') : []), [phrase]);
  // Asked of the device rather than assumed: offering "use a passkey" on a
  // machine with no fingerprint reader or Windows Hello is a button that can
  // only disappoint.
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void platformAuthenticatorAvailable().then((available) => {
      if (!cancelled) setCanUsePasskey(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Three of the twelve back, not all of them. Enough to prove they were
  // written down; not so much that people give up and screenshot instead.
  const checks = [2, 6, 10];

  const answers = normalizePhrase(typed).split(' ').filter(Boolean);
  const confirmed =
    answers.length === checks.length &&
    checks.every((wordIndex, slot) => answers[slot] === words[wordIndex]);

  const complete = async (method: 'passkey' | 'pin') => {
    setError(null);
    setBusy(true);
    try {
      if (restoring) await restoreFromPhrase(phrase, { method, pin });
      else await finishSetup(phrase, { method, pin });
    } catch (e) {
      // A device that cannot derive keys from a passkey is not a failure the
      // person can do anything about, so say so plainly and point at the PIN
      // rather than leaving them staring at a dead button.
      if (e instanceof PrfUnsupportedError) {
        setPasskeyRefused(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'welcome') {
    return (
      <Screen>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="pop-in mb-6 flex justify-center">
            <Kabootar className="size-40" animated />
          </div>

          <h1 className="text-center text-[2.6rem] leading-[1] font-extrabold tracking-tight text-ink">
            Kabootar
            <span className="block text-grass-500">Talk</span>
          </h1>

          <p className="mx-auto mt-5 max-w-[19rem] text-center text-[1.05rem] leading-relaxed font-bold text-ink-soft">
            One letter a day, carried by a pigeon that actually has to fly
            there.
          </p>

          <p className="mx-auto mt-3 max-w-[19rem] text-center text-[0.95rem] leading-relaxed font-semibold text-ink-faint">
            Toronto to Hyderabad takes about a day. Nobody can read it but the
            two of you.
          </p>

          <div className="mt-10 flex flex-col gap-3">
            <Button
              full
              onClick={() => {
                setRestoring(false);
                setPhrase(createPhrase());
                setStep('phrase');
              }}
            >
              Get started
            </Button>
            <TextButton
              onClick={() => {
                setRestoring(true);
                setPhrase('');
                setStep('restore');
              }}
            >
              I have a recovery phrase
            </TextButton>
          </div>
        </div>
      </Screen>
    );
  }

  if (step === 'phrase') {
    return (
      <Screen>
        <Title sub="These twelve words are your account. No email, no password, and no way for anyone to send them back to you if they are lost.">
          Write these down
        </Title>

        <Panel className="mb-4">
          <ol className="grid grid-cols-2 gap-x-3 gap-y-2">
            {words.map((word, i) => (
              <li
                key={word + i}
                className="pop-in flex items-baseline gap-2 rounded-xl bg-mist px-3 py-2"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <span className="w-4 shrink-0 text-right text-[0.7rem] font-extrabold text-ink-faint">
                  {i + 1}
                </span>
                <span className="text-[0.95rem] font-extrabold text-ink">{word}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Notice tone="amber">
          On paper, not in a screenshot. A photo of these words is a photo of
          your account.
        </Notice>

        <div className="mt-6">
          <Button full onClick={() => setStep('confirm')}>
            I wrote them down
          </Button>
        </div>
      </Screen>
    );
  }

  if (step === 'confirm') {
    return (
      <Screen>
        <Title sub="Just checking they really made it onto paper.">
          Type words {checks.map((i) => i + 1).join(', ')}
        </Title>

        <Panel>
          <Label>Three words, in order</Label>
          <Field
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="word word word"
          />
        </Panel>

        <div className="mt-6 flex flex-col gap-2">
          <Button full disabled={!confirmed} onClick={() => setStep('lock')}>
            Continue
          </Button>
          <TextButton onClick={() => setStep('phrase')}>Show the words again</TextButton>
        </div>
      </Screen>
    );
  }

  if (step === 'restore') {
    const valid = isValidRecoveryPhrase(phrase);

    return (
      <Screen>
        <Title sub="Your nests come back. Letters you had already opened stayed on your old device — that is the cost of them being unreadable to everyone else.">
          Restore your coop
        </Title>

        <Panel>
          <Label>Your twelve words</Label>
          <TextArea
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            rows={4}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="twelve words, separated by spaces"
          />
          {phrase && !valid ? (
            <p className="mt-3 text-[0.9rem] font-bold text-coral-600">
              That is not a valid recovery phrase — check for typos.
            </p>
          ) : null}
        </Panel>

        <div className="mt-6 flex flex-col gap-2">
          <Button full disabled={!valid} onClick={() => setStep('lock')}>
            Continue
          </Button>
          <TextButton onClick={() => setStep('welcome')}>Back</TextButton>
        </div>
      </Screen>
    );
  }

  const pinOk = pin.length === PIN_LENGTH && pin === pinAgain;

  return (
    <Screen>
      <Title sub="Your phrase is encrypted on this device. This is how you open the app each day — you will not type the twelve words again unless you change phone.">
        Lock this device
      </Title>

      {canUsePasskey && !passkeyRefused ? (
        <Panel tone="grass" className="mb-4">
          <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">Face ID or fingerprint</h2>
          <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
            Your phone&rsquo;s secure chip holds the key. It cannot be copied
            off the device, even by someone holding it.
          </p>
          <Button full busy={busy} onClick={() => void complete('passkey')}>
            Use a passkey
          </Button>
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-1.5 text-[1.1rem] font-extrabold text-ink">
          {canUsePasskey && !passkeyRefused ? 'Or use a PIN' : 'Choose a PIN'}
        </h2>
        <p className="mb-4 text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
          {PIN_LENGTH} digits. Stretched with Argon2id so it is slow to guess,
          and the app stops accepting tries after a handful of wrong ones.
        </p>

        <div className="flex flex-col gap-3">
          <Field
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            autoComplete="new-password"
            placeholder={'•'.repeat(PIN_LENGTH)}
            className="text-center text-[1.6rem] tracking-[0.6em]"
          />
          <Field
            value={pinAgain}
            onChange={(e) => setPinAgain(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            autoComplete="new-password"
            placeholder="Again"
            className="text-center text-[1.6rem] tracking-[0.6em]"
          />
          {pin.length === PIN_LENGTH && pinAgain.length === PIN_LENGTH && pin !== pinAgain ? (
            <p className="text-[0.9rem] font-bold text-coral-600">Those do not match.</p>
          ) : null}
          <Button
            full
            tone={canUsePasskey && !passkeyRefused ? 'plain' : 'grass'}
            disabled={!pinOk}
            busy={busy}
            onClick={() => void complete('pin')}
          >
            Lock with a PIN
          </Button>
        </div>
      </Panel>

      {error ? (
        <div className="mt-5">
          <Notice tone="coral">{error}</Notice>
        </div>
      ) : null}

      {busy ? (
        <p className="pulse-soft mt-5 text-center text-[0.9rem] font-bold text-ink-faint">
          Building your keys. This takes a moment on purpose.
        </p>
      ) : null}
    </Screen>
  );
}
