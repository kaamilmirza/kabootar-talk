'use client';

/**
 * The controls drawn over the globe, kept to two quiet places.
 *
 *   - Top right: compass, zoom, and one "layers" menu.
 *   - Bottom: a single bar with the bird, her timeline and the camera.
 *
 * Nothing else floats. Every panel is marked as an obstacle, and the label
 * manager below keeps the globe's name tags out from under them and off each
 * other, so nothing on screen ever sits on top of something else.
 *
 * Keyboard (listed under "Controls and shortcuts" in the layers menu):
 *   1 2 3   explore, follow, ride along      [ ]   previous / next bird
 *   space   play or pause the time-lapse      L     back to live
 *   + - arrows Q E   zoom, pan, turn          Esc   stop following
 *
 * The time-lapse only moves the scene's clock. Nothing is sent and no letter
 * changes; the timeline says "preview" whenever the globe is not showing now.
 */

import { useEffect, useRef, useState } from 'react';

import { relativeTime } from '@/components/ui/primitives';
import { positionAt } from '@/lib/flight/schedule';

import { flightColor, useGlobe, type CameraMode, type GlobeFlight, type GlobeStore, type Layers } from './store';

const TIP_KEY = 'kabootar.globe.hint';

const MODES: Array<{ mode: CameraMode; label: string; icon: string; key: string }> = [
  { mode: 'free', label: 'Explore', icon: '🌍', key: '1' },
  { mode: 'follow', label: 'Follow', icon: '🎯', key: '2' },
  { mode: 'ride', label: 'Ride', icon: '🪽', key: '3' },
];

