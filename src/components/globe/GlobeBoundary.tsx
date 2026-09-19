'use client';

/**
 * Catches anything the 3D scene throws.
 *
 * WebGL fails for reasons that have nothing to do with this app: a driver
 * blocklist, a headless browser, a phone that has run out of GPU memory, a
 * lost context. None of that should cost someone their letter — the words are
 * the point and the globe is the decoration, so a failure here degrades to a
 * quiet message and leaves the rest of the screen working.
 *
 * It also records the error where a developer can find it, because a 3D scene
 * that silently renders nothing is otherwise genuinely hard to diagnose.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Kabootar } from '@/components/ui/Kabootar';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class GlobeBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[kabootar] the globe could not be drawn', error, info.componentStack);

    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__kabootarGlobeError = {
        message: error.message,
        stack: error.stack?.slice(0, 1200),
        componentStack: info.componentStack?.slice(0, 800),
      };
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Kabootar mood="worried" className="size-20" />
        <p className="text-[0.95rem] leading-relaxed font-bold text-ink-soft">
          The map would not load on this device.
          <br />
          Your letter is fine — it is still on its way.
        </p>
      </div>
    );
  }
}
