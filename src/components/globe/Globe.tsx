'use client';

/**
 * The planet, the route, and the bird on it.
 *
 * Performance note, because it shapes everything below: React does not drive
 * this scene. The first version re-rendered the whole tree once a second and
 * pushed new props into three.js, which meant reconciliation, fresh geometry
 * and new Vector3s every tick — visibly stuttery on a phone. Now React renders
 * once, and every frame after that is imperative work on objects that already
 * exist. Nothing in the animation loop allocates.
 *
 * The map is real Natural Earth geometry painted into a single texture. See
 * `worldTexture.ts` for why that beats drawing coastlines as geometry.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { interpolate, toVector3, type LatLon } from '@/lib/flight/geo';
import { positionAt, type Itinerary } from '@/lib/flight/schedule';
import type { FlightMood } from '@/lib/flight/states';

import { Beacons, type Beacon } from './Beacons';
import { Pigeon, type PigeonHandle } from './Pigeon';
import { worldTexture } from './worldTexture';

const GLOBE_RADIUS = 1;
const ARC_LIFT = 0.17;
/** Points along the route. Enough to look smooth, few enough to be free. */
const ROUTE_STEPS = 160;

// --- scratch objects --------------------------------------------------------
// Reused every frame so the animation loop never allocates.
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _side = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _basis = new THREE.Matrix4();

function surfaceVector(p: LatLon, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const [x, y, z] = toVector3(p, radius);
  return out.set(x, y, z);
}

// --- the sun ----------------------------------------------------------------