const LAYERS: Array<{ key: keyof Layers; label: string; icon: string }> = [
  { key: 'routes', label: 'Routes and trails', icon: '〰️' },
  { key: 'labels', label: 'Name tags', icon: '🏷️' },
  { key: 'clouds', label: 'Clouds', icon: '☁️' },
  { key: 'life', label: 'Trees and towns', icon: '🌲' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Drag', 'Spin the planet'],
  ['Scroll / pinch', 'Zoom towards the cursor'],
  ['Right-drag / two fingers', 'Turn and tilt'],
  ['Double-click', 'Fly to that spot'],
  ['Tap a pigeon', 'Follow her; tap again to ride along'],
  ['1  2  3', 'Explore, follow, ride'],
  ['[  ]', 'Previous and next pigeon'],
  ['Space', 'Play the journey as a time-lapse'],
  ['L', 'Back to live'],
  ['Esc', 'Stop following'],
];

const button =
  'rounded-2xl border-2 border-line bg-paper font-extrabold text-ink-soft shadow-[0_3px_0_var(--color-line)] transition active:translate-y-[2px] active:shadow-none';

/** A journey played back in about forty seconds, however long it really takes. */
function playRateFor(flight: GlobeFlight): number {
  return Math.max(60, flight.itinerary.durationMs / 40_000);
}

export function GlobeHud({ store, flights, getNow }: { store: GlobeStore; flights: GlobeFlight[]; getNow: () => number }) {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const mode = useGlobe(store, (s) => s.mode);
  const selectedId = useGlobe(store, (s) => s.selectedId);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);

  const selected = flights.find((f) => f.id === selectedId) ?? null;

  useLabelManager(root);

  // Publish the bottom bar's height, so the camera centres the planet above it.
  useEffect(() => {
    const host = root.current?.parentElement;
    const el = bar.current;
    if (!host) return;
    if (!el) {
      host.style.setProperty('--hud-b', '0px');
      return;
    }
    const update = () => host.style.setProperty('--hud-b', `${Math.round(el.getBoundingClientRect().height + 12)}px`);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [flights.length]);

  const setMode = (next: CameraMode) => {
    if (next !== 'free' && !store.get().selectedId && flights[0]) store.set({ selectedId: flights[0].id, mode: next });
    else store.set({ mode: next });
  };

  const cycle = (step: number) => {
    if (!flights.length) return;
    const s = store.get();
    const index = flights.findIndex((f) => f.id === s.selectedId);
    const next = flights[(index + step + flights.length) % flights.length];
    store.set({ selectedId: next.id, mode: s.mode === 'free' ? 'follow' : s.mode });
  };

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case '1':
          store.set({ mode: 'free' });
          break;
        case '2':
        case '3':
          if (!flights.length) return;
          store.set({ selectedId: store.get().selectedId ?? flights[0].id, mode: e.key === '2' ? 'follow' : 'ride' });
          break;
        case ']':
          cycle(1);
          break;
        case '[':
          cycle(-1);
          break;
        case ' ':
          if (!flights.length) return;
          store.setClock({ rate: store.clock.rate ? 0 : playRateFor(selected ?? flights[0]) });
          break;
        case 'l':
        case 'L':
          store.setClock({ offsetMs: 0, rate: 0 });
          break;
        case 'Escape':
          store.set({ mode: 'free' });
          setMenu(false);
          setHelp(false);
          break;
        case '?':
          setHelp((h) => !h);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* --- top right: view tools ------------------------------------------ */}
      <div
        data-globe-obstacle
        className="pointer-events-auto absolute top-[max(1rem,env(safe-area-inset-top))] right-3 flex flex-col items-end gap-2"
      >
        <Compass store={store} />
        <button aria-label="Zoom in" className={`${button} size-11 text-xl`} onClick={() => store.set({ command: { kind: 'zoom', factor: 0.6, at: performance.now() } })}>
          +
        </button>
        <button aria-label="Zoom out" className={`${button} size-11 text-xl`} onClick={() => store.set({ command: { kind: 'zoom', factor: 1.6, at: performance.now() } })}>
          &minus;
        </button>
        <div className="relative">
          <button
            aria-label="Layers and shortcuts"
            aria-expanded={menu}
            className={`${button} size-11 text-lg ${menu ? 'border-sky-400' : ''}`}
            onClick={() => setMenu((m) => !m)}
          >
            ☰
          </button>
          {menu ? (
            <LayersMenu
              store={store}
              onHome={() => {
                store.set({ command: { kind: 'home', at: performance.now() } });
                setMenu(false);
              }}
              onHelp={() => {
                setHelp(true);
                setMenu(false);
              }}
            />
          ) : null}
        </div>
      </div>

      {/* --- bottom: one bar ------------------------------------------------- */}
      {flights.length > 0 ? (
        <div
          className="pointer-events-none absolute inset-x-3 flex justify-center"
          style={{ bottom: 'calc(var(--sheet-h, 0px) + max(0.75rem, env(safe-area-inset-bottom)))' }}
        >
          <div
            ref={bar}
            data-globe-obstacle
            className="pointer-events-auto flex w-full max-w-[38rem] flex-col gap-2 rounded-[1.4rem] border-2 border-line bg-paper p-2 shadow-[0_3px_0_var(--color-line)]"
          >
            <Tip />
            <div className="flex flex-wrap items-center gap-2">
              <BirdSwitcher store={store} flights={flights} selected={selected} onCycle={cycle} />
              <div className="ml-auto flex gap-1 rounded-2xl bg-mist p-1" role="group" aria-label="Camera">
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    onClick={() => setMode(m.mode)}
                    aria-pressed={mode === m.mode}
                    aria-label={`${m.label} (${m.key})`}
                    title={`${m.label} (${m.key})`}
                    className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[0.78rem] font-extrabold uppercase transition ${
                      mode === m.mode ? 'bg-sky-500 text-white shadow-[0_2px_0_var(--color-sky-600)]' : 'text-ink-soft hover:bg-paper'
                    }`}
                  >
                    <span aria-hidden>{m.icon}</span>
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {selected ? <Timeline store={store} flight={selected} getNow={getNow} /> : null}
          </div>
        </div>
      ) : null}

      {/* --- shortcuts ------------------------------------------------------- */}
      {help ? (
        <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-[rgba(7,10,34,0.55)] p-4" onClick={() => setHelp(false)}>
          <div
            className="w-full max-w-sm rounded-3xl border-2 border-line bg-paper p-5 shadow-[0_5px_0_var(--color-line)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Getting around"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[1.1rem] font-extrabold text-ink">Getting around</h2>
              <button aria-label="Close" onClick={() => setHelp(false)} className="text-xl text-ink-faint">
                ×
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.85rem] font-bold text-ink-soft">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-extrabold whitespace-nowrap text-ink">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- pieces -------------------------------------------------------------------

function LayersMenu({ store, onHome, onHelp }: { store: GlobeStore; onHome: () => void; onHelp: () => void }) {
  const layers = useGlobe(store, (s) => s.layers);
  return (
    <div
      data-globe-obstacle
      className="absolute top-0 right-[3.25rem] w-56 rounded-2xl border-2 border-line bg-paper p-2 shadow-[0_4px_0_var(--color-line)]"
    >
      <p className="px-2 pt-1 pb-1.5 text-[0.7rem] font-extrabold tracking-[0.08em] text-ink-faint uppercase">Show on the globe</p>
      {LAYERS.map((layer) => (
        <label key={layer.key} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-[0.88rem] font-bold text-ink-soft hover:bg-mist">
          <span aria-hidden className="w-5 text-center">
            {layer.icon}
          </span>
          <span className="flex-1">{layer.label}</span>
          <input
            type="checkbox"
            checked={layers[layer.key]}
            onChange={() => store.set({ layers: { ...layers, [layer.key]: !layers[layer.key] } })}
            className="size-4 accent-sky-500"
          />
        </label>
      ))}
      <div className="my-1.5 h-0.5 rounded bg-line" />
      <button onClick={onHome} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[0.88rem] font-bold text-ink-soft hover:bg-mist">
        <span aria-hidden className="w-5 text-center">
          ⌂
        </span>
        Whole planet
      </button>
      <button onClick={onHelp} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[0.88rem] font-bold text-ink-soft hover:bg-mist">
        <span aria-hidden className="w-5 text-center">
          ⌨
        </span>
        Controls and shortcuts
      </button>
    </div>
  );
}

/** Which bird: one name with arrows either side, and a list behind it. */
function BirdSwitcher({
  store,
  flights,
  selected,
  onCycle,
}: {
  store: GlobeStore;
  flights: GlobeFlight[];
  selected: GlobeFlight | null;
  onCycle: (step: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const index = selected ? flights.indexOf(selected) : -1;
  const many = flights.length > 1;

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      {many ? (
        <button aria-label="Previous pigeon" onClick={() => onCycle(-1)} className="grid size-8 shrink-0 place-items-center rounded-xl text-lg text-ink-faint hover:bg-mist">
          ‹
        </button>
      ) : null}
      <button
        onClick={() => many && setOpen((o) => !o)}
        aria-expanded={many ? open : undefined}
        className={`flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left ${many ? 'hover:bg-mist' : 'cursor-default'}`}
      >
        <span className="size-3 shrink-0 rounded-full border-2 border-ink/15" style={{ background: index >= 0 ? flightColor(index) : '#d4d4d4' }} />
        <span className="min-w-0">
          <span className="block truncate text-[0.9rem] leading-tight font-extrabold text-ink">{selected ? selected.name : 'All pigeons'}</span>
          <span className="block truncate text-[0.72rem] leading-tight font-bold text-ink-faint">
            {selected ? `${selected.fromLabel ?? 'Home'} → ${selected.toLabel ?? 'away'}` : `${flights.length} in the sky`}
          </span>
        </span>
      </button>
      {many ? (
        <button aria-label="Next pigeon" onClick={() => onCycle(1)} className="grid size-8 shrink-0 place-items-center rounded-xl text-lg text-ink-faint hover:bg-mist">
          ›
        </button>
      ) : null}

      {open ? (
        <ul
          data-globe-obstacle
          className="absolute bottom-[calc(100%+0.75rem)] left-0 z-10 max-h-64 w-64 overflow-y-auto rounded-2xl border-2 border-line bg-paper p-1.5 shadow-[0_4px_0_var(--color-line)]"
        >
          {flights.map((f, i) => (
            <li key={f.id}>
              <button
                onClick={() => {
                  store.set({ selectedId: f.id, mode: store.get().mode === 'ride' ? 'ride' : 'follow' });
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-mist ${f.id === selected?.id ? 'bg-sky-100' : ''}`}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: flightColor(i) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem] font-extrabold text-ink">{f.name}</span>
                  <span className="block truncate text-[0.72rem] font-bold text-ink-faint">
                    {f.fromLabel ?? 'Home'} → {f.toLabel ?? 'away'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One line of help the first time, inside the bar, gone after a few seconds. */
function Tip() {
  const [show, setShow] = useState(false);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      // Private browsing; it will show again next time.
    }
  };

  useEffect(() => {
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(TIP_KEY));
    } catch {
      seen = false;
    }
    if (seen) return;

    const start = setTimeout(() => setShow(true), 0);
    const stop = setTimeout(dismiss, 9000);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-sky-100 px-3 py-1.5 text-[0.78rem] font-bold text-sky-600">
      <span className="flex-1">Drag to spin · scroll or pinch to zoom · tap a pigeon to follow her</span>
      <button aria-label="Dismiss" onClick={dismiss} className="text-base leading-none">
        ×
      </button>
    </div>
  );
}

