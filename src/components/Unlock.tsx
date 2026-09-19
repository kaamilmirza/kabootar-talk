'use client';

/**
 * Getting back in.
 *
 * A four-digit PIN wants to behave like a phone lock screen: you tap four
 * digits and it goes, with no separate button to reach for. So it submits
 * itself on the fourth digit, and the only visible control is the way out if
 * you have forgotten it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';
import { Button, Field, Notice, Panel, Screen, TextButton, relativeTime } from '@/components/ui/primitives';
import { useKabootar } from '@/lib/client/kabootar';
import { LockedOutError, PIN_LENGTH, lockedFor } from '@/lib/client/vault';

export function Unlock() {
  const { unlockMethod, unlockDevice, forgetDevice } = useKabootar();

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Held in state rather than read during render: reading the clock while
  // rendering makes the component impure, and the countdown needs a value that
  // changes on a tick anyway.
  const [clock, setClock] = useState(() => Date.now());

  const isPin = unlockMethod === 'pin';

  // A lockout left over from a previous session should be visible immediately.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const remaining = await lockedFor();
      if (!cancelled && remaining > 0) {
        setClock(Date.now());
        setLockedUntil(Date.now() + remaining);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, []);

  // Tick the lockout down so the screen unlocks itself when the wait is over.
  useEffect(() => {
    if (!lockedUntil) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= lockedUntil) setLockedUntil(null);
    }, 1000);

    return () => clearInterval(timer);
  }, [lockedUntil]);

  const attempt = useCallback(
    async (value?: string) => {
      setError(null);
      setBusy(true);
      try {
        await unlockDevice(isPin ? (value ?? pin) : undefined);
      } catch (e) {
        if (e instanceof LockedOutError) {
          setClock(Date.now());
          setLockedUntil(e.until);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : 'Could not unlock.');
        }
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [isPin, pin, unlockDevice],
  );

  // Submit on the last digit, the way a lock screen does.
  const submitted = useRef(false);
  useEffect(() => {
    if (!isPin || pin.length !== PIN_LENGTH || busy || lockedUntil) return;
    if (submitted.current) return;

    submitted.current = true;
    void attempt(pin).finally(() => {
      submitted.current = false;
    });
  }, [attempt, busy, isPin, lockedUntil, pin]);

  const locked = lockedUntil !== null && lockedUntil > clock;

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center py-8">
        <div className="mb-6 flex justify-center">
          <Kabootar mood={busy ? 'flying' : locked ? 'worried' : 'happy'} className="size-32" animated />
        </div>

        <h1 className="text-center text-[1.9rem] font-extrabold tracking-tight text-ink">
          Welcome back
        </h1>
        <p className="mt-2 mb-7 text-center text-[1rem] font-bold text-ink-faint">
          {locked
            ? 'Too many tries.'
            : isPin
              ? `Enter your ${PIN_LENGTH} digits.`
              : 'Unlock with your face or fingerprint.'}
        </p>

        {locked ? (
          <Notice tone="coral">
            Guessing is paused for {relativeTime(lockedUntil! - clock)}. If you
            have forgotten your PIN, your twelve words will always let you back
            in.
          </Notice>
        ) : (
          <>
            {isPin ? (
              <Panel className="mb-4">
                <Field
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                  inputMode="numeric"
                  maxLength={PIN_LENGTH}
                  autoFocus
                  disabled={busy}
                  autoComplete="current-password"
                  placeholder={'•'.repeat(PIN_LENGTH)}
                  className="text-center text-[2rem] tracking-[0.7em]"
                />
              </Panel>
            ) : (
              <Button full busy={busy} onClick={() => void attempt()}>
                Unlock
              </Button>
            )}

            {busy && isPin ? (
              <p className="pulse-soft mt-4 text-center text-[0.9rem] font-bold text-ink-faint">
                Working through the key stretching&hellip;
              </p>
            ) : null}

            {error ? (
              <div className="mt-5">
                <Notice tone="coral">{error}</Notice>
              </div>
            ) : null}
          </>
        )}

        <div className="mt-10">
          {confirmingReset ? (
            <Panel tone="coral">
              <p className="mb-4 text-[0.95rem] leading-relaxed font-bold text-ink-soft">
                This removes your identity from this device. You will need your
                twelve words to get back in, and letters stored here will be
                gone.
              </p>
              <div className="flex gap-2">
                <Button tone="coral" className="flex-1" onClick={() => void forgetDevice()}>
                  Erase
                </Button>
                <TextButton onClick={() => setConfirmingReset(false)}>Cancel</TextButton>
              </div>
            </Panel>
          ) : (
            <div className="text-center">
              <TextButton onClick={() => setConfirmingReset(true)}>
                Use a different phrase
              </TextButton>
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}
