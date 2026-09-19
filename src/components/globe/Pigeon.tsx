'use client';

/**
 * The bird, in three dimensions.
 *
 * Built from primitives rather than loaded from a model file: it keeps the
 * repository asset-free and the bundle small, and at the size it is seen on
 * the globe a low-poly bird reads better than a detailed one.
 *
 * Authored nose-forward along +Z with its back along +Y, because that is the
 * basis the scene builds when it places her. Keeping model and placement in
 * the same convention avoids a corrective rotation that nobody would remember
 * the reason for later.
 *
 * Materials are unlit on purpose. The rest of the app is flat colour with no
 * gradients, and skipping lighting is also the cheapest thing a GPU can do —
 * which matters on the phones this is actually used on.
 */

import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { MOODS, type FlightMood } from '@/lib/flight/states';

export interface PigeonHandle {
  /** Imperative so a mood change never costs a React render. */
  setMood: (mood: FlightMood) => void;
}

interface PigeonProps {
  scale?: number;
  initialMood?: FlightMood;
}

const flat = (color: string) => new THREE.MeshBasicMaterial({ color });

export const Pigeon = forwardRef<PigeonHandle, PigeonProps>(function Pigeon(
  { scale = 1, initialMood = 'launch' },
  ref,
) {
  const group = useRef<THREE.Group>(null);
  const leftWing = useRef<THREE.Group>(null);
  const rightWing = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  const mood = useRef<FlightMood>(initialMood);
  useImperativeHandle(ref, () => ({ setMood: (next) => (mood.current = next) }), []);

  const materials = useMemo(
    () => ({
      body: flat('#b6c0d4'),
      belly: flat('#d9e0ec'),
      wing: flat('#5b6b8c'),
      dark: flat('#3f4c68'),
      neck: flat('#4fd4c2'),
      beak: flat('#ffc800'),
      eye: flat('#3c3c3c'),
      scroll: flat('#ffffff'),
      ribbon: flat('#ff4b4b'),
    }),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const profile = MOODS[mood.current];
    const { flapHz, bobAmplitude, roll } = profile.animation;
    const resting = profile.kind === 'resting';

    if (group.current) {
      group.current.position.y = Math.sin(t * 1.9) * bobAmplitude;
      group.current.rotation.z = THREE.MathUtils.degToRad(roll) * Math.sin(t * 0.8);
    }

    if (resting || flapHz === 0) {
      // A standing bird does not flap, but it is never quite still: it looks
      // around, and it shuffles.
      const idle = Math.sin(t * 1.3) * 0.08;
      if (leftWing.current) leftWing.current.rotation.z = -0.16 + idle * 0.2;
      if (rightWing.current) rightWing.current.rotation.z = 0.16 - idle * 0.2;
      if (head.current) head.current.rotation.y = Math.sin(t * 0.7) * 0.5;
      return;
    }

    // Asymmetric flap: the downstroke is quicker than the recovery, which is
    // what makes it read as a bird rather than a metronome.
    const phase = (t * flapHz) % 1;
    const stroke =
      phase < 0.4
        ? Math.sin((phase / 0.4) * Math.PI)
        : -Math.sin(((phase - 0.4) / 0.6) * Math.PI) * 0.55;
    const angle = stroke * 1.15;

    if (leftWing.current) leftWing.current.rotation.z = -angle;
    if (rightWing.current) rightWing.current.rotation.z = angle;
    if (head.current) head.current.rotation.y = Math.sin(t * 0.55) * 0.16;
  });

  return (
    <group ref={group} scale={scale}>
      {/* body, long axis forward */}
      <mesh material={materials.body} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.3, 0.44, 4, 10]} />
      </mesh>
      {/* pale belly, so she reads against both land and sea */}
      <mesh material={materials.belly} position={[0, -0.12, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.24, 0.36, 4, 10]} />
      </mesh>

      <mesh material={materials.neck} position={[0, 0.02, 0.3]}>
        <sphereGeometry args={[0.25, 12, 8]} />
      </mesh>

      <group ref={head} position={[0, 0.08, 0.5]}>
        <mesh material={materials.body}>
          <sphereGeometry args={[0.22, 14, 10]} />
        </mesh>
        <mesh material={materials.beak} position={[0, -0.02, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.065, 0.24, 6]} />
        </mesh>
        <mesh material={materials.eye} position={[0.13, 0.05, 0.12]}>
          <sphereGeometry args={[0.045, 6, 6]} />
        </mesh>
        <mesh material={materials.eye} position={[-0.13, 0.05, 0.12]}>
          <sphereGeometry args={[0.045, 6, 6]} />
        </mesh>
      </group>

      {/* wings, hinged at the shoulder so they sweep rather than slide */}
      <group ref={leftWing} position={[0.24, 0.1, 0.02]}>
        <mesh material={materials.wing} position={[0.44, 0, -0.04]}>
          <boxGeometry args={[0.92, 0.04, 0.46]} />
        </mesh>
        <mesh material={materials.dark} position={[0.9, -0.01, -0.16]} rotation={[0, 0.16, 0]}>
          <boxGeometry args={[0.44, 0.03, 0.32]} />
        </mesh>
      </group>

      <group ref={rightWing} position={[-0.24, 0.1, 0.02]}>
        <mesh material={materials.wing} position={[-0.44, 0, -0.04]}>
          <boxGeometry args={[0.92, 0.04, 0.46]} />
        </mesh>
        <mesh material={materials.dark} position={[-0.9, -0.01, -0.16]} rotation={[0, -0.16, 0]}>
          <boxGeometry args={[0.44, 0.03, 0.32]} />
        </mesh>
      </group>

      <mesh material={materials.dark} position={[0, 0.06, -0.52]} rotation={[0.12, 0, 0]}>
        <boxGeometry args={[0.34, 0.035, 0.46]} />
      </mesh>

      {/* the letter, tied to her ankle */}
      <mesh material={materials.scroll} position={[0, -0.27, 0.06]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.22, 8]} />
      </mesh>
      <mesh material={materials.ribbon} position={[0, -0.27, 0.06]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.05, 8]} />
      </mesh>
    </group>
  );
});
