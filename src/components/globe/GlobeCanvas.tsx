'use client';

/**
 * The globe as a whole: canvas, scene and the controls over it.
 *
 * Split out so it loads on demand. three.js is by far the largest thing this
 * app ships and none of it is needed to read a letter, so it stays behind a
 * dynamic import. The coop and the letter screens open instantly; the globe
 * pays for itself only when someone actually goes to watch a pigeon.
 *
 * It fills whatever box it is given. The pages give it the whole screen.
 */

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';

import { interpolate } from '@/lib/flight/geo';
import { positionAt } from '@/lib/flight/schedule';

import type { Beacon } from './Beacons';
import type { RigHome } from './CameraRig';
import { GlobeScene } from './Globe';
import { GlobeHud } from './Hud';
import { routeAngle, subsolarPoint } from './math';
import { detectQuality, GlobeStore, type CameraMode, type GlobeFlight } from './store';

export type { GlobeFlight } from './store';

export interface GlobeExperienceProps {
  flights: GlobeFlight[];
  /** The bird to start on, followed. */
  focusId?: string | null;
  /** Server-corrected time. Called every frame, so it must be cheap. */
  getNow: () => number;
  beacons?: Beacon[];
  /** Turn slowly on its own when nobody is touching it. */
  autoRotate?: boolean;
}

/** Where the camera starts: on the bird if there is one, on daylight if not. */
function homeFor(flights: GlobeFlight[], focusId: string | null | undefined, now: number): RigHome {
  const focus = flights.find((f) => f.id === focusId) ?? null;

  if (focus) {
    const { itinerary } = focus;
    const p = positionAt(itinerary, now).position;
    const angle = routeAngle(itinerary.from, itinerary.to);
    return { lat: p.lat, lon: p.lon, alt: Math.min(2.6, Math.max(0.7, 0.45 + angle * 0.014)) };
  }

  if (flights.length > 0) {
    // Somewhere in the middle of everything that is flying.
    const mid = flights.reduce(
      (acc, f) => {
        const p = positionAt(f.itinerary, now).position;
        return interpolate(acc, p, 1 / (flights.indexOf(f) + 1));
      },
      positionAt(flights[0].itinerary, now).position,
    );
    return { lat: mid.lat, lon: mid.lon, alt: 2.4 };
  }

  // Nothing to watch: face the sunny side, tipped a little north where most
  // of the land is.
  const sun = subsolarPoint(now);
  return { lat: 22, lon: sun.lon, alt: 2.5 };
}

export default function GlobeExperience({
  flights,
  focusId,
  getNow,
  beacons,
  autoRotate = false,
}: GlobeExperienceProps) {
  const [store] = useState(
    () =>
      new GlobeStore({
        selectedId: focusId ?? null,
        mode: (focusId ? 'follow' : 'free') satisfies CameraMode,
      }),
  );
  const [quality] = useState(detectQuality);
  const [dpr, setDpr] = useState(quality === 'high' ? 2 : 1.5);
  // Fixed at first render: the home view is where the camera starts, and
  // moving it under someone mid-gesture as flights load would be disorienting.
  const [home] = useState(() => homeFor(flights, focusId, getNow()));

  // A new focus from the page (a different letter) is followed.
  useEffect(() => {
    if (focusId) store.set({ selectedId: focusId, mode: 'follow' });
  }, [focusId, store]);

  // A selected bird that has disappeared from the list is let go of.
  useEffect(() => {
    const { selectedId } = store.get();
    if (selectedId && !flights.some((f) => f.id === selectedId)) store.set({ selectedId: null, mode: 'free' });
  }, [flights, store]);

  return (
    <div className="globe-space relative h-full w-full overflow-hidden">
      <Canvas
        camera={{ fov: 40, near: 0.01, far: 260, position: [0, 0, 4] }}
        // Capped: retina phones report 3, which more than doubles the pixels
        // shaded for a difference nobody can see.
        dpr={[1, dpr]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        frameloop="always"
        style={{ touchAction: 'none' }}
        aria-label="An interactive globe showing pigeons in flight"
        role="img"
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(quality === 'high' ? 2 : 1.5)} />
        <GlobeScene
          flights={flights}
          store={store}
          getNow={getNow}
          beacons={beacons}
          home={home}
          autoRotate={autoRotate}
          quality={quality}
        />
      </Canvas>

      <GlobeHud store={store} flights={flights} getNow={getNow} />
    </div>
  );
}
