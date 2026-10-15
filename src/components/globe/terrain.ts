/**
 * Everything the planet knows about the ground, packed into one texture.
 *
 *   R  elevation, from real data (NASA-derived, see public/globe/README.md)
 *   G  land or sea, from Natural Earth 1:50m coastlines — crisp
 *   B  the same coastline blurred wide: continental shelves, shallows, surf
 *   A  how dry a place is: deserts and steppe, painted from named regions
 *
 * The same pixels are kept on the CPU, so a tree, a building or a resting
 * pigeon is placed at exactly the height the GPU draws the ground. Two
 * separate sources of height would put forests visibly in the air.
 *
 * Built once per page load and cached. All of it is bundled or served from
 * this app — no tile server, no third party learning which part of the world
 * anyone is looking at.
 */

import { feature, mesh } from 'topojson-client';
import type { FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import * as THREE from 'three';
import countries from 'world-atlas/countries-110m.json';
import land from 'world-atlas/land-50m.json';

import { LAND_BASE, RELIEF } from './math';

export const TERRAIN_WIDTH = 2048;
export const TERRAIN_HEIGHT = 1024;

const ELEVATION_URL = '/globe/elevation.png';

export interface GroundSample {
  /** 0..1 — 1 is the top of the Tibetan plateau. */
  elevation: number;
  /** 0..1 — over 0.5 is land. */
  land: number;
  /** 0..1 — 0 is open ocean, about 0.5 is the shoreline, 1 is far inland. */
  coast: number;
  /** 0..1 — over 0.55 is desert. */
  dryness: number;
}

export interface Terrain {
  /** RGBA as described above. */
  texture: THREE.DataTexture;
  /** Country borders, one channel. */
  borders: THREE.DataTexture;
  sample: (lat: number, lon: number, out?: GroundSample) => GroundSample;
  /** Distance from the centre to the drawn ground at this point. */
  groundRadius: (lat: number, lon: number) => number;
  /**
   * Where something resting here sits: the ground on land, the water's
   * surface at sea. A pigeon on a trawler is on the sea, not under it.
   */
  surfaceRadius: (lat: number, lon: number) => number;
}

/**
 * The radius the planet's vertex shader puts the ground at.
 *
 * Kept as one function, mirrored exactly in the GLSL in `Planet.tsx`, so the
 * two can never quietly disagree.
 */
export function groundRadiusFor(elevation: number, land: number): number {
  const landness = THREE.MathUtils.smoothstep(land, 0.35, 0.65);
  return 1 + THREE.MathUtils.lerp(-0.004, LAND_BASE + elevation * RELIEF, landness);
}

type AnyTopology = Parameters<typeof feature>[0] & {
  objects: Record<string, Parameters<typeof feature>[1]>;
};

// --- painting -----------------------------------------------------------------

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

/**
 * Longitudes as drawn are continuous, not wrapped, so a ring crossing the
 * antimeridian (Russia, Fiji) does not smear a stripe across the whole map.
 * Each ring is then drawn three times, one map-width apart.
 */
function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [];
  let offset = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    if (i > 0) {
      const delta = lon - ring[i - 1][0];
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  return out;
}

function trace(
  ctx: CanvasRenderingContext2D,
  rings: Position[][],
  shift: number,
  width: number,
  height: number,
  close: boolean,
): void {
  for (const ring of rings) {
    const points = unwrap(ring);
    for (let i = 0; i < points.length; i++) {
      const x = ((points[i][0] + shift + 180) / 360) * width;
      const y = ((90 - points[i][1]) / 180) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (close) ctx.closePath();
  }
}

function paintLand(width: number, height: number): Uint8ClampedArray {
  const [, ctx] = canvas(width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const topo = land as unknown as AnyTopology;
  const shapes = feature(topo, topo.objects.land) as unknown as FeatureCollection<
    Polygon | MultiPolygon
  >;

  ctx.fillStyle = '#fff';
  for (const shape of shapes.features) {
    const g = shape.geometry;
    const polygons: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polygons) {
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath();
        trace(ctx, rings, shift, width, height, true);
        ctx.fill('evenodd');
      }
    }
  }

  // Natural Earth's Antarctica stops short of the pole in an equirectangular
  // map. Fill the last rows so the south pole is ice, not a hole of sea.
  ctx.fillRect(0, height - Math.ceil(height * 0.02), width, Math.ceil(height * 0.02));

  return ctx.getImageData(0, 0, width, height).data;
}

function paintBorders(width: number, height: number): Uint8ClampedArray {
  const [, ctx] = canvas(width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const topo = countries as unknown as AnyTopology;
  // Only borders shared by two countries: coastlines are drawn elsewhere.
  const lines = mesh(topo, topo.objects.countries as never, (a, b) => a !== b) as unknown as MultiLineString;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  for (const shift of [-360, 0, 360]) {
    ctx.beginPath();
    trace(ctx, lines.coordinates, shift, width, height, false);
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * A wide blur by shrinking and growing again.
 *
 * `ctx.filter = 'blur()'` would be simpler but is missing from older Safari,
 * and this is the one screen that most needs to work on an iPhone.
 */
function blurred(source: Uint8ClampedArray, width: number, height: number, factor: number): Uint8ClampedArray {
  const [full, fullCtx] = canvas(width, height);
  const image = fullCtx.createImageData(width, height);
  image.data.set(source);
  fullCtx.putImageData(image, 0, 0);

  let current: HTMLCanvasElement = full;
  let w = width;
  let h = height;

  // Halve repeatedly rather than in one step: one big step is a box filter
  // with hard, blocky edges.
  while (w > width / factor) {
    const [next, nextCtx] = canvas(Math.max(1, w >> 1), Math.max(1, h >> 1));
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(current, 0, 0, next.width, next.height);
    current = next;
    w = next.width;
    h = next.height;
  }

  const [out, outCtx] = canvas(width, height);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(current, 0, 0, width, height);
  return out.getContext('2d')!.getImageData(0, 0, width, height).data;
}

/** Where it is dry, as soft-edged ellipses over the regions everyone knows. */
const DRY_REGIONS: Array<[lat: number, lon: number, rLat: number, rLon: number, strength: number]> = [
  [23, 8, 10, 30, 1], // Sahara
  [17, 20, 4, 26, 0.55], // the Sahel
  [23, 47, 9, 11, 1], // Arabia
  [31, 58, 5, 9, 0.85], // the Iranian plateau
  [27, 70, 4, 5, 0.8], // Thar
  [40, 85, 4, 10, 0.9], // Taklamakan
  [43, 103, 4, 12, 0.8], // Gobi
  [45, 62, 5, 14, 0.55], // the Kazakh steppe
  [-23, 19, 6, 7, 0.8], // Kalahari and Namib
  [-25, 132, 8, 15, 0.95], // the Australian interior
  [-23, -69.5, 8, 2.2, 0.95], // Atacama
  [-44, -69, 6, 4, 0.55], // Patagonia
  [35, -113, 5, 7, 0.75], // the American southwest
  [28, -105, 4, 4, 0.6], // Chihuahua
  [8, 45, 4, 6, 0.6], // the Horn of Africa
];

function paintDryness(width: number, height: number): Uint8ClampedArray {
  const [, ctx] = canvas(width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';

  for (const [lat, lon, rLat, rLon, strength] of DRY_REGIONS) {
    const x = ((lon + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    const rx = (rLon / 360) * width;
    const ry = (rLat / 180) * height;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const v = Math.round(255 * strength);
    g.addColorStop(0, `rgb(${v},${v},${v})`);
    g.addColorStop(0.55, `rgb(${Math.round(v * 0.85)},${Math.round(v * 0.85)},${Math.round(v * 0.85)})`);
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return ctx.getImageData(0, 0, width, height).data;
}

function loadElevation(width: number, height: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const [, ctx] = canvas(width, height);
      ctx.drawImage(image, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height).data);
    };
    // Flat continents are a fine fallback; a blank screen is not.
    image.onerror = () => resolve(null);
    image.src = ELEVATION_URL;
  });
}

// --- assembly -----------------------------------------------------------------

function dataTexture(data: Uint8Array, width: number, height: number, format: THREE.PixelFormat): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height, format, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

async function build(): Promise<Terrain> {
  const W = TERRAIN_WIDTH;
  const H = TERRAIN_HEIGHT;

  const elevationPromise = loadElevation(W, H);

  const landMask = paintLand(W, H);
  const shelf = blurred(landMask, W, H, 4);
  const ocean = blurred(landMask, W, H, 16);
  const dryness = paintDryness(W, H);
  const borderLines = paintBorders(W, H);
  const elevation = await elevationPromise;

  const packed = new Uint8Array(W * H * 4);
  const borders = new Uint8Array(W * H);

  // Rows are flipped on the way in: images start at the north pole, textures
  // at v = 0, which on this sphere is the south pole.
  for (let y = 0; y < H; y++) {
    const src = y * W;
    const dst = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) {
      const s = (src + x) * 4;
      const d = (dst + x) * 4;
      const isLand = landMask[s];
      packed[d] = elevation && isLand > 40 ? elevation[s] : 0;
      packed[d + 1] = isLand;
      packed[d + 2] = Math.round(shelf[s] * 0.6 + ocean[s] * 0.4);
      packed[d + 3] = dryness[s];
      borders[dst + x] = borderLines[s];
    }
  }

  const texture = dataTexture(packed, W, H, THREE.RGBAFormat);
  const borderTexture = dataTexture(borders, W, H, THREE.RedFormat);

  const sample = (lat: number, lon: number, out: GroundSample = { elevation: 0, land: 0, coast: 0, dryness: 0 }) => {
    // Bilinear, to match what the GPU's filtering returns.
    const u = ((((lon + 180) / 360) % 1) + 1) % 1;
    const v = THREE.MathUtils.clamp((lat + 90) / 180, 0, 1);
    const fx = u * W - 0.5;
    const fy = v * H - 0.5;
    const x0 = Math.floor(fx);
    const y0 = THREE.MathUtils.clamp(Math.floor(fy), 0, H - 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const tx = fx - x0;
    const ty = THREE.MathUtils.clamp(fy - y0, 0, 1);
    const xa = ((x0 % W) + W) % W;
    const xb = (xa + 1) % W;

    const at = (x: number, y: number, c: number) => packed[(y * W + x) * 4 + c];
    const mix = (c: number) =>
      ((at(xa, y0, c) * (1 - tx) + at(xb, y0, c) * tx) * (1 - ty) +
        (at(xa, y1, c) * (1 - tx) + at(xb, y1, c) * tx) * ty) /
      255;

    out.elevation = mix(0);
    out.land = mix(1);
    out.coast = mix(2);
    out.dryness = mix(3);
    return out;
  };

  const scratch: GroundSample = { elevation: 0, land: 0, coast: 0, dryness: 0 };
  const groundRadius = (lat: number, lon: number) => {
    const s = sample(lat, lon, scratch);
    return groundRadiusFor(s.elevation, s.land);
  };

  const surfaceRadius = (lat: number, lon: number) => Math.max(1.0004, groundRadius(lat, lon));

  return { texture, borders: borderTexture, sample, groundRadius, surfaceRadius };
}

let pending: Promise<Terrain> | null = null;

/** The terrain, built on first request and shared after that. */
export function loadTerrain(): Promise<Terrain> {
  if (!pending) {
    pending = build().catch((error) => {
      // Let a later mount try again rather than caching a failure forever.
      pending = null;
      throw error;
    });
  }
  return pending;
}