/** The compass needle turns in its own animation loop, never through React. */
function Compass({ store }: { store: GlobeStore }) {
  const needle = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (needle.current) needle.current.style.transform = `rotate(${(-store.readout.heading * 180) / Math.PI}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [store]);

  return (
    <button
      aria-label="Point north"
      title="North up"
      onClick={() => store.set({ command: { kind: 'north', at: performance.now() } })}
      className={`${button} relative grid size-11 place-items-center rounded-full`}
    >
      <span ref={needle} className="relative block h-7 w-2">
        <span className="absolute inset-x-0 top-0 h-1/2 bg-coral-500" style={{ clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} />
        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-slate-400" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
      </span>
    </button>
  );
}

/**
 * Scrub through the selected bird's journey, or play it as a time-lapse.
 *
 * Refreshes a few times a second rather than every frame: the slider does
 * not need sixty updates, and React re-rendering at frame rate would cost
 * more than the whole globe.
 */
function Timeline({ store, flight, getNow }: { store: GlobeStore; flight: GlobeFlight; getNow: () => number }) {
  const [, force] = useState(0);
  const { itinerary } = flight;

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const real = getNow();
  const sceneTime = real + store.clock.offsetMs;
  const live = Math.abs(store.clock.offsetMs) < 1000 && store.clock.rate === 0;
  const playing = store.clock.rate !== 0;
  const span = Math.max(1, itinerary.arrivesAt - itinerary.departedAt);
  const fraction = Math.min(1, Math.max(0, (sceneTime - itinerary.departedAt) / span));
  const status = positionAt(itinerary, sceneTime);

  const label = live
    ? status.phase === 'arrived'
      ? 'Landed'
      : `Arrives in ${relativeTime(status.msRemaining)}`
    : sceneTime > real
      ? `Preview · ${relativeTime(sceneTime - real)} ahead`
      : `Replay · ${relativeTime(real - sceneTime)} ago`;

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-mist px-2 py-1.5">
      <button
        aria-label={playing ? 'Pause the time-lapse' : 'Play the journey as a time-lapse'}
        onClick={() => {
          if (playing) {
            store.setClock({ rate: 0 });
          } else {
            // From the start again if she has already landed.
            if (sceneTime >= itinerary.arrivesAt) store.setClock({ offsetMs: itinerary.departedAt - getNow() });
            store.setClock({ rate: playRateFor(flight) });
          }
          force((n) => n + 1);
        }}
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-[0.8rem] text-white shadow-[0_2px_0_var(--color-amber-600)]"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          onChange={(e) =>
            store.setClock({ rate: 0, offsetMs: itinerary.departedAt + (Number(e.target.value) / 1000) * span - getNow() })
          }
          aria-label="Scrub through the journey"
          className="block h-2 w-full accent-amber-500"
        />
        <div className="mt-1 flex justify-between gap-2 text-[0.68rem] font-extrabold text-ink-faint uppercase">
          <span className="truncate">{label}</span>
          <span className="shrink-0">{Math.round(fraction * 100)}%</span>
        </div>
      </div>
      <button
        onClick={() => {
          store.setClock({ offsetMs: 0, rate: 0 });
          force((n) => n + 1);
        }}
        disabled={live}
        className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[0.68rem] font-extrabold uppercase ${
          live ? 'bg-coral-100 text-coral-600' : 'bg-sky-100 text-sky-600'
        }`}
      >
        {live ? <span className="size-1.5 animate-pulse rounded-full bg-coral-500" /> : null}
        Live
      </button>
    </div>
  );
}

