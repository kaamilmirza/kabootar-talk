'use client';

/**
 * The WebGL canvas, split out so it loads on demand.
 *
 * three.js is by far the largest thing this app ships and none of it is needed
 * to read a letter, so it stays behind a dynamic import. The coop and the
 * letter screens open instantly; the globe pays for itself only when someone
 * actually goes to watch a pigeon.
 */

import { Canvas } from '@react-three/fiber';

import { GlobeScene, type GlobeSceneProps } from './Globe';

export default function GlobeCanvas(props: GlobeSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.6], fov: 38 }}
      // Capped at 2. Retina phones report 3, which triples the pixels shaded
      // for a difference nobody can see on a globe this size.
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      // The bird is always moving, so there is always something to draw.
      frameloop="always"
    >
      <GlobeScene {...props} />
    </Canvas>
  );
}
