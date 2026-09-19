'use client';

/**
 * Stands in front of any screen that needs an unlocked vault.
 *
 * Without this, opening a nest link directly — from a bookmark, a reload, or
 * the back button after the app has been closed — left you on a spinner that
 * never resolved, because only the home screen knew how to ask for your PIN.
 * Anything behind a lock has to be able to offer the lock.
 */

import { useState, type ReactNode } from 'react';

import { Landing } from '@/components/landing/Landing';
import { Onboarding } from '@/components/Onboarding';
import { Unlock } from '@/components/Unlock';
import { Kabootar } from '@/components/ui/Kabootar';
import { Screen } from '@/components/ui/primitives';
import { useKabootar } from '@/lib/client/kabootar';

export function Guard({ children }: { children: ReactNode }) {
  const { status } = useKabootar();

  // Somebody arriving for the first time gets the explanation, not a wizard.
  const [entry, setEntry] = useState<'landing' | 'phrase' | 'restore'>('landing');

  if (status === 'loading') {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center">
          <Kabootar className="size-24 opacity-70" animated />
        </div>
      </Screen>
    );
  }

  if (status === 'needs-setup') {
    if (entry === 'landing') {
      return (
        <Landing onBegin={() => setEntry('phrase')} onRestore={() => setEntry('restore')} />
      );
    }
    return <Onboarding start={entry} />;
  }
  if (status === 'locked') return <Unlock />;

  return <>{children}</>;
}
