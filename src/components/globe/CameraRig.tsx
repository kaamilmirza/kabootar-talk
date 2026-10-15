'use client';

/**
 * The camera, and every way a person can move it.
 *
 * Built for a planet rather than borrowed from a generic orbit control. The
 * camera is described by a point on the ground it looks at, how far back it
 * stands, which way is up on screen, and how far it leans:
 *
 *   - Dragging grabs the ground and turns the planet under your finger, at a
 *     speed that matches how close you are.
 *   - Zooming pulls towards the point under the cursor, and the camera leans
 *     towards the horizon as it gets lower, so up close you see mountains
 *     against the sky rather than a flat map.
 *   - Right-drag, shift-drag or two fingers turn and tilt the view.
 *   - "Follow" keeps a pigeon centred; "ride" puts the camera behind her,
 *     looking where she is going.
 *
 * Every value eases towards a target, so a jump between modes is a flight,
 * not a cut. None of it allocates per frame.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { interpolate } from '@/lib/flight/geo';

import { surfaceVector, tangentFrame, toLatLon } from './math';
import type { GlobeStore } from './store';
import type { Terrain } from './terrain';

export interface RigHome {
  lat: number;
  lon: number;
  /** Distance from the focus point, in planet radii. */
  alt: number;
}

interface RigValues {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  tiltOffset: number;
  lift: number;
}

const MIN_ALT = 0.02;
const MAX_ALT = 6;
const RIDE_ALT = 0.055;
const RIDE_TILT = 1.2;
const DRAG_THRESHOLD_PX = 6;

const _n = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1);

/** Lean towards the horizon as the camera comes down. */
function autoTilt(alt: number): number {
  return 1.12 * (1 - THREE.MathUtils.smoothstep(alt, 0.06, 1.35));
}