/** Where the sun is overhead. Low precision, which is ample for shading. */
function subsolarPoint(atMs: number): LatLon {
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

// --- the planet -------------------------------------------------------------

/**
 * One shader for the whole planet: the map texture, a soft day/night wash and
 * a warm terminator. Doing it here rather than with three's lighting keeps it
 * to a single cheap pass and keeps the flat, bright look the app has elsewhere.
 */
function Planet({ sunRef }: { sunRef: React.RefObject<THREE.Vector3> }) {
  const texture = useMemo(() => worldTexture(), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uSun: { value: new THREE.Vector3(0, 0, 1) },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          void main() {
            vUv = uv;
            vNormal = normalize(normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform vec3 uSun;
          varying vec2 vUv;
          varying vec3 vNormal;

          void main() {
            vec3 base = texture2D(uMap, vUv).rgb;
            float sun = dot(normalize(vNormal), normalize(uSun));

            // Night is a deep blue wash over the same map, never black: the
            // point of this screen is seeing where the bird is, at 3am too.
            vec3 night = mix(base * 0.45, vec3(0.09, 0.13, 0.32), 0.5);
            vec3 color = mix(night, base, smoothstep(-0.25, 0.22, sun));

            // A warm band along the terminator, where the bird flies into dusk.
            float dusk = 1.0 - smoothstep(0.0, 0.3, abs(sun));
            color = mix(color, vec3(1.0, 0.72, 0.42), dusk * 0.26);

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    [texture],
  );

  useFrame(() => {
    if (sunRef.current) material.uniforms.uSun.value.copy(sunRef.current);
  });

  return (
    <mesh material={material}>
      <sphereGeometry args={[GLOBE_RADIUS, 64, 48]} />
    </mesh>
  );
}

/** A soft halo, so the planet sits in air rather than being cut out of the page. */
function Halo() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color('#9fe0ff') } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            float rim = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
            gl_FragColor = vec4(uColor, clamp(rim, 0.0, 1.0) * 0.9);
          }
        `,
      }),
    [],
  );

  return (
    <mesh material={material} scale={1.16}>
      <sphereGeometry args={[GLOBE_RADIUS, 32, 24]} />
    </mesh>
  );
}

// --- the route --------------------------------------------------------------

function routePositions(from: LatLon, to: LatLon): Float32Array {
  const array = new Float32Array((ROUTE_STEPS + 1) * 3);
  const scratch = new THREE.Vector3();

  for (let i = 0; i <= ROUTE_STEPS; i++) {
    const t = i / ROUTE_STEPS;
    const lift = GLOBE_RADIUS + ARC_LIFT * Math.sin(Math.PI * t) + 0.006;
    surfaceVector(interpolate(from, to, t), lift, scratch);
    array[i * 3] = scratch.x;
    array[i * 3 + 1] = scratch.y;
    array[i * 3 + 2] = scratch.z;
  }

  return array;
}

/**
 * The flight path: the whole route in faint white, and the flown part in amber
 * over the same vertices.
 *
 * The flown part is animated with `setDrawRange`, which moves one integer.
 * Rebuilding the line's geometry each second — the obvious approach — uploads
 * a fresh vertex buffer to the GPU every tick for no reason.
 */
function Route({
  from,
  to,
  progressRef,
}: {
  from: LatLon;
  to: LatLon;
  progressRef: React.RefObject<number>;
}) {
  // Built as plain three.js objects and mounted with <primitive>. R3F does
  // expose a <line> element, but its JSX type collides with SVG's <line>,
  // which makes the typed version unusable here.
  const { full, flown, flownGeometry } = useMemo(() => {
    const positions = routePositions(from, to);

    const fullGeometry = new THREE.BufferGeometry();
    fullGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const partial = new THREE.BufferGeometry();
    partial.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    partial.setDrawRange(0, 2);

    return {
      full: new THREE.Line(
        fullGeometry,
        new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }),
      ),
      flown: new THREE.Line(partial, new THREE.LineBasicMaterial({ color: '#ffc800' })),
      flownGeometry: partial,
    };
  }, [from, to]);

  useEffect(
    () => () => {
      full.geometry.dispose();
      (full.material as THREE.Material).dispose();
      flown.geometry.dispose();
      (flown.material as THREE.Material).dispose();
    },
    [full, flown],
  );

  useFrame(() => {
    flownGeometry.setDrawRange(
      0,
      Math.max(2, Math.ceil((progressRef.current ?? 0) * ROUTE_STEPS) + 1),
    );
  });

  return (
    <>
      <primitive object={full} />
      <primitive object={flown} />
    </>
  );
}

/** A nest on the surface, with a ring breathing out of it. */
function Nest({ at, color }: { at: LatLon; color: string }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);

  const anchor = useMemo(() => surfaceVector(at, GLOBE_RADIUS + 0.014, new THREE.Vector3()), [at]);

  // Orientation never changes, so it is set once rather than every frame.
  useEffect(() => {
    if (!group.current) return;
    group.current.position.copy(anchor);
    group.current.lookAt(0, 0, 0);
  }, [anchor]);

  useFrame(({ clock }) => {
    if (!ring.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.8) * 0.35;
    ring.current.scale.setScalar(pulse);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 / pulse;
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.024, 12, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.034, 0.05, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// --- camera -----------------------------------------------------------------

/** Pull back far enough that globe and arc fit whatever shape the canvas is. */
function FitCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const aspect = size.width / size.height;
    const needed = GLOBE_RADIUS + ARC_LIFT + 0.18;

    camera.position.setZ(
      THREE.MathUtils.clamp(needed / Math.tan(halfFov) / Math.min(1, aspect), 3.1, 9),
    );
    camera.updateProjectionMatrix();
  }, [camera, size]);

  return null;
}

// --- the scene --------------------------------------------------------------

export interface GlobeSceneProps {
  itinerary: Itinerary;
  /** Server-corrected time. Called every frame, so it must be cheap. */
  getNow: () => number;
  /** Fires only when the bird's mood actually changes, not every frame. */
  onMoodChange?: (mood: FlightMood) => void;
  /** Cities other people send from. One draw call; safe to leave on. */
  beacons?: Beacon[];
}

export function GlobeScene({ itinerary, getNow, onMoodChange, beacons }: GlobeSceneProps) {
  const world = useRef<THREE.Group>(null);
  const bird = useRef<THREE.Group>(null);
  const pigeon = useRef<PigeonHandle>(null);

  const progressRef = useRef(0);
  const sunRef = useRef(new THREE.Vector3(0, 0, 1));
  const moodRef = useRef<FlightMood | null>(null);

  const { from, to } = itinerary;

  useFrame((_, delta) => {
    const nowMs = getNow();
    // positionAt, never statusAt: this runs every frame.
    const status = positionAt(itinerary, nowMs);

    progressRef.current = status.progress;

    if (status.mood !== moodRef.current) {
      moodRef.current = status.mood;
      pigeon.current?.setMood(status.mood);
      onMoodChange?.(status.mood);
    }

    // --- place the bird ----------------------------------------------------
    if (bird.current) {
      const altitude = 0.028 + ARC_LIFT * Math.sin(Math.PI * status.progress);
      surfaceVector(status.position, GLOBE_RADIUS + altitude, _anchor);
      surfaceVector(
        interpolate(from, to, Math.min(1, status.progress + 0.01)),
        GLOBE_RADIUS + altitude,
        _ahead,
      );

      _up.copy(_anchor).normalize();
      _forward.copy(_ahead).sub(_anchor).projectOnPlane(_up);

      if (_forward.lengthSq() < 1e-10) _forward.set(0, 1, 0).projectOnPlane(_up);
      _forward.normalize();

      _side.crossVectors(_up, _forward).normalize();
      _basis.makeBasis(_side, _up, _forward);

      bird.current.position.copy(_anchor);
      bird.current.quaternion.setFromRotationMatrix(_basis);
    }

    // --- turn the planet to follow ----------------------------------------
    if (world.current) {
      surfaceVector(status.position, 1, _up).normalize();

      const wantY = -Math.atan2(_up.x, _up.z);
      // Most of the way to the bird's latitude, but not all: tilting fully for
      // an Arctic crossing puts the camera over the pole, where the planet
      // stops reading as a planet.
      const wantX = THREE.MathUtils.clamp(
        Math.asin(THREE.MathUtils.clamp(_up.y, -1, 1)) * 0.8,
        -Math.PI / 3.4,
        Math.PI / 3.4,
      );

      const ease = Math.min(1, delta * 2.4);

      let dy = ((wantY - world.current.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (dy < -Math.PI) dy += Math.PI * 2;

      world.current.rotation.y += dy * ease;
      world.current.rotation.x += (wantX - world.current.rotation.x) * ease;
    }

    surfaceVector(subsolarPoint(nowMs), 1, sunRef.current).normalize();
  });

  return (
    <>
      <FitCamera />

      <group ref={world}>
        <Planet sunRef={sunRef} />
        <Halo />
        {beacons && beacons.length > 0 ? <Beacons cities={beacons} /> : null}
        <Route from={from} to={to} progressRef={progressRef} />

        <Nest at={from} color="#ffc800" />
        <Nest at={to} color="#ff4b4b" />

        <group ref={bird}>
          {/*
            A marker on the surface beneath her. Seen from directly above — the
            angle the camera settles into while it follows her — a bird is a
            small grey cross, and at map scale that is genuinely hard to find.
            The disc gives the eye something to land on first.
          */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
            <circleGeometry args={[0.055, 24]} />
            <meshBasicMaterial color="#ffc800" transparent opacity={0.3} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.011, 0]}>
            <ringGeometry args={[0.055, 0.07, 28]} />
            <meshBasicMaterial color="#ffc800" transparent opacity={0.6} />
          </mesh>

          <Pigeon ref={pigeon} scale={0.145} />
        </group>
      </group>
    </>
  );
}
