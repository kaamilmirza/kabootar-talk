'use client';

/**
 * Puffy cartoon clouds, drifting.
 *
 * Each cloud is a cluster of squashed spheres, and every sphere on the planet
 * is one instance of one mesh, so the whole sky is two draw calls. They are
 * placed where weather actually gathers — the mid-latitude storm belts and
 * the tropics — and kept off the big deserts, using the same terrain data the
 * ground is drawn from.
 *
 * Fading is done by dithering rather than transparency. Transparent instances
 * would have to be sorted back to front every frame to look right; a dither
 * pattern needs no sorting and reads as halftone shading, which suits the
 * comic-book look.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { setUniform } from './mutate';
import { GLSL_DITHER, fbm3, randomDirection, rng, tangentFrame, toLatLon } from './math';
import type { Terrain } from './terrain';

const _dir = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _basis = new THREE.Matrix4();

function buildLayer(terrain: Terrain, clusters: number, seed: number, radius: [number, number]) {
  const random = rng(seed);
  const matrices: THREE.Matrix4[] = [];

  let placed = 0;
  let attempts = 0;
  while (placed < clusters && attempts < clusters * 40) {
    attempts++;
    randomDirection(random(), random(), _dir);
    const { lat, lon } = toLatLon(_dir);
    const alat = Math.abs(lat);

    // Storm belts around 40-60 degrees, a band near the equator, little in
    // the subtropical highs where the deserts are.
    const belt =
      Math.exp(-(((alat - 50) / 14) ** 2)) * 1.0 +
      Math.exp(-(((alat - 6) / 9) ** 2)) * 0.85 +
      0.18;
    const ground = terrain.sample(lat, lon);
    const dry = ground.land > 0.5 ? ground.dryness : 0;
    const weather = fbm3(_dir.x * 2.2 + 7, _dir.y * 2.2, _dir.z * 2.2, 3);
    const chance = belt * (1 - dry * 0.9) * THREE.MathUtils.smoothstep(weather, 0.35, 0.62);
    if (random() > chance) continue;

    placed++;
    tangentFrame(_dir, _east, _north);
    const r = radius[0] + random() * (radius[1] - radius[0]);
    const spread = 0.018 + random() * 0.03;
    const puffs = 4 + Math.floor(random() * 6);
    const heading = random() * Math.PI * 2;
    const along = _east.clone().multiplyScalar(Math.cos(heading)).addScaledVector(_north, Math.sin(heading));
    const across = new THREE.Vector3().crossVectors(_dir, along);

    for (let i = 0; i < puffs; i++) {
      // Elongated clusters with the biggest puffs near the middle.
      const t = (i / Math.max(1, puffs - 1)) * 2 - 1;
      const size = (0.011 + random() * 0.012) * (1.15 - Math.abs(t) * 0.55);
      _pos
        .copy(_dir)
        .multiplyScalar(r + size * 0.25 * random())
        .addScaledVector(along, t * spread)
        .addScaledVector(across, (random() - 0.5) * spread * 0.6);

      const up = _pos.clone().normalize();
      tangentFrame(up, _east, _north);
      _basis.makeBasis(_east, up, _north);
      _q.setFromRotationMatrix(_basis);
      // Flat-bottomed: squashed along the local vertical.
      _scale.set(size, size * (0.62 + random() * 0.2), size);
      matrices.push(new THREE.Matrix4().compose(_pos, _q, _scale));
    }
  }

  return matrices;
}

function cloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 0, 1) },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vCenter;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vNormal = normalize(mat3(m) * normal);
        vec4 world = m * vec4(position, 1.0);
        vWorld = world.xyz;
        vCenter = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uFade;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vCenter;
      ${GLSL_DITHER}

      void main() {
        // Thin out near the camera, so diving through cloud never blinds the view.
        float near = smoothstep(0.015, 0.09, distance(cameraPosition, vCenter));
        float alpha = near * uFade;
        if (alpha < gBayer(gl_FragCoord.xy)) discard;

        vec3 n = normalize(vNormal);
        vec3 up = normalize(vCenter);
        float l = dot(n, uSun);
        float sunHere = dot(up, uSun);

        vec3 lit = vec3(1.0);
        vec3 mid = vec3(0.86, 0.89, 0.97);
        vec3 shade = vec3(0.70, 0.74, 0.88);

        vec3 c = l > 0.35 ? lit : (l > -0.05 ? mid : shade);

        // Halftone dots in the shadow band, like printed comics.
        if (l < 0.35) {
          vec2 cell = fract(gl_FragCoord.xy / 4.0) - 0.5;
          float dotMask = step(length(cell), 0.28);
          c = mix(c, c * 0.88, dotMask * smoothstep(0.35, -0.2, l));
        }

        // Pink at dusk, slate at night.
        float day = smoothstep(-0.18, 0.1, sunHere);
        float dusk = 1.0 - smoothstep(0.0, 0.3, abs(sunHere));
        c = mix(c, c * vec3(1.0, 0.78, 0.74), dusk * 0.6);
        c = mix(c * vec3(0.30, 0.34, 0.52), c, day);

        // An ink rim at the silhouette.
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float edge = 1.0 - smoothstep(0.12, 0.26, abs(dot(n, viewDir)));
        c = mix(c, vec3(0.42, 0.46, 0.66), edge * 0.7);

        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

function CloudLayer({
  matrices,
  sun,
  speed,
  altitudeFade,
}: {
  matrices: THREE.Matrix4[];
  sun: React.RefObject<THREE.Vector3>;
  speed: number;
  altitudeFade: React.RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);

  const { mesh, material } = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const mat = cloudMaterial();
    const m = new THREE.InstancedMesh(geometry, mat, matrices.length);
    matrices.forEach((matrix, i) => m.setMatrixAt(i, matrix));
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    return { mesh: m, material: mat };
  }, [matrices]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * speed;
    // Normals are taken to world space in the shader, layer turn included,
    // so the sun can stay in world space too.
    if (sun.current) material.uniforms.uSun.value.copy(sun.current);
    setUniform(material, 'uFade', altitudeFade.current ?? 1);
  });

  return (
    <group ref={group}>
      <primitive object={mesh} />
    </group>
  );
}

export function Clouds({
  terrain,
  sun,
  clusters,
  altitudeFade,
}: {
  terrain: Terrain;
  sun: React.RefObject<THREE.Vector3>;
  clusters: number;
  /** 0..1, lowered by the scene when the camera is skimming the clouds. */
  altitudeFade: React.RefObject<number>;
}) {
  const [low, high] = useMemo(
    () => [
      buildLayer(terrain, Math.round(clusters * 0.6), 7, [1.05, 1.058]),
      buildLayer(terrain, Math.round(clusters * 0.4), 19, [1.062, 1.072]),
    ],
    [terrain, clusters],
  );

  return (
    <>
      <CloudLayer matrices={low} sun={sun} speed={0.0045} altitudeFade={altitudeFade} />
      <CloudLayer matrices={high} sun={sun} speed={0.0028} altitudeFade={altitudeFade} />
    </>
  );
}
