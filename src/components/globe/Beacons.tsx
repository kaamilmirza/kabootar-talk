'use client';

/**
 * Cities other people send from, as points of light on the globe.
 *
 * Drawn as a single `THREE.Points` with one shared shader, so the whole world
 * costs exactly one draw call no matter how many cities are on it. The
 * alternative — a mesh per city — is what turns a pretty map into a slideshow
 * on a phone, and it would scale with other people's adoption rather than with
 * anything this device controls.
 *
 * Clutter is handled by the data, not the renderer: the server only returns
 * cities several people have chosen, so the map is sparse and meaningful
 * rather than a haze of dots. Size carries the count, so a busy city reads as
 * busy without needing a label.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { toVector3 } from '@/lib/flight/geo';

export interface Beacon {
  label: string;
  lat: number;
  lon: number;
  senders: number;
}

export function Beacons({ cities, radius = 1.005 }: { cities: Beacon[]; radius?: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);

  const { geometry, shader } = useMemo(() => {
    const positions = new Float32Array(cities.length * 3);
    const sizes = new Float32Array(cities.length);
    const phases = new Float32Array(cities.length);

    const busiest = Math.max(1, ...cities.map((c) => c.senders));

    cities.forEach((city, i) => {
      const [x, y, z] = toVector3(city, radius);
      positions.set([x, y, z], i * 3);

      // Compressed, so one enormous city does not flatten everywhere else.
      sizes[i] = 7 + 13 * Math.sqrt(city.senders / busiest);
      // Staggered so they breathe out of step rather than pulsing as one.
      phases[i] = (i * 2.399) % (Math.PI * 2);
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#ffc800') },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying float vFade;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);

          // Points on the far side of the planet are hidden by fading rather
          // than by depth testing, which additive blending does not respect.
          vec3 worldNormal = normalize(mat3(modelMatrix) * normalize(position));
          vec3 toCamera = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
          vFade = smoothstep(-0.05, 0.35, dot(worldNormal, toCamera));

          float pulse = 0.85 + 0.15 * sin(uTime * 1.6 + aPhase);
          gl_PointSize = aSize * pulse * (300.0 / -viewPosition.z);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vFade;

        void main() {
          // A soft round dot with a bright centre, built from the point's own
          // coordinates so there is no texture to load.
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;

          float glow = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor, glow * glow * vFade * 0.9);
        }
      `,
    });

    return { geometry: g, shader: m };
  }, [cities, radius]);

  useEffect(
    () => () => {
      geometry.dispose();
      shader.dispose();
    },
    [geometry, shader],
  );

  useFrame(({ clock }) => {
    if (material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });

  if (cities.length === 0) return null;

  return (
    <points geometry={geometry}>
      <primitive object={shader} ref={material} attach="material" />
    </points>
  );
}
