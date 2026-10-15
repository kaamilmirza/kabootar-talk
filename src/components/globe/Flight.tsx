'use client';

/**
 * One letter's journey, drawn: the bird, her route, and the places on it.
 *
 *   - The route is a tube along the great circle, lifted into an arc. The
 *     part she has flown is solid in her colour, with light running along it
 *     towards her; the part ahead is dashed. One mesh, with progress handled
 *     in the shader, so nothing is rebuilt as she moves.
 *   - Behind her, a trail of puffs, spaced by distance along the route, so a
 *     time-lapse plays out the same trail she really left.
 *   - Beneath her, a shadow on the ground and a dotted ground track, which is
 *     what lets the eye judge how high the arc is.
 *   - Pins where she stops to rest, and a dovecote at each end.
 *
 * Everything is placed from `positionAt`, the same pure function the rest of
 * the app uses, so the bird on the globe is always the bird in the letter.
 */

import { Html, Outlines } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { interpolate } from '@/lib/flight/geo';
import { positionAt, type Leg } from '@/lib/flight/schedule';
import { MOODS } from '@/lib/flight/states';

import { markDirty, setMaterial, setOpacity, setUniform } from './mutate';
import { GLSL_DITHER, routeAngle, routePoint, surfaceVector, tangentFrame } from './math';
import { Pigeon, type PigeonHandle, type PigeonPose } from './Pigeon';
import type { GlobeFlight, GlobeStore } from './store';
import type { Terrain } from './terrain';
import { toonMaterial } from './toon';

const ROUTE_STEPS = 260;
const PUFFS = 26;
/** Degrees of arc between puffs in the trail. */
const PUFF_SPACING_DEG = 0.75;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _side = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/** How big things should be drawn at this distance, so they stay findable. */
function screenScale(distance: number, k: number, min: number, max: number): number {
  return THREE.MathUtils.clamp(distance * k, min, max);
}

/** Orient `object` with +Y along `up` and +Z along `forward`. */
function orient(object: THREE.Object3D, up: THREE.Vector3, forward: THREE.Vector3): void {
  _side.crossVectors(up, forward).normalize();
  const f = _b.crossVectors(_side, up).normalize();
  _basis.makeBasis(_side, up, f);
  object.quaternion.setFromRotationMatrix(_basis);
}

// --- route --------------------------------------------------------------------

