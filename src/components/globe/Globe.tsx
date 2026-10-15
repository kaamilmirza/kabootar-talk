'use client';

/**
 * The scene: planet, sky, life, pigeons and the camera, assembled.
 *
 * Performance note, because it shapes everything here: React renders this
 * tree once per change of *what* is shown — a new letter, a layer toggled —
 * and never per frame. Every frame after that is imperative work on objects
 * that already exist, driven from `useFrame`. Nothing in the animation loop
 * allocates.
 *
 * The camera is mounted last so it moves after the birds have, and a camera
 * following a bird is never a frame behind her.
 */

import { Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { Beacons, type Beacon } from './Beacons';
import { CameraRig, type RigHome } from './CameraRig';
import { Clouds } from './Clouds';
import { Flight } from './Flight';
import { CityLights, Forests, Towns } from './Life';
import { subsolarPoint, surfaceVector } from './math';
import { Atmosphere, Ocean, Planet } from './Planet';
import { flightColor, type GlobeFlight, type GlobeStore, type Quality } from './store';
import { loadTerrain, type Terrain } from './terrain';
import { TOON_SUN } from './toon';

export interface GlobeSceneProps {
  flights: GlobeFlight[];
  store: GlobeStore;
  /** Server-corrected time. Called every frame, so it must be cheap. */
  getNow: () => number;
  /** Cities other people send from. One draw call; safe to leave on. */
  beacons?: Beacon[];
  home: RigHome;
  autoRotate?: boolean;
  quality: Quality;
}

const SETTINGS: Record<Quality, { segments: [number, number]; trees: number; clouds: number; stars: number }> = {
  high: { segments: [512, 256], trees: 12000, clouds: 110, stars: 4000 },
  low: { segments: [360, 180], trees: 6000, clouds: 70, stars: 2200 },
};

export function GlobeScene({ flights, store, getNow, beacons, home, autoRotate, quality }: GlobeSceneProps) {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const settings = SETTINGS[quality];

  const sun = useRef(new THREE.Vector3(0, 0, 1));
  const time = useRef(0);
  const cloudFade = useRef(1);
  const clouds = useRef<THREE.Group>(null);

  useEffect(() => {
    let cancelled = false;
    loadTerrain()
      .then((t) => {
        if (!cancelled) setTerrain(t);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(flights.map((f) => [f.id, f])), [flights]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const { clock } = store;
    const state = store.get();

    // A time-lapse runs the scene's clock forward, and stops once the
    // selected bird has landed rather than running on into the future.
    if (clock.rate !== 0) {
      store.setClock({ offsetMs: clock.offsetMs + delta * 1000 * clock.rate });
      const flight = state.selectedId ? byId.get(state.selectedId) : flights[0];
      if (flight) {
        const real = getNow();
        const end = flight.itinerary.arrivesAt + 60_000;
        if (real + clock.offsetMs >= end) store.setClock({ offsetMs: end - real, rate: 0 });
      }
    }

    time.current = getNow() + clock.offsetMs;

    surfaceVector(subsolarPoint(time.current), 1, sun.current).normalize();
    TOON_SUN.copy(sun.current);

    // Clouds thin out as the camera comes down through them.
    cloudFade.current = THREE.MathUtils.smoothstep(store.readout.altitude, 0.02, 0.1);
    if (clouds.current) clouds.current.visible = state.layers.clouds;
  });

  // Thrown during render so GlobeBoundary catches it and says so plainly.
  if (failure) throw failure;

  return (
    <>
      <Stars radius={70} depth={50} count={settings.stars} factor={3.4} saturation={0.25} fade speed={0.5} />

      {terrain ? (
        <>
          <Planet terrain={terrain} sun={sun} segments={settings.segments} />
          <Ocean terrain={terrain} sun={sun} />
          <Atmosphere sun={sun} />

          <group ref={clouds}>
            <Clouds terrain={terrain} sun={sun} clusters={settings.clouds} altitudeFade={cloudFade} />
          </group>

          <Forests terrain={terrain} count={settings.trees} store={store} />
          <Towns terrain={terrain} store={store} />
          <CityLights terrain={terrain} sun={sun} />

          {beacons && beacons.length > 0 ? <Beacons cities={beacons} radius={1.014} /> : null}

          {flights.map((flight, i) => (
            <Flight
              key={flight.id}
              flight={flight}
              color={flightColor(i)}
              terrain={terrain}
              store={store}
              sun={sun}
              time={time}
            />
          ))}
        </>
      ) : (
        <LoadingPlanet />
      )}

      <CameraRig store={store} terrain={terrain} home={home} autoRotate={autoRotate} />
    </>
  );
}

/** A plain blue ball while the terrain is being painted, so nothing pops in from nowhere. */
function LoadingPlanet() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (mesh.current) (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(clock.elapsedTime * 2) * 0.15;
  });
  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1, 64, 48]} />
      <meshBasicMaterial color="#1cb0f6" transparent opacity={0.6} />
    </mesh>
  );
}
