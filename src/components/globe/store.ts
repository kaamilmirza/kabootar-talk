/**
 * State shared by the 3D scene and the controls drawn over it.
 *
 * Two kinds, kept apart on purpose:
 *
 *   - `GlobeStore` holds what a person chooses: which bird, which camera,
 *     which layers. It changes on a click, and React re-renders for it.
 *   - `RigReadout` holds what moves every frame: the camera's heading and
 *     height. The scene writes it, and the compass reads it in its own
 *     animation loop. Routing sixty updates a second through React would
 *     re-render the whole overlay for a needle turning.
 */

import { useSyncExternalStore } from 'react';

import type { Itinerary } from '@/lib/flight/schedule';

/** A pigeon to draw: one letter, on its way or recently landed. */
export interface GlobeFlight {
  id: string;
  itinerary: Itinerary;
  /** The bird's real name, when known. */
  name: string;
  /** True when this person sent it. */
  mine: boolean;
  fromLabel?: string;
  toLabel?: string;
  /** The person at the other end, for the picker. */
  partner?: string;
}

export type CameraMode = 'free' | 'follow' | 'ride';

export interface Layers {
  clouds: boolean;
  routes: boolean;
  labels: boolean;
  life: boolean;
}

export interface GlobeState {
  selectedId: string | null;
  hoveredId: string | null;
  mode: CameraMode;
  layers: Layers;
  /** Set by the overlay to ask the camera to do something once. */
  command:
    | { kind: 'zoom'; factor: number; at: number }
    | { kind: 'north'; at: number }
    | { kind: 'home'; at: number }
    | { kind: 'look'; lat: number; lon: number; at: number }
    | null;
}

export interface RigReadout {
  heading: number;
  altitude: number;
  tilt: number;
  /** True once the current press has moved far enough to be a drag, not a tap. */
  dragged: boolean;
}

/** Where each bird is this frame, written by the bird and read by the camera. */
export interface BirdTracker {
  position: import('three').Vector3;
  /** Unit vector along her direction of travel, tangent to the planet. */
  forward: import('three').Vector3;
  /** Height above the sea, in planet radii. */
  altitude: number;
  ready: boolean;
}

type Listener = () => void;

export class GlobeStore {
  private state: GlobeState;
  private listeners = new Set<Listener>();
  readonly readout: RigReadout = { heading: 0, altitude: 2, tilt: 0, dragged: false };
  readonly trackers = new Map<string, BirdTracker>();
  /**
   * The scene's clock, relative to the real one.
   *
   * `offsetMs` is added to real time to preview where a bird will be, and
   * `rate` is how many milliseconds of journey pass per real millisecond
   * while a time-lapse plays. Purely visual: nothing is sent anywhere and no
   * letter is affected. Mutable, because it changes every frame.
   */
  readonly clock = { offsetMs: 0, rate: 0 };

  constructor(initial: Partial<GlobeState> = {}) {
    this.state = {
      selectedId: null,
      hoveredId: null,
      mode: 'free',
      layers: { clouds: true, routes: true, labels: true, life: true },
      command: null,
      ...initial,
    };
  }

  get = (): GlobeState => this.state;

  /** Per-frame camera readout, written by the camera rig. */
  setReadout(patch: Partial<RigReadout>): void {
    Object.assign(this.readout, patch);
  }

  /** Move or run the scene's preview clock. */
  setClock(patch: Partial<{ offsetMs: number; rate: number }>): void {
    Object.assign(this.clock, patch);
  }

  /** Where a bird is this frame, written by the bird itself. */
  track(id: string, position: import('three').Vector3, forward: import('three').Vector3): void {
    let t = this.trackers.get(id);
    if (!t) {
      t = { position: position.clone(), forward: forward.clone(), altitude: 0, ready: false };
      this.trackers.set(id, t);
    }
    t.position.copy(position);
    t.forward.copy(forward);
    t.altitude = position.length() - 1;
    t.ready = true;
  }

  untrack(id: string): void {
    this.trackers.delete(id);
  }

  set = (patch: Partial<GlobeState> | ((s: GlobeState) => Partial<GlobeState>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as Array<keyof GlobeState>) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useGlobe<T>(store: GlobeStore, select: (s: GlobeState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

/** One colour per bird, so several flights can be told apart at a glance. */
export const FLIGHT_COLORS = ['#ffc800', '#ff4b4b', '#4fc3f7', '#6ee034', '#ce82ff', '#ff86d0', '#ff9600'];

export function flightColor(index: number): string {
  return FLIGHT_COLORS[index % FLIGHT_COLORS.length];
}

/** Low on phones and small machines: fewer trees, fewer clouds, coarser ground. */
export type Quality = 'high' | 'low';

export function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'low';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || cores <= 4 ? 'low' : 'high';
}
