'use client';

/**
 * The ground, the sea and the air, as three shaders.
 *
 * Toon-shaded on purpose: light falls in a few clean bands rather than a
 * smooth gradient, coastlines are inked, and the sea is a handful of flat
 * blues. It matches the chunky, friendly look of the rest of the app, and a
 * stylised planet stays readable at the sizes a phone actually shows it.
 *
 * The ground is a finely divided sphere pushed out by real elevation in the
 * vertex shader, then lit per pixel from the same height data, so mountains
 * have both a silhouette on the horizon and shading up close. The sea is a
 * separate sphere at radius 1 that simply refuses to draw over land: that is
 * what makes coastlines pixel-sharp at any zoom, rather than as jagged as the
 * mesh underneath.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { setUniform } from './mutate';
import { GLSL_NOISE, LAND_BASE, RELIEF } from './math';
import type { Terrain } from './terrain';
import { TERRAIN_HEIGHT, TERRAIN_WIDTH } from './terrain';

/** Shared by ground and sea, so the two agree on air, night and ink. */
const GLSL_COMMON = /* glsl */ `
  const vec3 INK = vec3(0.10, 0.16, 0.30);

  vec3 skyTint(float sunDot) {
    vec3 day = vec3(0.55, 0.84, 1.0);
    vec3 dusk = vec3(1.0, 0.62, 0.48);
    return mix(dusk, day, smoothstep(-0.05, 0.35, sunDot));
  }

  // How much of the day a point is in, with a soft terminator.
  float daylight(float sunDot) {
    return smoothstep(-0.14, 0.06, sunDot);
  }

  // Three bands of light: lit, half-lit, shade. The edges are softened by a
  // pixel or so, which keeps the bands crisp without stair-stepping.
  float toon(float l) {
    float a = smoothstep(0.10, 0.14, l);
    float b = smoothstep(0.50, 0.54, l);
    return 0.70 + 0.16 * a + 0.14 * b;
  }

  vec3 nightSide(vec3 c) {
    return c * 0.22 + vec3(0.05, 0.075, 0.19);
  }

  // A line of ink where the land mask crosses one half: pixel-wide at any zoom.
  float coastInk(float land) {
    float w = max(fwidth(land), 1e-4);
    return 1.0 - smoothstep(0.0, w * 1.4, abs(land - 0.5));
  }
`;

