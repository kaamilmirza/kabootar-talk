'use client';

/**
 * The last line of defence.
 *
 * Without this, one thrown error anywhere in the tree unmounts the whole app
 * and leaves a blank page — no message, no way back, and nothing to tell you
 * your letters are still perfectly safe. They are: everything lives in the
 * database and on this device, and a render fault touches neither.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';
import { Button, Panel, Screen, TextButton } from '@/components/ui/primitives';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('[kabootar] screen failed', error);
  }, [error]);

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <Kabootar mood="worried" className="size-28" animated />

        <div>
          <h1 className="mb-2 text-[1.6rem] font-extrabold text-ink">Something went wrong</h1>
          <p className="text-[0.95rem] leading-relaxed font-bold text-ink-faint">
            Your letters and your kabootars are fine — nothing here touches them.
            This screen just failed to draw.
          </p>
        </div>

        <Panel className="w-full">
          <p className="font-mono text-[0.8rem] leading-relaxed break-words text-ink-soft">
            {error.message || 'Unknown error'}
          </p>
        </Panel>

        <div className="flex w-full flex-col gap-2">
          <Button full onClick={reset}>
            Try again
          </Button>
          <TextButton onClick={() => router.push('/')}>Back to your coop</TextButton>
        </div>
      </div>
    </Screen>
  );
}