function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function wrapRad(r: number): number {
  return ((((r + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

export function CameraRig({
  store,
  terrain,
  home,
  autoRotate = false,
}: {
  store: GlobeStore;
  terrain: Terrain | null;
  home: RigHome;
  autoRotate?: boolean;
}) {
  const { camera, gl } = useThree();

  // Starts further out than home, so the first thing anyone sees is the
  // planet swinging in to meet them.
  const target = useRef<RigValues>({ ...home, alt: home.alt, heading: 0, tiltOffset: 0, lift: 0 });
  const current = useRef<RigValues>({ ...home, alt: Math.min(MAX_ALT, home.alt * 1.9 + 1), heading: 0, tiltOffset: 0, lift: 0 });
  const velocity = useRef({ lat: 0, lon: 0 });
  const lastInteraction = useRef(0);
  const lastCommand = useRef(0);
  const homeRef = useRef(home);
  // How far the picture is shifted up so the planet sits above the controls
  // at the bottom. Never sideways: the planet stays centred on the screen.
  const offset = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, frame: 0 });

  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  // --- input --------------------------------------------------------------------
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: 'pan' | 'orbit' | 'pinch' | null = null;
    let travelled = 0;
    let lastMove = 0;
    let pinch = { dist: 0, angle: 0, midY: 0 };

    const touch = () => {
      lastInteraction.current = performance.now();
    };

    const breakFollow = () => {
      if (store.get().mode !== 'free') store.set({ mode: 'free' });
    };

    const radiansPerPixel = () => {
      const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 40);
      return (2 * Math.tan(fov / 2) * Math.max(0.03, current.current.alt)) / Math.max(1, el.clientHeight);
    };

    const pan = (dx: number, dy: number) => {
      const t = target.current;
      const h = current.current.heading;
      const k = THREE.MathUtils.radToDeg(radiansPerPixel());
      const dEast = (-dx * Math.cos(h) + dy * Math.sin(h)) * k;
      const dNorth = (dx * Math.sin(h) + dy * Math.cos(h)) * k;
      const cosLat = Math.max(0.15, Math.cos(THREE.MathUtils.degToRad(t.lat)));
      t.lat = THREE.MathUtils.clamp(t.lat + dNorth, -84, 84);
      t.lon = wrapDeg(t.lon + dEast / cosLat);
      return { dLat: dNorth, dLon: dEast / cosLat };
    };

    const pickGround = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      return _ray.ray.intersectSphere(_sphere, _hit) ? toLatLon(_hit) : null;
    };

    const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
      const t = target.current;
      const before = t.alt;
      const riding = store.get().mode === 'ride';
      t.alt = THREE.MathUtils.clamp(t.alt * factor, riding ? 0.025 : MIN_ALT, riding ? 0.4 : MAX_ALT);

      // Pull towards whatever is under the cursor, the way a map does.
      if (factor < 1 && clientX !== undefined && clientY !== undefined && store.get().mode === 'free') {
        const p = pickGround(clientX, clientY);
        if (p) {
          const f = THREE.MathUtils.clamp((1 - t.alt / before) * 0.95, 0, 1);
          const next = interpolate({ lat: t.lat, lon: t.lon }, p, f);
          t.lat = THREE.MathUtils.clamp(next.lat, -84, 84);
          t.lon = next.lon;
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      touch();
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      velocity.current.lat = 0;
      velocity.current.lon = 0;

      if (pointers.size === 1) {
        travelled = 0;
        store.setReadout({ dragged: false });
        gesture = e.button === 2 || e.shiftKey || e.ctrlKey || e.altKey ? 'orbit' : 'pan';
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = 'pinch';
        pinch = {
          dist: Math.hypot(b.x - a.x, b.y - a.y),
          angle: Math.atan2(b.y - a.y, b.x - a.x),
          midY: (a.y + b.y) / 2,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      touch();

      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > DRAG_THRESHOLD_PX) store.setReadout({ dragged: true });

      const now = performance.now();
      const dt = Math.max(1, now - lastMove) / 1000;
      lastMove = now;

      if (gesture === 'pan' && pointers.size === 1) {
        if (travelled > DRAG_THRESHOLD_PX) breakFollow();
        const { dLat, dLon } = pan(dx, dy);
        velocity.current.lat = THREE.MathUtils.lerp(velocity.current.lat, dLat / dt, 0.5);
        velocity.current.lon = THREE.MathUtils.lerp(velocity.current.lon, dLon / dt, 0.5);
      } else if (gesture === 'orbit') {
        target.current.heading = wrapRad(target.current.heading - dx * 0.006);
        target.current.tiltOffset = THREE.MathUtils.clamp(target.current.tiltOffset + dy * 0.004, -1.1, 0.6);
      } else if (gesture === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const midY = (a.y + b.y) / 2;
        if (pinch.dist > 0 && dist > 0) zoomAt(pinch.dist / dist, (a.x + b.x) / 2, midY);
        target.current.heading = wrapRad(target.current.heading - wrapRad(angle - pinch.angle));
        target.current.tiltOffset = THREE.MathUtils.clamp(
          target.current.tiltOffset + (midY - pinch.midY) * 0.004,
          -1.1,
          0.6,
        );
        pinch = { dist, angle, midY };
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      // A flick keeps the planet spinning; a slow release stops it dead.
      if (performance.now() - lastMove > 80) {
        velocity.current.lat = 0;
        velocity.current.lon = 0;
      }
      if (pointers.size === 1) gesture = 'pan';
      if (pointers.size === 0) gesture = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touch();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = THREE.MathUtils.clamp(e.deltaY * unit, -200, 200);
      zoomAt(Math.exp(delta * 0.0018), e.clientX, e.clientY);
    };

    const onDoubleClick = (e: MouseEvent) => {
      touch();
      const p = pickGround(e.clientX, e.clientY);
      if (!p) return;
      breakFollow();
      target.current.lat = THREE.MathUtils.clamp(p.lat, -84, 84);
      target.current.lon = p.lon;
      target.current.alt = THREE.MathUtils.clamp(target.current.alt * 0.45, MIN_ALT, MAX_ALT);
    };

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const step = 60;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
          breakFollow();
          pan(step, 0);
          break;
        case 'ArrowRight':
          breakFollow();
          pan(-step, 0);
          break;
        case 'ArrowUp':
          breakFollow();
          pan(0, step);
          break;
        case 'ArrowDown':
          breakFollow();
          pan(0, -step);
          break;
        case '+':
        case '=':
          zoomAt(0.7);
          break;
        case '-':
        case '_':
          zoomAt(1.4);
          break;
        case 'q':
        case 'Q':
          target.current.heading = wrapRad(target.current.heading + 0.25);
          break;
        case 'e':
        case 'E':
          target.current.heading = wrapRad(target.current.heading - 0.25);
          break;
        default:
          handled = false;
      }
      if (handled) {
        touch();
        e.preventDefault();
      }
    };

    const noMenu = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('contextmenu', noMenu);
    window.addEventListener('keydown', onKey);

    // Climbing aboard moves the camera in close behind her; climbing off
    // puts it back where it was.
    let previousMode = store.get().mode;
    let savedAlt = target.current.alt;

    // Commands from the on-screen buttons go through the same paths.
    const unsubscribe = store.subscribe(() => {
      const { mode } = store.get();
      if (mode !== previousMode) {
        if (mode === 'ride') {
          savedAlt = target.current.alt;
          target.current.alt = RIDE_ALT;
          target.current.tiltOffset = 0;
        } else if (previousMode === 'ride') {
          target.current.alt = Math.max(savedAlt, 0.3);
          target.current.tiltOffset = 0;
        }
        previousMode = mode;
      }

      const command = store.get().command;
      if (!command || command.at === lastCommand.current) return;
      lastCommand.current = command.at;
      touch();
      if (command.kind === 'zoom') zoomAt(command.factor);
      if (command.kind === 'north') {
        target.current.heading = 0;
        target.current.tiltOffset = 0;
      }
      if (command.kind === 'home') {
        breakFollow();
        Object.assign(target.current, homeRef.current, { heading: 0, tiltOffset: 0 });
      }
      if (command.kind === 'look') {
        breakFollow();
        target.current.lat = command.lat;
        target.current.lon = command.lon;
        target.current.alt = Math.min(target.current.alt, 1.1);
      }
    });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', onKey);
      unsubscribe();
    };
  }, [camera, gl, store]);

  // --- every frame ----------------------------------------------------------------
  useFrame(({ camera, size }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);

    // --- keep the planet clear of the bottom controls -----------------------
    // The page's sheet and the control bar publish their heights as CSS
    // variables. Read a few times a second; layout is not free.
    const o = offset.current;
    if (o.frame++ % 15 === 0) {
      const style = getComputedStyle(gl.domElement);
      const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
      o.targetX = 0;
      o.targetY = (px('--sheet-h') + px('--hud-b')) / 2;
    }
    const ease = 1 - Math.exp(-delta * 5);
    o.x += (o.targetX - o.x) * ease;
    o.y += (o.targetY - o.y) * ease;
    const persp0 = camera as THREE.PerspectiveCamera;
    if (Math.abs(o.x) > 0.5 || Math.abs(o.y) > 0.5) {
      persp0.setViewOffset(size.width, size.height, -o.x, o.y, size.width, size.height);
    } else if (persp0.view?.enabled) {
      persp0.clearViewOffset();
    }
    const t = target.current;
    const c = current.current;
    const { mode, selectedId } = store.get();
    const tracker = selectedId ? store.trackers.get(selectedId) : undefined;
    const now = performance.now();

    // Inertia from a flick.
    const v = velocity.current;
    if (mode === 'free' && (v.lat !== 0 || v.lon !== 0)) {
      t.lat = THREE.MathUtils.clamp(t.lat + v.lat * delta, -84, 84);
      t.lon = wrapDeg(t.lon + v.lon * delta);
      const decay = Math.exp(-delta * 3.2);
      v.lat *= decay;
      v.lon *= decay;
      if (Math.abs(v.lat) + Math.abs(v.lon) < 0.01) v.lat = v.lon = 0;
    }

    let tilt: number;

    if ((mode === 'follow' || mode === 'ride') && tracker?.ready) {
      const p = toLatLon(tracker.position);
      t.lat = THREE.MathUtils.clamp(p.lat, -84, 84);
      t.lon = p.lon;
      t.lift = Math.max(0, tracker.position.length() - 1);

      if (mode === 'ride') {
        _n.copy(tracker.position).normalize();
        tangentFrame(_n, _east, _north);
        t.heading = Math.atan2(tracker.forward.dot(_east), tracker.forward.dot(_north));
        t.alt = THREE.MathUtils.clamp(t.alt, 0.025, 0.4);
      }
    } else {
      t.lift = 0;
      if (autoRotate && mode === 'free' && now - lastInteraction.current > 7000) {
        t.lon = wrapDeg(t.lon + delta * 2.5);
      }
    }

    // Ease everything towards its target. Longitude and heading take the
    // short way round.
    const k = 1 - Math.exp(-delta * (mode === 'ride' ? 5 : 4.2));
    c.lat += (t.lat - c.lat) * k;
    c.lon = wrapDeg(c.lon + wrapDeg(t.lon - c.lon) * k);
    c.alt += (t.alt - c.alt) * k;
    c.heading = wrapRad(c.heading + wrapRad(t.heading - c.heading) * k);
    c.tiltOffset += (t.tiltOffset - c.tiltOffset) * k;
    c.lift += (t.lift - c.lift) * k;

    if (mode === 'ride') tilt = THREE.MathUtils.clamp(RIDE_TILT + c.tiltOffset * 0.5, 0.5, 1.45);
    else tilt = THREE.MathUtils.clamp(autoTilt(c.alt) + c.tiltOffset, 0, 1.4);

    // --- place the camera ---------------------------------------------------
    surfaceVector({ lat: c.lat, lon: c.lon }, 1, _n);
    tangentFrame(_n, _east, _north);
    _fwd.copy(_north).multiplyScalar(Math.cos(c.heading)).addScaledVector(_east, Math.sin(c.heading));

    const ground = terrain ? terrain.groundRadius(c.lat, c.lon) : 1;
    _focus.copy(_n).multiplyScalar(Math.max(1 + c.lift, ground + 0.002));

    _camDir.copy(_n).multiplyScalar(Math.cos(tilt)).addScaledVector(_fwd, -Math.sin(tilt));
    camera.position.copy(_focus).addScaledVector(_camDir, c.alt);

    // Never inside a mountain.
    if (terrain) {
      const here = toLatLon(camera.position);
      const floor = terrain.groundRadius(here.lat, here.lon) + 0.006;
      const len = camera.position.length();
      if (len < floor) camera.position.multiplyScalar(floor / len);
    }

    _camUp.copy(_fwd).multiplyScalar(Math.cos(tilt)).addScaledVector(_n, Math.sin(tilt));
    camera.up.copy(_camUp);
    camera.lookAt(_focus);

    // A near plane that follows the camera down, so close-ups do not clip
    // and the far side does not z-fight.
    const persp = camera as THREE.PerspectiveCamera;
    const near = THREE.MathUtils.clamp(c.alt * 0.2, 0.0006, 0.5);
    if (Math.abs(persp.near - near) / near > 0.02) {
      persp.near = near;
      persp.far = 260;
      persp.updateProjectionMatrix();
    }

    store.setReadout({ heading: c.heading, altitude: c.alt + c.lift, tilt });
  });

  return null;
}