export function Planet({
  terrain,
  sun,
  segments,
}: {
  terrain: Terrain;
  sun: React.RefObject<THREE.Vector3>;
  segments: [number, number];
}) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, segments[0], segments[1]), [segments]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTerrain: { value: terrain.texture },
          uBorders: { value: terrain.borders },
          uSun: { value: new THREE.Vector3(0, 0, 1) },
          uTexel: { value: new THREE.Vector2(1 / TERRAIN_WIDTH, 1 / TERRAIN_HEIGHT) },
        },
        vertexShader: /* glsl */ `
          uniform sampler2D uTerrain;
          varying vec2 vUv;
          varying vec3 vDir;
          varying vec3 vWorld;

          void main() {
            vUv = uv;
            vec4 t = texture2D(uTerrain, uv);
            float landness = smoothstep(0.35, 0.65, t.g);
            float r = 1.0 + mix(-0.004, ${LAND_BASE.toFixed(5)} + t.r * ${RELIEF.toFixed(5)}, landness);
            vec3 dir = normalize(position);
            vDir = dir;
            vec4 world = modelMatrix * vec4(dir * r, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTerrain;
          uniform sampler2D uBorders;
          uniform vec3 uSun;
          uniform vec2 uTexel;
          varying vec2 vUv;
          varying vec3 vDir;
          varying vec3 vWorld;

          ${GLSL_NOISE}
          ${GLSL_COMMON}

          float elev(vec2 uv) { return texture2D(uTerrain, uv).r; }

          void main() {
            vec4 t = texture2D(uTerrain, vUv);
            vec3 N = normalize(vDir);

            // --- relief: a normal from the height field ----------------------
            vec3 east = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-6, 0.0, 0.0));
            vec3 north = normalize(cross(N, east));
            float cosLat = max(0.08, sqrt(1.0 - N.y * N.y));

            float hE = elev(vUv + vec2(uTexel.x, 0.0)) - elev(vUv - vec2(uTexel.x, 0.0));
            float hN = elev(vUv + vec2(0.0, uTexel.y)) - elev(vUv - vec2(0.0, uTexel.y));
            // Exaggerated a little past the geometry: toon light needs a
            // strong slope to put a mountain's shadow side in its own band.
            float k = ${RELIEF.toFixed(5)} * 2.6;
            float sE = k * hE / (2.0 * uTexel.x * 6.2831853 * cosLat);
            float sN = k * hN / (2.0 * uTexel.y * 3.1415926);
            vec3 n = normalize(N - sE * east - sN * north);

            // --- colour: climate, dryness, height ----------------------------
            float latDeg = degrees(asin(clamp(N.y, -1.0, 1.0)));
            float alat = abs(latDeg);
            float n1 = gFbm(N * 9.0);
            float n2 = gNoise(N * 70.0);
            float n3 = gNoise(N * 220.0);

            vec3 tropical = vec3(0.19, 0.66, 0.29);
            vec3 temperate = vec3(0.47, 0.83, 0.25);
            vec3 boreal = vec3(0.24, 0.55, 0.33);
            vec3 tundra = vec3(0.60, 0.68, 0.50);
            vec3 savanna = vec3(0.78, 0.80, 0.36);
            vec3 sand = vec3(0.98, 0.83, 0.50);
            vec3 rock = vec3(0.62, 0.55, 0.52);
            vec3 snow = vec3(0.96, 0.98, 1.0);

            float wobble = (n1 - 0.5) * 12.0;
            vec3 c = mix(tropical, temperate, smoothstep(13.0, 27.0, alat + wobble));
            c = mix(c, boreal, smoothstep(47.0, 55.0, alat + wobble));
            c = mix(c, tundra, smoothstep(60.0, 67.0, alat + wobble * 0.6));

            float dry = t.a + (n1 - 0.5) * 0.35;
            c = mix(c, savanna, smoothstep(0.22, 0.40, dry));
            c = mix(c, sand, smoothstep(0.48, 0.62, dry));

            // Patchwork of fields and woods, only visible up close.
            c *= 0.92 + 0.12 * step(0.5, n3) * (1.0 - smoothstep(0.4, 0.7, dry));

            // Beaches: a thin warm strip just inland of the shore.
            float beach = (1.0 - smoothstep(0.52, 0.60, t.b)) * (1.0 - smoothstep(55.0, 62.0, alat));
            c = mix(c, sand, beach * 0.75);

            // Rock then snow with height; the snowline drops towards the poles.
            float e = t.r + (n2 - 0.5) * 0.06;
            float snowline = mix(0.62, 0.10, smoothstep(25.0, 68.0, alat));
            c = mix(c, rock, smoothstep(snowline - 0.26, snowline - 0.12, e));
            c = mix(c, snow, smoothstep(snowline - 0.03, snowline + 0.02, e));
            c = mix(c, snow, smoothstep(-63.0, -66.0, latDeg));
            c = mix(c, snow, smoothstep(76.0, 80.0, latDeg + wobble * 0.3));

            // --- light -------------------------------------------------------
            float sunDot = dot(N, uSun);
            float day = daylight(sunDot);
            vec3 lit = c * toon(dot(n, uSun));
            vec3 col = mix(nightSide(c), lit, day);

            // Warmth along the terminator, where the bird flies into dusk.
            float dusk = 1.0 - smoothstep(0.0, 0.28, abs(sunDot));
            col = mix(col, col * vec3(1.18, 0.86, 0.72), dusk * 0.45);

            // Borders: faint white, like a well-loved school atlas.
            float border = texture2D(uBorders, vUv).r;
            col = mix(col, vec3(1.0), border * 0.38 * (0.35 + 0.65 * day));

            // Air in front of the ground, thickest at the limb.
            vec3 viewDir = normalize(cameraPosition - vWorld);
            float rim = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0);
            col = mix(col, skyTint(sunDot), rim * 0.55 * max(day, 0.15));

            col = mix(col, INK, coastInk(t.g) * 0.85);

            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [terrain],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    if (sun.current) material.uniforms.uSun.value.copy(sun.current);
  });

  return <mesh geometry={geometry} material={material} />;
}

export function Ocean({ terrain, sun }: { terrain: Terrain; sun: React.RefObject<THREE.Vector3> }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTerrain: { value: terrain.texture },
          uSun: { value: new THREE.Vector3(0, 0, 1) },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vDir;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vDir = normalize(position);
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTerrain;
          uniform vec3 uSun;
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vDir;
          varying vec3 vWorld;

          ${GLSL_NOISE}
          ${GLSL_COMMON}

          void main() {
            vec4 t = texture2D(uTerrain, vUv);
            float ink = coastInk(t.g);
            // Land is the ground's job. Keep the ink's outer half, though, so
            // the coastline is drawn at full width from both sides.
            if (t.g > 0.5 && ink < 0.02) discard;

            vec3 N = normalize(vDir);
            float alat = abs(degrees(asin(clamp(N.y, -1.0, 1.0))));

            // Depth bands from the blurred coastline: shelf, sea, deep.
            float d = t.b + (gNoise(N * 30.0) - 0.5) * 0.08;
            vec3 deep = vec3(0.06, 0.40, 0.80);
            vec3 sea = vec3(0.11, 0.66, 0.96);
            vec3 shallow = vec3(0.42, 0.87, 0.94);
            vec3 c = deep;
            c = mix(c, sea, smoothstep(0.10, 0.13, d));
            c = mix(c, shallow, smoothstep(0.34, 0.37, d));

            // Sea ice, ragged at the edge.
            float ice = smoothstep(77.0, 79.0, alat + (gNoise(N * 22.0) - 0.5) * 8.0);
            c = mix(c, vec3(0.92, 0.97, 1.0), ice);

            // Surf: rings that roll in towards the shore.
            float surfBand = smoothstep(0.16, 0.30, t.b) * (1.0 - smoothstep(0.44, 0.5, t.b));
            float surf = smoothstep(0.86, 0.97, sin(t.b * 110.0 - uTime * 1.6 + gNoise(N * 40.0) * 3.0));
            c = mix(c, vec3(1.0), surf * surfBand * 0.75 * (1.0 - ice));

            // Little white wave crests that drift, out in open water.
            float crest = gNoise(N * 120.0 + vec3(uTime * 0.06, uTime * 0.03, 0.0));
            c = mix(c, vec3(0.86, 0.96, 1.0), step(0.83, crest) * 0.35 * (1.0 - ice));

            float sunDot = dot(N, uSun);
            float day = daylight(sunDot);

            // Wave-rippled normal for the glint.
            vec3 wn = normalize(N + 0.035 * vec3(
              gNoise(N * 80.0 + uTime * 0.1) - 0.5,
              gNoise(N * 80.0 + 13.0 + uTime * 0.1) - 0.5,
              gNoise(N * 80.0 + 27.0 + uTime * 0.1) - 0.5));
            vec3 viewDir = normalize(cameraPosition - vWorld);
            vec3 halfway = normalize(uSun + viewDir);
            float spec = pow(max(dot(wn, halfway), 0.0), 140.0);
            float glint = smoothstep(0.35, 0.45, spec) * (1.0 - ice);

            vec3 lit = c * toon(sunDot + 0.25) + glint * 0.6;
            vec3 col = mix(nightSide(c), lit, day);

            float rim = pow(1.0 - max(dot(N, viewDir), 0.0), 2.6);
            col = mix(col, skyTint(sunDot), rim * 0.6 * max(day, 0.12));

            col = mix(col, INK, ink * 0.85);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [terrain],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    setUniform(material, 'uTime', clock.elapsedTime);
    if (sun.current) material.uniforms.uSun.value.copy(sun.current);
  });

  return (
    <mesh material={material}>
      <sphereGeometry args={[1, 192, 96]} />
    </mesh>
  );
}

/** The glow of air around the planet, warm at dusk and faint on the night side. */
export function Atmosphere({ sun }: { sun: React.RefObject<THREE.Vector3> }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSun: { value: new THREE.Vector3(0, 0, 1) } },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vWorldNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          varying vec3 vNormal;
          varying vec3 vWorldNormal;
          void main() {
            float rim = pow(clamp(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.2);
            float s = dot(normalize(vWorldNormal), uSun);
            vec3 day = vec3(0.40, 0.76, 1.0);
            vec3 dusk = vec3(1.0, 0.56, 0.46);
            vec3 night = vec3(0.20, 0.24, 0.62);
            vec3 c = mix(night, dusk, smoothstep(-0.35, -0.05, s));
            c = mix(c, day, smoothstep(-0.05, 0.3, s));
            float strength = mix(0.35, 1.0, smoothstep(-0.4, 0.1, s));
            gl_FragColor = vec4(c, rim * strength * 1.1);
          }
        `,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    if (sun.current) material.uniforms.uSun.value.copy(sun.current);
  });

  return (
    <mesh material={material} scale={1.12}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}
