'use client';

/**
 * A page's words, laid over the globe without covering it.
 *
 * A short summary is always shown; everything else sits behind a "Details"
 * toggle, so by default the globe gets the screen. On a phone it is a sheet
 * at the bottom; on a wide screen, a card at the top left.
 *
 * On a phone it publishes its height as `--sheet-h` on its parent, so the
 * globe's controls sit above it and the camera lifts the planet clear of it.
 * On a wide screen it stays clear of the centred control bar by never growing
 * down into the bottom of the screen.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function GlobeSheet({
  summary,
  details,
  detailsLabel = 'Details',
}: {
  summary: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const wide = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      const rect = el.getBoundingClientRect();
      parent.style.setProperty('--sheet-h', wide.matches ? '0px' : `${Math.round(rect.height)}px`);
    };

    const observer = new ResizeObserver(update);
    observer.observe(el);
    wide.addEventListener('change', update);
    update();

    return () => {
      observer.disconnect();
      wide.removeEventListener('change', update);
      parent.style.removeProperty('--sheet-h');
    };
  }, []);

  return (
    <div
      ref={root}
      data-globe-obstacle
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[60dvh] flex-col rounded-t-[1.75rem] border-t-2 border-line bg-cream lg:inset-x-auto lg:top-[4.5rem] lg:bottom-auto lg:left-4 lg:max-h-[calc(100dvh-15rem)] lg:w-[21rem] lg:rounded-[1.5rem] lg:border-2 lg:shadow-[0_4px_0_var(--color-line)]"
    >
      <div className="shrink-0 px-5 pt-4 pb-3">{summary}</div>

      {details ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mx-5 mb-3 flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-paper py-2 text-[0.8rem] font-extrabold tracking-[0.06em] text-sky-600 uppercase shadow-[0_2px_0_var(--color-line)]"
          >
            {open ? 'Hide' : detailsLabel}
            <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
          {open ? (
            <div className="min-h-0 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">{details}</div>
          ) : (
            <div className="pb-[env(safe-area-inset-bottom)]" />
          )}
        </>
      ) : null}
    </div>
  );
}
