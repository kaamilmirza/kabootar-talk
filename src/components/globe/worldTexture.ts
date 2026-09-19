'use client';

/**
 * Paints the world map onto a canvas, once, for use as a globe texture.
 *
 * Drawing real coastlines as 3D geometry means triangulating spherical
 * polygons and subdividing every edge so it does not cut through the planet —
 * hundreds of draw calls and a lot of maths for something that is, in the end,
 * a picture. Painting it into one equirectangular canvas instead gives real
 * Natural Earth borders in a single texture and a single draw call, which is
 * what keeps this smooth on a phone.
 *
 * Geometry is Natural Earth 1:110m, bundled via `world-atlas` — about 100 KB,
 * no network request, and no third party learning which part of the world
 * anyone is looking at.
 */

import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import * as THREE from 'three';
import topology from 'world-atlas/countries-110m.json';

/** 2:1, as an equirectangular projection must be. */
const WIDTH = 2048;
const HEIGHT = 1024;

const PALETTE = {
  ocean: '#1cb0f6',
  oceanDeep: '#1899d6',
  land: '#7ad63f',
  landShore: '#58cc02',
  border: '#ffffff',
  ice: '#f2fbff',
};

/**
 * The shape of the bundled topology, narrowed by hand.
 *
 * topojson-client's own types are generic over a topology it cannot infer from
 * a plain JSON import, so this describes only the two fields used here.
 */
type WorldTopology = Parameters<typeof feature>[0] & {
  objects: { countries: Parameters<typeof feature>[1] };
};

let cached: THREE.CanvasTexture | null = null;

/**
 * Longitudes as drawn are continuous, not wrapped.
 *
 * A country that crosses the antimeridian — Russia, Fiji — has points that
 * jump from +179 to -179. Drawn literally, that jump smears a stripe across
 * the whole map. Unwrapping keeps each ring continuous, and the ring is then
 * drawn three times, one screen-width apart, so whichever copy lands inside
 * the canvas is the correct one.
 */
function unwrapRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  let offset = 0;

  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];

    if (i > 0) {
      const previous = ring[i - 1][0];
      const delta = lon - previous;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }

    out.push([lon + offset, lat]);
  }

  return out;
}

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  rings: Position[][],
  lonShift: number,
): void {
  ctx.beginPath();

  for (const ring of rings) {
    const unwrapped = unwrapRing(ring);

    for (let i = 0; i < unwrapped.length; i++) {
      const [lon, lat] = unwrapped[i];
      const x = ((lon + lonShift + 180) / 360) * WIDTH;
      const y = ((90 - lat) / 180) * HEIGHT;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
  }
}

export function worldTexture(): THREE.CanvasTexture {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const ctx = canvas.getContext('2d')!;

  // Ocean, with a little more depth towards the poles so the globe does not
  // read as one flat disc of blue.
  const sea = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sea.addColorStop(0, PALETTE.oceanDeep);
  sea.addColorStop(0.5, PALETTE.ocean);
  sea.addColorStop(1, PALETTE.oceanDeep);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const world = topology as unknown as WorldTopology;
  const countries = feature(world, world.objects.countries) as unknown as FeatureCollection<
    Polygon | MultiPolygon
  >;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Two passes so borders sit on top of every landmass, not just their own.
  for (const pass of ['fill', 'stroke'] as const) {
    for (const country of countries.features) {
      const geometry = country.geometry;
      const polygons: Position[][][] =
        geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

      for (const rings of polygons) {
        for (const shift of [-360, 0, 360]) {
          tracePolygon(ctx, rings, shift);

          if (pass === 'fill') {
            ctx.fillStyle = PALETTE.land;
            ctx.fill('evenodd');
            // A darker shore line gives the coast some weight.
            ctx.strokeStyle = PALETTE.landShore;
            ctx.lineWidth = 3;
            ctx.stroke();
          } else {
            ctx.strokeStyle = PALETTE.border;
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.75;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
    }
  }

  // The ice caps. Natural Earth stops at Antarctica's coast and says nothing
  // at all about Arctic sea ice, so both are painted in by hand.
  //
  // Faded rather than filled flat: a hard-edged band in UV space wraps onto
  // the sphere as a conspicuous white disc sitting on top of the pole, which
  // reads as a rendering fault rather than as ice.
  const capDepth = HEIGHT * 0.13;

  const arctic = ctx.createLinearGradient(0, 0, 0, capDepth);
  arctic.addColorStop(0, 'rgba(242, 251, 255, 0.95)');
  arctic.addColorStop(0.45, 'rgba(242, 251, 255, 0.55)');
  arctic.addColorStop(1, 'rgba(242, 251, 255, 0)');
  ctx.fillStyle = arctic;
  ctx.fillRect(0, 0, WIDTH, capDepth);

  const antarctic = ctx.createLinearGradient(0, HEIGHT, 0, HEIGHT - capDepth);
  antarctic.addColorStop(0, 'rgba(242, 251, 255, 0.95)');
  antarctic.addColorStop(0.45, 'rgba(242, 251, 255, 0.6)');
  antarctic.addColorStop(1, 'rgba(242, 251, 255, 0)');
  ctx.fillStyle = antarctic;
  ctx.fillRect(0, HEIGHT - capDepth, WIDTH, capDepth);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  cached = texture;
  return texture;
}
