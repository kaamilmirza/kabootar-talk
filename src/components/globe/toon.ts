/**
 * One toon material for every small solid thing on the planet.
 *
 * Lit by the real sun, in the same three bands as the ground, and darkened on
 * the night side the same way — so a pigeon over Siberia at 3am is in the
 * dark with the land beneath her, rather than floating in her own daylight.
 * Using three.js's lights instead would mean keeping a second idea of where
 * the sun is in step with the planet's shader.
 *
 * Works on plain meshes and instanced ones; three sets the right defines.
 */

import * as THREE from 'three';

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  /** Multiply by the geometry's own vertex colours. */
  vertexColors?: boolean;
  /**
   * Instanced foliage: `aLeaf` = 1 takes the instance colour, 0 keeps the
   * geometry's colour, so a trunk stays brown under a green canopy.
   */
  foliage?: boolean;
  /** Lit windows on the night side, from the geometry's UVs. */
  windows?: boolean;
  /** How visible it stays at night, 0..1. Birds and nests stay findable. */
  nightFloor?: number;
  /** A darker rim at the silhouette, for objects too small for real outlines. */
  rim?: number;
  /** Shift towards a sheen colour by view angle, for a pigeon's neck. */
  iridescent?: boolean;
}

export function toonMaterial(options: ToonOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (options.foliage) defines.FOLIAGE = '';
  if (options.windows) defines.WINDOWS = '';
  if (options.iridescent) defines.IRIDESCENT = '';

  return new THREE.ShaderMaterial({
    defines,
    vertexColors: options.vertexColors ?? false,
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? '#ffffff') },
      uSun: { value: TOON_SUN },
      uNightFloor: { value: options.nightFloor ?? 0.25 },
      uRim: { value: options.rim ?? 0.35 },
    },
    vertexShader: /* glsl */ `
      #ifdef FOLIAGE
        attribute float aLeaf;
      #endif
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vTint;
      varying vec2 vUv;

      void main() {
        vec3 tint = vec3(1.0);
        #ifdef USE_COLOR
          tint *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          #ifdef FOLIAGE
            tint = mix(tint, instanceColor, aLeaf);
          #else
            tint *= instanceColor;
          #endif
        #endif
        vTint = tint;
        vUv = uv;

        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vNormal = normalize(mat3(m) * normal);
        vec4 world = m * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSun;
      uniform float uNightFloor;
      uniform float uRim;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vTint;
      varying vec2 vUv;

      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 c = uColor * vTint;
        vec3 viewDir = normalize(cameraPosition - vWorld);

        #ifdef IRIDESCENT
          float f = pow(1.0 - abs(dot(n, viewDir)), 1.4);
          c = mix(c, vec3(0.66, 0.42, 0.88), smoothstep(0.25, 0.8, f));
        #endif

        float l = dot(n, uSun);
        float band = 0.68 + 0.17 * smoothstep(0.02, 0.08, l) + 0.15 * smoothstep(0.5, 0.56, l);

        float here = dot(normalize(vWorld), uSun);
        float day = smoothstep(-0.14, 0.06, here);
        vec3 lit = c * band;
        vec3 night = c * mix(0.22, 0.75, uNightFloor) + vec3(0.04, 0.06, 0.16) * (1.0 - uNightFloor);
        vec3 col = mix(night, lit, day);

        #ifdef WINDOWS
          // A grid of windows on the walls, a few of them dark.
          vec2 g = fract(vUv * vec2(3.0, 5.0));
          float pane = step(0.3, g.x) * step(g.x, 0.7) * step(0.3, g.y) * step(g.y, 0.75);
          vec2 cell = floor(vUv * vec2(3.0, 5.0));
          float on = step(0.35, fract(sin(dot(cell + floor(vWorld.xz * 900.0), vec2(12.9898, 78.233))) * 43758.5453));
          float wall = 1.0 - step(0.9, abs(n.y));
          col += vec3(1.0, 0.78, 0.38) * pane * on * wall * (1.0 - day) * 0.9;
        #endif

        float edge = 1.0 - smoothstep(0.0, 0.35, abs(dot(n, viewDir)));
        col = mix(col, col * 0.35, edge * uRim);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * The sun, shared by reference with every toon material.
 *
 * One Vector3 that every material's uniform points at, updated once a frame
 * by the scene. Cheaper and simpler than walking every material to copy it.
 */
export const TOON_SUN = new THREE.Vector3(0, 0, 1);
