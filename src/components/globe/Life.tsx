'use client';

/**
 * Forests, towns and city lights: the detail that rewards zooming in.
 *
 * Every tree on the planet is an instance of one of three meshes, and every
 * building an instance of one box, so all of it costs a handful of draw calls.
 * Placement reads the same terrain the ground is drawn from — conifers in the
 * north and up mountainsides, palms along tropical coasts, nothing on ice or
 * in the Sahara — and is seeded, so the same forest is in the same place on
 * every visit.
 *
 * The towns sit on the cities this app already knows, the ones a person can
 * choose as a nest, so the pigeon's departure and arrival look inhabited.
 *
 * Trees and buildings are hidden when the camera is far away. From orbit
 * they are sub-pixel and would cost the GPU for nothing.
 */

import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { CITIES } from '@/lib/cities';

import { setUniform, setVisible } from './mutate';
import { fbm3, randomDirection, rng, surfaceVector, tangentFrame, toLatLon } from './math';
import type { GlobeStore } from './store';
import type { Terrain } from './terrain';
import { toonMaterial } from './toon';

const _dir = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** Below this camera height, forests and towns are drawn. */
const LIFE_ALTITUDE = 1.25;

// --- geometry -------------------------------------------------------------------

/** Merge parts, each tagged as leaf (1) or not (0), into one geometry. */
function part(geometry: THREE.BufferGeometry, leaf: number, color: THREE.ColorRepresentation, y: number) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.translate(0, y, 0);
  const count = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  const leaves = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors.set([c.r, c.g, c.b], i * 3);
    leaves[i] = leaf;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(leaves, 1));
  g.deleteAttribute('uv');
  return g;
}

const TRUNK = '#8a5a3c';

function conifer() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5), 0, TRUNK, 0.15),
    part(new THREE.ConeGeometry(0.34, 0.5, 7), 1, '#ffffff', 0.5),
    part(new THREE.ConeGeometry(0.26, 0.42, 7), 1, '#ffffff', 0.78),
  ])!;
}

function broadleaf() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.06, 0.08, 0.36, 5), 0, TRUNK, 0.18),
    part(new THREE.IcosahedronGeometry(0.36, 0), 1, '#ffffff', 0.62),
    part(new THREE.IcosahedronGeometry(0.22, 0), 1, '#ffffff', 0.86),
  ])!;
}

function palm() {
  const trunk = new THREE.CylinderGeometry(0.035, 0.06, 0.8, 5);
  trunk.rotateZ(0.12);
  const crown = new THREE.ConeGeometry(0.42, 0.16, 6);
  crown.rotateX(Math.PI);
  return mergeGeometries([
    part(trunk, 0, TRUNK, 0.4),
    part(crown, 1, '#ffffff', 0.86),
    part(new THREE.IcosahedronGeometry(0.06, 0), 0, '#7a4a2a', 0.8),
  ])!;
}

// --- forests --------------------------------------------------------------------

type Kind = 'conifer' | 'broadleaf' | 'palm';

