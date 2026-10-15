/**
 * Small pieces of geometry shared by everything on the globe.
 *
 * The planet is a unit sphere with north up the +Y axis, placed exactly where
 * `toVector3` in `lib/flight/geo` puts it, so a coordinate means the same
 * thing to the flight simulation and to the renderer. Nothing here allocates
 * unless it is asked for a fresh object, because most of it runs every frame.
 */

import * as THREE from 'three';

import { angularDistanceDeg, interpolate, toVector3, type LatLon } from '@/lib/flight/geo';

/** How far land is lifted above the sea, before any mountains. */
export const LAND_BASE = 0.0016;
/**
 * Vertical exaggeration of the real elevation data.
 *
 * Earth is smoother than a billiard ball; at true scale Everest would be a
 * seventh of a pixel. At this scale the Himalaya, the Andes and the ice
 * domes read as mountains from orbit, which is the whole point of having them.
 */
export const RELIEF = 0.042;
/** The highest a pigeon's arc rises above the sea, for the longest flights. */
export const MAX_ARC = 0.15;

export function surfaceVector(p: LatLon, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const [x, y, z] = toVector3(p, radius);
  return out.set(x, y, z);
}

/** The inverse of `surfaceVector`, for a direction from the centre. */
export function toLatLon(v: THREE.Vector3): LatLon {
  const r = v.length() || 1;
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)));
  const theta = Math.atan2(v.z, -v.x);
  let lon = THREE.MathUtils.radToDeg(theta) - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/**
 * How high an arc rises at fraction `t`, for a route spanning `angleDeg`.
 *
 * Scaled by the route's length: a hop from Delhi to Lahore climbing as high
 * as a flight to Toronto looks like a rocket launch, not a pigeon.
 */
export function arcHeight(t: number, angleDeg: number): number {
  const peak = 0.012 + MAX_ARC * Math.min(1, angleDeg / 150);
  return peak * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
}

export function routeAngle(from: LatLon, to: LatLon): number {
  return angularDistanceDeg(from, to);
}

/** Point along the route, lifted onto its arc. */
export function routePoint(
  from: LatLon,
  to: LatLon,
  t: number,
  angleDeg: number,
  out: THREE.Vector3,
  extraLift = 0,
): THREE.Vector3 {
  const radius = 1 + LAND_BASE + arcHeight(t, angleDeg) + extraLift;
  return surfaceVector(interpolate(from, to, t), radius, out);
}

/** Where the sun is overhead. Low precision, which is ample for shading. */
export function subsolarPoint(atMs: number): LatLon {
  const days = atMs / 86_400_000 - 10_957.5;
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const meanAnomaly = THREE.MathUtils.degToRad((357.528 + 0.9856003 * days) % 360);

  const eclipticLongitude = THREE.MathUtils.degToRad(
    meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly),
  );
  const obliquity = THREE.MathUtils.degToRad(23.439);

  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))),
    lon: -15 * (((atMs / 3_600_000) % 24) - 12),
  };
}

/** East and north at a point on the sphere, for orienting things on it. */
export function tangentFrame(
  normal: THREE.Vector3,
  east: THREE.Vector3,
  north: THREE.Vector3,
): void {
  east.set(normal.z, 0, -normal.x);
  // At the poles "east" is undefined; any horizontal direction will do.
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(normal, east).normalize();
}

// --- deterministic noise ------------------------------------------------------
//
// Placement of trees, clouds and buildings is seeded, so the planet looks the
// same every visit and on every device — the forests do not reshuffle each
// time the page opens.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 3D, 0..1. Cheap, and seam-free on a sphere. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
  const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
  const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
  const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);

  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** A few octaves of `noise3`, 0..1. */
export function fbm3(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** A uniformly random direction, from two uniform numbers. */
export function randomDirection(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const theta = u * Math.PI * 2;
  const z = v * 2 - 1;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(theta), z, r * Math.sin(theta));
}

/** The same value-noise, in GLSL, for shaders that want texture without a texture. */
export const GLSL_NOISE = /* glsl */ `
  float gHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float gNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x),
          mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x),
          mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float gFbm(vec3 x) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * gNoise(x);
      x *= 2.03;
      a *= 0.5;
    }
    return v / 0.9375;
  }
`;

/** An ordered 4x4 dither, for fading solid things out without sorting them. */
export const GLSL_DITHER = /* glsl */ `
  float gBayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    int i = int(q.x + q.y * 4.0);
    float m[16];
    m[0] = 0.0;  m[1] = 8.0;  m[2] = 2.0;  m[3] = 10.0;
    m[4] = 12.0; m[5] = 4.0;  m[6] = 14.0; m[7] = 6.0;
    m[8] = 3.0;  m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
    m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
    for (int k = 0; k < 16; k++) { if (k == i) return (m[k] + 0.5) / 16.0; }
    return 0.5;
  }
`;
