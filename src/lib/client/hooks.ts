'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { clockCheck, now, onClockChange } from './api';

/**
 * Server-corrected time, ticking.
 *
 * Screens use this instead of Date.now() so a wrong device clock changes
 * nothing about where the pigeon appears to be.
 */
export function useNow(intervalMs = 1000): number {
  const [value, setValue] = useState(() => now());

  useEffect(() => {
    // The initial value already came from `now()` in the initialiser, so there
    // is nothing to set synchronously here — only a timer to start.
    const timer = setInterval(() => setValue(now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return value;
}

/** Whether this device's clock disagrees with the server's, and by how much. */
export function useClockCheck() {
  return useSyncExternalStore(onClockChange, clockCheck, () => null);
}