interface Tree {
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

const LEAF_COLORS: Record<Kind, string[]> = {
  conifer: ['#2e7d4f', '#357f45', '#2a6e4a', '#3c8c50'],
  broadleaf: ['#58c447', '#4fb33f', '#6fd04a', '#8fd03c', '#46a84a', '#b5d83a'],
  palm: ['#4cc24c', '#3fb35a', '#62cc45'],
};

function plantForests(terrain: Terrain, target: number): Record<Kind, Tree[]> {
  const random = rng(42);
  const out: Record<Kind, Tree[]> = { conifer: [], broadleaf: [], palm: [] };
  let planted = 0;
  let attempts = 0;
  const ground = { elevation: 0, land: 0, coast: 0, dryness: 0 };

  const plant = (lat: number, lon: number, kind: Kind, size: number) => {
    surfaceVector({ lat, lon }, terrain.groundRadius(lat, lon) - 0.0003, _pos);
    _dir.copy(_pos).normalize();
    tangentFrame(_dir, _east, _north);
    _basis.makeBasis(_east, _dir, _north);
    _q.setFromRotationMatrix(_basis);
    _yaw.setFromAxisAngle(_up, random() * Math.PI * 2);
    _q.multiply(_yaw);
    const squat = kind === 'conifer' ? 1.25 : 1;
    _scale.set(size, size * squat, size);

    const palette = LEAF_COLORS[kind];
    out[kind].push({
      matrix: new THREE.Matrix4().compose(_pos, _q, _scale),
      color: new THREE.Color(palette[Math.floor(random() * palette.length)]),
    });
    planted++;
  };

  const suitable = (lat: number, lon: number): Kind | null => {
    terrain.sample(lat, lon, ground);
    const alat = Math.abs(lat);
    if (ground.land < 0.62 || ground.coast < 0.53) return null;
    if (alat > 69 || lat < -56) return null;
    const snowline = THREE.MathUtils.lerp(0.62, 0.1, THREE.MathUtils.smoothstep(alat, 25, 68));
    if (ground.elevation > snowline - 0.14) return null;
    if (ground.dryness > 0.55) return null;
    if (ground.dryness > 0.3 && random() > 0.25) return null;

    if (alat > 47 || ground.elevation > 0.22 || (alat > 36 && random() < 0.35)) return 'conifer';
    if (alat < 22 && ground.coast < 0.78 && random() < 0.6) return 'palm';
    return 'broadleaf';
  };

  while (planted < target && attempts < target * 30) {
    attempts++;
    randomDirection(random(), random(), _dir);
    const forest = fbm3(_dir.x * 7 + 3, _dir.y * 7, _dir.z * 7, 3);
    if (forest < 0.5 && random() > 0.1) continue;

    const { lat, lon } = toLatLon(_dir);
    const kind = suitable(lat, lon);
    if (!kind) continue;

    // A seed tree and a little grove around it: forests, not static.
    const grove = 3 + Math.floor(random() * 7);
    for (let i = 0; i < grove && planted < target; i++) {
      const dLat = (random() - 0.5) * 0.9;
      const dLon = ((random() - 0.5) * 0.9) / Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(lat)));
      const k = i === 0 ? kind : suitable(lat + dLat, lon + dLon);
      if (!k) continue;
      const size = (k === 'conifer' ? 0.0042 : k === 'palm' ? 0.0046 : 0.004) * (0.7 + random() * 0.6);
      plant(lat + (i === 0 ? 0 : dLat), lon + (i === 0 ? 0 : dLon), k, size);
    }
  }

  return out;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, items: Tree[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((item, i) => {
    mesh.setMatrixAt(i, item.matrix);
    mesh.setColorAt(i, item.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The bounding sphere of instances spread round a planet is the planet.
  mesh.frustumCulled = false;
  return mesh;
}

export function Forests({ terrain, count, store }: { terrain: Terrain; count: number; store: GlobeStore }) {
  const group = useRef<THREE.Group>(null);

  const meshes = useMemo(() => {
    const trees = plantForests(terrain, count);
    const material = toonMaterial({ vertexColors: true, foliage: true, rim: 0.25 });
    return [
      instanced(conifer(), material, trees.conifer),
      instanced(broadleaf(), material, trees.broadleaf),
      instanced(palm(), material, trees.palm),
    ];
  }, [terrain, count]);

  useEffect(
    () => () => {
      meshes.forEach((m) => m.geometry.dispose());
      (meshes[0].material as THREE.Material).dispose();
    },
    [meshes],
  );

  useFrame(() => {
    if (group.current) group.current.visible = store.readout.altitude < LIFE_ALTITUDE && store.get().layers.life;
  });

  return (
    <group ref={group}>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}

// --- towns ----------------------------------------------------------------------

const WALLS = ['#fff4e0', '#ffd9c2', '#cfe8ff', '#ffe9a8', '#e6d9ff', '#ffffff', '#ffc9d6', '#d7f5c8'];

function buildTowns(terrain: Terrain) {
  const random = rng(1234);
  const buildings: Tree[] = [];

  for (const city of CITIES) {
    const n = 14 + Math.floor(random() * 20);
    const cosLat = Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(city.lat)));

    for (let i = 0; i < n; i++) {
      // Dense in the middle, spreading out: a downtown and its suburbs.
      const r = Math.pow(random(), 1.6) * 0.42;
      const a = random() * Math.PI * 2;
      const lat = city.lat + r * Math.sin(a);
      const lon = city.lon + (r * Math.cos(a)) / cosLat;

      const ground = terrain.sample(lat, lon);
      if (ground.land < 0.55) continue;

      surfaceVector({ lat, lon }, terrain.groundRadius(lat, lon) - 0.0002, _pos);
      _dir.copy(_pos).normalize();
      tangentFrame(_dir, _east, _north);
      _basis.makeBasis(_east, _dir, _north);
      _q.setFromRotationMatrix(_basis);
      _yaw.setFromAxisAngle(_up, random() * Math.PI);
      _q.multiply(_yaw);

      const downtown = 1 - r / 0.42;
      const height = 0.0007 + Math.pow(random(), 2) * 0.0036 * (0.3 + downtown);
      const width = 0.0006 + random() * 0.0007;
      _scale.set(width, height, width * (0.7 + random() * 0.6));

      buildings.push({
        matrix: new THREE.Matrix4().compose(_pos, _q, _scale),
        color: new THREE.Color(WALLS[Math.floor(random() * WALLS.length)]),
      });
    }
  }

  return buildings;
}

export function Towns({ terrain, store }: { terrain: Terrain; store: GlobeStore }) {
  const mesh = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    return instanced(box, toonMaterial({ windows: true, rim: 0.3 }), buildTowns(terrain));
  }, [terrain]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  useFrame(() => {
    setVisible(mesh, store.readout.altitude < LIFE_ALTITUDE && store.get().layers.life);
  });

  return <primitive object={mesh} />;
}

/**
 * City lights, visible only on the night side.
 *
 * Points rather than geometry, so they stay a few pixels across at any
 * distance: from orbit the night side shows where people are, the way the
 * real photographs do.
 */
export function CityLights({ terrain, sun }: { terrain: Terrain; sun: React.RefObject<THREE.Vector3> }) {
  const { geometry, material } = useMemo(() => {
    const random = rng(99);
    const positions: number[] = [];
    const sizes: number[] = [];

    for (const city of CITIES) {
      const cosLat = Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(city.lat)));
      const n = 30 + Math.floor(random() * 40);
      for (let i = 0; i < n; i++) {
        // Gaussian-ish spread, with a few long fingers along "roads".
        const spoke = Math.floor(random() * 5) * ((Math.PI * 2) / 5) + random() * 0.3;
        const r = i < n * 0.6 ? Math.abs(random() + random() - 1) * 0.9 : random() * 1.8;
        const a = i < n * 0.6 ? random() * Math.PI * 2 : spoke;
        const lat = city.lat + r * Math.sin(a);
        const lon = city.lon + (r * Math.cos(a)) / cosLat;
        if (terrain.sample(lat, lon).land < 0.5) continue;
        surfaceVector({ lat, lon }, terrain.groundRadius(lat, lon) + 0.0015, _pos);
        positions.push(_pos.x, _pos.y, _pos.z);
        sizes.push(1.5 + random() * (i < 4 ? 4 : 2.2));
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSun: { value: new THREE.Vector3(0, 0, 1) }, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform vec3 uSun;
        uniform float uPixelRatio;
        varying float vNight;
        void main() {
          vec3 n = normalize(position);
          vNight = 1.0 - smoothstep(-0.12, 0.04, dot(n, uSun));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * clamp(2.2 / -mv.z, 0.8, 3.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vNight;
        void main() {
          if (vNight < 0.01) discard;
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float glow = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * glow, glow * vNight);
        }
      `,
    });

    return { geometry: g, material: m };
  }, [terrain]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ gl }) => {
    if (sun.current) material.uniforms.uSun.value.copy(sun.current);
    setUniform(material, 'uPixelRatio', gl.getPixelRatio());
  });

  // Depth-tested, so the planet hides the lights on its far side.
  return <points geometry={geometry} material={material} />;
}