function routeMaterial(color: string, glow: boolean) {
  return new THREE.ShaderMaterial({
    transparent: glow,
    depthWrite: !glow,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uProgress: { value: 0 },
      uWidth: { value: 0.002 },
      uTime: { value: 0 },
      uDashes: { value: 60 },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      // World units per pixel at unit distance, times the half-width in pixels.
      uniform float uWidth;
      varying float vT;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vT = uv.x;
        vNormal = normalize(mat3(modelMatrix) * normal);
        // A constant width on screen: thick enough to see from orbit, and
        // not a beam of light when the camera rides right above it.
        vec3 centre = (modelMatrix * vec4(position, 1.0)).xyz;
        float width = uWidth * distance(cameraPosition, centre);
        vec4 world = modelMatrix * vec4(position + normal * width, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uProgress;
      uniform float uTime;
      uniform float uDashes;
      uniform float uDim;
      varying float vT;
      varying vec3 vNormal;
      varying vec3 vWorld;

      void main() {
        bool flown = vT <= uProgress;
        ${
          glow
            ? `
          if (!flown) discard;
          float fade = smoothstep(uProgress - 0.25, uProgress, vT);
          gl_FragColor = vec4(uColor * (0.25 + 0.5 * fade) * uDim, 1.0);
        `
            : `
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float facing = abs(dot(normalize(vNormal), viewDir));
          vec3 c;
          if (flown) {
            // Light running along the flown route, towards the bird.
            float run = smoothstep(0.82, 1.0, fract(vT * uDashes * 0.25 - uTime * 0.7));
            c = mix(uColor, vec3(1.0), run * 0.55);
          } else {
            if (fract((vT - uProgress) * uDashes) > 0.55) discard;
            c = vec3(1.0);
          }
          // Darker edges give the line body, like a drawn stroke.
          c *= 0.62 + 0.38 * smoothstep(0.0, 0.6, facing);
          c = mix(vec3(0.55, 0.6, 0.75), c, uDim);
          gl_FragColor = vec4(c, 1.0);
        `
        }
      }
    `,
  });
}

// --- puffs --------------------------------------------------------------------

function puffMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(0, 0, 1) } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vAlpha = aAlpha;
        mat4 m = modelMatrix * instanceMatrix;
        vNormal = normalize(mat3(m) * normal);
        vec4 world = m * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying float vAlpha;
      varying vec3 vNormal;
      varying vec3 vWorld;
      ${GLSL_DITHER}
      void main() {
        if (vAlpha < gBayer(gl_FragCoord.xy)) discard;
        vec3 n = normalize(vNormal);
        float l = dot(n, uSun);
        vec3 c = l > 0.2 ? vec3(1.0) : vec3(0.82, 0.86, 0.96);
        float day = smoothstep(-0.14, 0.06, dot(normalize(vWorld), uSun));
        c = mix(c * vec3(0.45, 0.5, 0.7), c, day);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float edge = 1.0 - smoothstep(0.1, 0.35, abs(dot(n, viewDir)));
        c = mix(c, vec3(0.5, 0.55, 0.75), edge * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

// --- dovecote -----------------------------------------------------------------

function Dovecote({
  position,
  normal,
  roof,
  label,
  showLabel,
  priority,
  onSelect,
}: {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  roof: string;
  label?: string;
  showLabel: React.RefObject<boolean>;
  /** Which label wins when two would overlap; see the label manager in the HUD. */
  priority: number;
  onSelect: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const tag = useRef<HTMLDivElement>(null);

  const materials = useMemo(
    () => ({
      wall: toonMaterial({ color: '#fffaf0', nightFloor: 0.7 }),
      roof: toonMaterial({ color: roof, nightFloor: 0.8 }),
      hole: toonMaterial({ color: '#2a2f45', nightFloor: 1, rim: 0 }),
      wood: toonMaterial({ color: '#9a6a46', nightFloor: 0.6 }),
      ring: new THREE.MeshBasicMaterial({ color: roof, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    }),
    [roof],
  );

  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  useEffect(() => {
    if (!group.current) return;
    group.current.position.copy(position);
    tangentFrame(normal, _east, _north);
    orient(group.current, normal, _north);
  }, [position, normal]);

  useFrame(({ camera, clock }) => {
    if (!group.current) return;
    const d = camera.position.distanceTo(position);
    group.current.scale.setScalar(screenScale(d, 0.017, 0.0016, 0.016));

    if (ring.current) {
      const pulse = 1 + ((clock.elapsedTime * 0.6) % 1) * 1.6;
      ring.current.scale.setScalar(pulse);
      setOpacity(materials.ring, 0.65 * (1 - (pulse - 1) / 1.6));
    }

    if (tag.current) {
      _toCam.copy(camera.position).sub(position).normalize();
      const want = showLabel.current && _toCam.dot(normal) > 0.05;
      tag.current.dataset.want = want ? '1' : '0';
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group ref={group} onClick={click}>
      <mesh position={[0, 0.3, 0]} material={materials.wood}>
        <cylinderGeometry args={[0.07, 0.09, 0.6, 6]} />
      </mesh>
      <mesh position={[0, 0.95, 0]} material={materials.wall}>
        <cylinderGeometry args={[0.36, 0.36, 0.7, 12]} />
        <Outlines thickness={0.04} color="#1c2540" />
      </mesh>
      <mesh position={[0, 1.52, 0]} material={materials.roof}>
        <coneGeometry args={[0.52, 0.48, 12]} />
        <Outlines thickness={0.04} color="#1c2540" />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => (
        <group key={a} rotation={[0, a, 0]}>
          <mesh position={[0, 1.04, 0.345]} material={materials.hole}>
            <circleGeometry args={[0.1, 14]} />
          </mesh>
          <mesh position={[0, 0.9, 0.4]} rotation={[0, 0, Math.PI / 2]} material={materials.wood}>
            <cylinderGeometry args={[0.025, 0.025, 0.26, 5]} />
          </mesh>
        </group>
      ))}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={materials.ring}>
        <ringGeometry args={[0.55, 0.7, 32]} />
      </mesh>
      {label ? (
        <Html position={[0, 1.9, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={tag} className="globe-tag" data-priority={priority}>
            {label}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

// --- the flight ---------------------------------------------------------------

export interface FlightProps {
  flight: GlobeFlight;
  color: string;
  terrain: Terrain;
  store: GlobeStore;
  sun: React.RefObject<THREE.Vector3>;
  /** Scene time, including any preview offset. Called every frame. */
  time: React.RefObject<number>;
}

export function Flight({ flight, color, terrain, store, sun, time }: FlightProps) {
  const { itinerary } = flight;
  const { from, to } = itinerary;

  const bird = useRef<THREE.Group>(null);
  const pigeon = useRef<PigeonHandle>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const tag = useRef<HTMLDivElement>(null);
  const tagText = useRef<HTMLSpanElement>(null);
  const routeGroup = useRef<THREE.Group>(null);
  const pins = useRef<THREE.Group>(null);
  const track = useRef<THREE.Points>(null);
  const lastMood = useRef<string>('');
  const showNestLabels = useRef(false);
  const lastForward = useRef(new THREE.Vector3(0, 0, 1));

  const angle = useMemo(() => routeAngle(from, to), [from, to]);

  // Her position goes to the store each frame, so the camera can follow her.
  useEffect(() => () => store.untrack(flight.id), [flight.id, store]);

  /** Arc radius, kept clear of mountains near either end. */
  const pointAt = useMemo(() => {
    return (t: number, out: THREE.Vector3, extra = 0) => {
      routePoint(from, to, t, angle, out, extra);
      const p = interpolate(from, to, t);
      const floor = terrain.surfaceRadius(p.lat, p.lon) + 0.003 + extra;
      const len = out.length();
      if (len < floor) out.multiplyScalar(floor / len);
      return out;
    };
  }, [from, to, angle, terrain]);

  // --- static pieces: built once per route ---------------------------------
  const route = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= ROUTE_STEPS; i++) points.push(pointAt(i / ROUTE_STEPS, new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, ROUTE_STEPS, 0.00005, 6, false);

    const line = routeMaterial(color, false);
    const glow = routeMaterial(color, true);
    line.uniforms.uDashes.value = Math.max(12, angle * 0.9);

    // The ground track: dots on the ground directly under the arc.
    const ground: number[] = [];
    const steps = Math.max(30, Math.round(angle * 1.4));
    for (let i = 0; i <= steps; i++) {
      const p = interpolate(from, to, i / steps);
      surfaceVector(p, terrain.surfaceRadius(p.lat, p.lon) + 0.0012, _a);
      ground.push(_a.x, _a.y, _a.z);
    }
    const trackGeometry = new THREE.BufferGeometry();
    trackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ground, 3));
    const trackMaterial = new THREE.PointsMaterial({
      color: new THREE.Color(color).multiplyScalar(0.55),
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    return { geometry, line, glow, trackGeometry, trackMaterial };
  }, [pointAt, color, angle, from, to, terrain]);

  const stops = useMemo(() => {
    return itinerary.legs
      .filter((l): l is Leg => l.kind === 'resting')
      .map((leg) => {
        const p = interpolate(from, to, leg.startFrac);
        const normal = surfaceVector(p, 1, new THREE.Vector3());
        const position = normal.clone().multiplyScalar(terrain.surfaceRadius(p.lat, p.lon));
        return { leg, position, normal };
      });
  }, [itinerary.legs, from, to, terrain]);

  const nests = useMemo(() => {
    const make = (p: { lat: number; lon: number }) => {
      const normal = surfaceVector(p, 1, new THREE.Vector3());
      return { normal, position: normal.clone().multiplyScalar(terrain.surfaceRadius(p.lat, p.lon)) };
    };
    return { from: make(from), to: make(to) };
  }, [from, to, terrain]);

  const puffs = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS), 1);
    alpha.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAlpha', alpha);
    const material = puffMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, PUFFS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return { mesh, alpha, material };
  }, []);

  const pinMaterials = useMemo(
    () => ({
      past: toonMaterial({ color: '#b6c0d4', nightFloor: 0.7 }),
      next: toonMaterial({ color, nightFloor: 0.85 }),
      now: toonMaterial({ color: '#ffffff', nightFloor: 1 }),
      stick: toonMaterial({ color: '#5b6b8c', nightFloor: 0.6 }),
    }),
    [color],
  );

  const shadowMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#0b1a3a', transparent: true, opacity: 0.28, depthWrite: false }),
    [],
  );

  const hitMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );

  useEffect(
    () => () => {
      route.geometry.dispose();
      route.line.dispose();
      route.glow.dispose();
      route.trackGeometry.dispose();
      route.trackMaterial.dispose();
      puffs.mesh.geometry.dispose();
      puffs.material.dispose();
      Object.values(pinMaterials).forEach((m) => m.dispose());
      shadowMaterial.dispose();
      hitMaterial.dispose();
    },
    [route, puffs, pinMaterials, shadowMaterial, hitMaterial],
  );

  // --- every frame ------------------------------------------------------------
  useFrame(({ camera, clock, size }) => {
    const now = time.current ?? Date.now();
    const status = positionAt(itinerary, now);
    const state = store.get();
    const selected = state.selectedId === flight.id;
    const hovered = state.hoveredId === flight.id;
    const anySelected = state.selectedId !== null;
    const dim = anySelected && !selected ? 0.45 : 1;

    const pose: PigeonPose =
      status.phase === 'waiting'
        ? 'waiting'
        : status.phase === 'arrived'
          ? 'arrived'
          : status.leg?.kind === 'resting'
            ? 'resting'
            : 'flying';

    const moodKey = `${status.mood}:${pose}`;
    if (moodKey !== lastMood.current) {
      lastMood.current = moodKey;
      pigeon.current?.setMood(status.mood, pose);
    }

    // --- where she is -------------------------------------------------------
    const t = status.progress;
    if (pose === 'flying') {
      pointAt(t, _a, 0.004);
      pointAt(Math.min(1, t + 0.002), _b, 0.004);
      _b.sub(_a);
      if (t >= 0.998) {
        pointAt(t - 0.002, _b, 0.004);
        _b.subVectors(_a, _b);
      }
    } else {
      const p = pose === 'waiting' ? from : pose === 'arrived' ? to : status.position;
      surfaceVector(p, terrain.surfaceRadius(p.lat, p.lon), _a);
      pointAt(Math.min(1, t + 0.002), _b);
      _b.sub(pointAt(Math.max(0, t - 0.002), _s));
    }

    _n.copy(_a).normalize();
    _b.projectOnPlane(_n);
    if (_b.lengthSq() > 1e-14) lastForward.current.copy(_b).normalize();

    const distance = camera.position.distanceTo(_a);
    const scale = screenScale(distance, 0.11, 0.0032, 0.045) * (selected ? 1.12 : anySelected ? 0.85 : 1);

    if (bird.current) {
      bird.current.position.copy(_a);
      // Standing birds sit on their feet, not their belly.
      if (pose !== 'flying') bird.current.position.addScaledVector(_n, 0.39 * scale);
      orient(bird.current, _n, lastForward.current);
      bird.current.scale.setScalar(scale);
    }

    store.track(flight.id, bird.current?.position ?? _a, lastForward.current);

    // --- her shadow ---------------------------------------------------------
    if (shadow.current) {
      const ll = status.position;
      const ground = terrain.surfaceRadius(ll.lat, ll.lon);
      const height = Math.max(0, _a.length() - ground);
      shadow.current.visible = pose === 'flying';
      shadow.current.position.copy(_n).multiplyScalar(ground + 0.0009);
      orient(shadow.current, _n, lastForward.current);
      const blur = 1 + height * 12;
      shadow.current.scale.setScalar(scale * 0.55 * blur);
      setOpacity(shadowMaterial, 0.3 / blur);
    }

    // --- route --------------------------------------------------------------
    const showRoutes = state.layers.routes;
    if (routeGroup.current) routeGroup.current.visible = showRoutes;
    // Half-width in pixels, converted to world units per unit of distance.
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 40);
    const perPixel = (2 * Math.tan(fov / 2)) / Math.max(1, size.height);
    const width = perPixel * (selected ? 2.2 : 1.6);
    setUniform(route.line, 'uProgress', t);
    setUniform(route.line, 'uWidth', width);
    setUniform(route.line, 'uTime', clock.elapsedTime);
    setUniform(route.line, 'uDim', dim);
    setUniform(route.glow, 'uProgress', t);
    setUniform(route.glow, 'uWidth', width * 3);
    setUniform(route.glow, 'uDim', selected || !anySelected ? 1 : 0.3);
    if (track.current) track.current.visible = showRoutes && (selected || !anySelected);

    // --- puff trail ---------------------------------------------------------
    const flying = pose === 'flying';
    const step = PUFF_SPACING_DEG / Math.max(angle, 1);
    const drift = (clock.elapsedTime * 1.4) % 1;
    for (let i = 0; i < PUFFS; i++) {
      const at = t - (i + drift) * step;
      const age = (i + drift) / PUFFS;
      if (!flying || at <= 0 || !showRoutes) {
        _m.makeScale(0, 0, 0);
        puffs.mesh.setMatrixAt(i, _m);
        puffs.alpha.setX(i, 0);
        continue;
      }
      pointAt(at, _s, 0.004);
      const puff = scale * (0.08 + age * 0.26);
      _m.compose(_s, _q.identity(), _b.set(puff, puff, puff));
      puffs.mesh.setMatrixAt(i, _m);
      // Thinned out right in front of the camera, so riding along is not
      // like flying through her exhaust.
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(_s), scale * 2, scale * 7);
      puffs.alpha.setX(i, (1 - age) * (0.85 * dim + 0.15) * near);
    }
    markDirty(puffs.mesh.instanceMatrix);
    markDirty(puffs.alpha);
    if (sun.current) puffs.material.uniforms.uSun.value.copy(sun.current);

    // --- rest stops ---------------------------------------------------------
    if (pins.current) {
      pins.current.visible = showRoutes && (selected || !anySelected);
      pins.current.children.forEach((pin, i) => {
        const stop = stops[i];
        if (!stop) return;
        const d = camera.position.distanceTo(stop.position);
        pin.scale.setScalar(screenScale(d, 0.012, 0.0011, 0.011));
        const head = pin.children[1] as THREE.Mesh | undefined;
        if (head) {
          const resting = status.leg === stop.leg;
          const done = now >= stop.leg.endMs;
          setMaterial(head, resting ? pinMaterials.now : done ? pinMaterials.past : pinMaterials.next);
          head.scale.setScalar(resting ? 1 + Math.sin(clock.elapsedTime * 4) * 0.15 : 1);
        }
      });
    }

    // --- labels -------------------------------------------------------------
    const labelsOn = state.layers.labels;
    // Ends of the route are named only for the bird being watched, and only
    // once close enough that the names have room.
    showNestLabels.current = labelsOn && selected && store.readout.altitude < 1.6;
    if (tag.current) {
      _toCam.copy(camera.position).sub(_a).normalize();
      const facing = _toCam.dot(_n) > -0.05;
      const want = labelsOn && facing && (selected || hovered || !anySelected);
      tag.current.dataset.want = want ? '1' : '0';
      tag.current.dataset.priority = selected ? '100' : hovered ? '90' : '30';
      tag.current.dataset.active = selected ? 'true' : 'false';
    }
    if (tagText.current) {
      // Just her name, unless she is the one being watched.
      const mood = MOODS[status.mood];
      const text = !selected
        ? flight.name
        : pose === 'arrived'
          ? `${flight.name} · delivered ✉️`
          : pose === 'waiting'
            ? `${flight.name} · waiting`
            : `${flight.name} · ${mood.emoji} ${mood.label.toLowerCase()}`;
      if (tagText.current.textContent !== text) tagText.current.textContent = text;
    }
  });

  // --- interaction ------------------------------------------------------------
  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (store.readout.dragged) return;
    const s = store.get();
    // A second tap on the bird you are already following hops aboard.
    const mode = s.selectedId === flight.id && s.mode === 'follow' ? 'ride' : 'follow';
    store.set({ selectedId: flight.id, mode });
  };

  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    store.set({ hoveredId: on ? flight.id : store.get().hoveredId === flight.id ? null : store.get().hoveredId });
    document.body.style.cursor = on ? 'pointer' : '';
  };

  const look = (p: { lat: number; lon: number }) => () => {
    if (store.readout.dragged) return;
    store.set({ command: { kind: 'look', lat: p.lat, lon: p.lon, at: performance.now() } });
  };

  return (
    <>
      <group ref={routeGroup}>
        <mesh geometry={route.geometry} material={route.line} />
        <mesh geometry={route.geometry} material={route.glow} />
        <points ref={track} geometry={route.trackGeometry} material={route.trackMaterial} />
        <primitive object={puffs.mesh} />
      </group>

      <group ref={pins}>
        {stops.map((stop, i) => (
          <RestPin key={i} stop={stop} stick={pinMaterials.stick} head={pinMaterials.next} />
        ))}
      </group>

      <Dovecote
        position={nests.from.position}
        normal={nests.from.normal}
        roof="#ffc800"
        label={flight.fromLabel ? `From ${flight.fromLabel}` : undefined}
        showLabel={showNestLabels}
        priority={50}
        onSelect={look(from)}
      />
      <Dovecote
        position={nests.to.position}
        normal={nests.to.normal}
        roof="#ff4b4b"
        label={flight.toLabel ? `To ${flight.toLabel}` : undefined}
        showLabel={showNestLabels}
        priority={55}
        onSelect={look(to)}
      />

      <mesh ref={shadow} rotation={[0, 0, 0]} material={shadowMaterial}>
        <circleGeometry args={[1, 20]} />
      </mesh>

      <group ref={bird}>
        <Pigeon ref={pigeon} color={color} />
        {/* A generous invisible target: the bird is small, fingers are not. */}
        <mesh material={hitMaterial} onClick={select} onPointerOver={hover(true)} onPointerOut={hover(false)}>
          <sphereGeometry args={[1.1, 10, 8]} />
        </mesh>
        <Html position={[0, 0.4, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={tag} className="globe-tag globe-tag-bird" style={{ ['--tag' as string]: color }}>
            <span className="globe-tag-dot" />
            <span ref={tagText}>{flight.name}</span>
          </div>
        </Html>
      </group>
    </>
  );
}

function RestPin({
  stop,
  stick,
  head,
}: {
  stop: { leg: Leg; position: THREE.Vector3; normal: THREE.Vector3 };
  stick: THREE.Material;
  head: THREE.Material;
}) {
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!group.current) return;
    group.current.position.copy(stop.position);
    tangentFrame(stop.normal, _east, _north);
    orient(group.current, stop.normal, _north);
  }, [stop]);

  return (
    <group ref={group}>
      <mesh position={[0, 0.5, 0]} material={stick}>
        <cylinderGeometry args={[0.05, 0.05, 1, 5]} />
      </mesh>
      <mesh position={[0, 1.05, 0]} material={head}>
        <sphereGeometry args={[0.24, 12, 10]} />
        <Outlines thickness={0.05} color="#1c2540" />
      </mesh>
    </group>
  );
}