// --- labels -------------------------------------------------------------------

/**
 * Keeps the globe's name tags readable: never on top of each other, and
 * never under a panel.
 *
 * Each tag says whether it would like to be seen (`data-want`) and how much
 * it matters (`data-priority`). A few times a second, the most important
 * tags are placed first, and anything that would overlap one already placed,
 * or any panel, is hidden until there is room for it again.
 */
function useLabelManager(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const pad = 6;

    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right + pad && a.right + pad > b.left && a.top < b.bottom + pad && a.bottom + pad > b.top;

    // On a timer rather than per frame, so it behaves the same however fast
    // the globe is drawing, and costs nothing between checks.
    const id = setInterval(() => {
      const host = root.current?.parentElement;
      if (!host) return;

      const obstacles = [...document.querySelectorAll<HTMLElement>('[data-globe-obstacle]')].map((el) => el.getBoundingClientRect());
      const tags = [...host.querySelectorAll<HTMLElement>('.globe-tag')];
      tags.sort((a, b) => Number(b.dataset.priority ?? 0) - Number(a.dataset.priority ?? 0));

      const placed: DOMRect[] = [];
      for (const tag of tags) {
        let show = tag.dataset.want === '1';
        if (show) {
          const rect = tag.getBoundingClientRect();
          if (obstacles.some((o) => overlaps(rect, o)) || placed.some((p) => overlaps(rect, p))) show = false;
          else placed.push(rect);
        }
        const value = show ? 'true' : 'false';
        if (tag.dataset.shown !== value) tag.dataset.shown = value;
      }
    }, 140);

    return () => clearInterval(id);
  }, [root]);
}
