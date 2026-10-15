'use client';

/**
 * The bird, in three dimensions, with the letter in her beak.
 *
 * Built from code rather than loaded from a model file: the repository stays
 * asset-free, and every part can be animated on its own. Wings are hinged at
 * the shoulder and again at the wrist, so the primaries fold in on the
 * upstroke and fan out on the down, which is what makes her read as a bird
 * rather than a pair of flapping boards. She carries an envelope with a wax
 * seal, and puts it down only once she has arrived.
 *
 * Authored nose-forward along +Z with her back along +Y, the basis the scene
 * builds when it places her. Inked outlines go on the big shapes only; on the
 * small ones they would swallow the detail.
 */

import { Outlines } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { MOODS, type FlightMood } from '@/lib/flight/states';

import { toonMaterial } from './toon';

export type PigeonPose = 'flying' | 'resting' | 'waiting' | 'arrived';

export interface PigeonHandle {
  /** Imperative so a mood change never costs a React render. */
  setMood: (mood: FlightMood, pose: PigeonPose) => void;
}

const INK = '#1c2540';

function wingShape(): THREE.Shape {
  // The inner wing, seen from above: leading edge forward (+y here, which
  // becomes +Z once laid flat), tapering towards the wrist.
  const s = new THREE.Shape();
  s.moveTo(0, 0.2);
  s.bezierCurveTo(0.25, 0.26, 0.5, 0.2, 0.66, 0.12);
  s.lineTo(0.68, -0.12);
  s.bezierCurveTo(0.5, -0.2, 0.25, -0.24, 0, -0.18);
  s.closePath();
  return s;
}

function featherShape(length: number, width: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -width * 0.5);
  s.quadraticCurveTo(length * 0.6, -width * 0.65, length, 0);
  s.quadraticCurveTo(length * 0.6, width * 0.65, 0, width * 0.5);
  s.closePath();
  return s;
}

function extrude(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.4,
    bevelSize: depth * 0.4,
    bevelSegments: 1,
    curveSegments: 10,
  });
  // Lay it flat: the shape's XY plane becomes the bird's XZ plane.
  g.rotateX(-Math.PI / 2);
  g.translate(0, -depth / 2, 0);
  return g;
}

function bodyGeometry(): THREE.LatheGeometry {
  // Profile from tail (y = -0.62) to chest (y = +0.56), as radii.
  const profile: Array<[number, number]> = [
    [0.02, -0.66],
    [0.1, -0.58],
    [0.18, -0.42],
    [0.27, -0.2],
    [0.33, 0.02],
    [0.34, 0.2],
    [0.3, 0.38],
    [0.2, 0.52],
    [0.02, 0.58],
  ];
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

function envelopeParts() {
  const body = new THREE.BoxGeometry(0.46, 0.022, 0.31);
  // The flap: a flat triangle on the back face, pointing at the seal.
  const flapShape = new THREE.Shape();
  flapShape.moveTo(-0.23, 0.155);
  flapShape.lineTo(0.23, 0.155);
  flapShape.lineTo(0, -0.02);
  flapShape.closePath();
  const flap = new THREE.ShapeGeometry(flapShape);
  flap.rotateX(-Math.PI / 2);
  flap.translate(0, 0.0125, 0);
  const seal = new THREE.CylinderGeometry(0.045, 0.045, 0.014, 14);
  seal.translate(0, 0.018, 0.0);
  return { envelope: body, flap, seal };
}

/**
 * A left-right mirror image of a geometry.
 *
 * Mirroring by a negative scale on the mesh would turn every face inside out,
 * and the inked outline — drawn from back faces — would then cover the wing.
 * Mirroring the vertices and re-winding each triangle keeps both correct.
 */
function mirrored(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = (source.index ? source.toNonIndexed() : source.clone());
  g.scale(-1, 1, 1);
  for (const name of Object.keys(g.attributes)) {
    const attr = g.attributes[name] as THREE.BufferAttribute;
    const size = attr.itemSize;
    const a = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < size; k++) {
        const j1 = (i + 1) * size + k;
        const j2 = (i + 2) * size + k;
        const tmp = a[j1];
        a[j1] = a[j2];
        a[j2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

export const Pigeon = forwardRef<PigeonHandle, { color?: string }>(function Pigeon({ color = '#ffc800' }, ref) {
  const root = useRef<THREE.Group>(null);
  const leftShoulder = useRef<THREE.Group>(null);
  const rightShoulder = useRef<THREE.Group>(null);
  const leftWrist = useRef<THREE.Group>(null);
  const rightWrist = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const feet = useRef<THREE.Group>(null);
  const letter = useRef<THREE.Group>(null);

  const state = useRef<{ mood: FlightMood; pose: PigeonPose }>({ mood: 'launch', pose: 'flying' });
  const blend = useRef({ fold: 0, land: 0 });

  useImperativeHandle(
    ref,
    () => ({
      setMood: (mood, pose) => {
        state.current = { mood, pose };
      },
    }),
    [],
  );

  const parts = useMemo(() => {
    const m = {
      body: toonMaterial({ color: '#a9b4cc', nightFloor: 0.85 }),
      belly: toonMaterial({ color: '#d6dcea', nightFloor: 0.85 }),
      neck: toonMaterial({ color: '#3fd2a4', nightFloor: 0.85, iridescent: true }),
      wing: toonMaterial({ color: '#8f9cbb', nightFloor: 0.85 }),
      bar: toonMaterial({ color: '#3f4b68', nightFloor: 0.85 }),
      primary: toonMaterial({ color: '#56637f', nightFloor: 0.85 }),
      tail: toonMaterial({ color: '#7d8aa8', nightFloor: 0.85 }),
      tailTip: toonMaterial({ color: '#343e58', nightFloor: 0.85 }),
      beak: toonMaterial({ color: '#4a4a52', nightFloor: 0.85 }),
      cere: toonMaterial({ color: '#f4f1ea', nightFloor: 0.7 }),
      iris: toonMaterial({ color: '#ff8a1e', nightFloor: 0.8, rim: 0 }),
      pupil: toonMaterial({ color: '#111111', nightFloor: 0.8, rim: 0 }),
      shine: toonMaterial({ color: '#ffffff', nightFloor: 1, rim: 0 }),
      feet: toonMaterial({ color: '#ff7b8a', nightFloor: 0.85 }),
      paper: toonMaterial({ color: '#fff3d6', nightFloor: 0.75, rim: 0.15 }),
      flap: toonMaterial({ color: '#f1dcae', nightFloor: 0.75, rim: 0 }),
      seal: toonMaterial({ color: '#e5303a', nightFloor: 0.75 }),
      band: toonMaterial({ color, nightFloor: 0.9, rim: 0.1 }),
    };
    m.flap.side = THREE.DoubleSide;

    const g = {
      body: bodyGeometry(),
      belly: new THREE.SphereGeometry(0.27, 16, 12),
      neck: new THREE.SphereGeometry(0.235, 16, 12),
      head: new THREE.SphereGeometry(0.2, 18, 14),
      beak: new THREE.ConeGeometry(0.05, 0.2, 8),
      cere: new THREE.SphereGeometry(0.05, 10, 8),
      eye: new THREE.SphereGeometry(0.052, 12, 10),
      pupil: new THREE.SphereGeometry(0.03, 10, 8),
      shine: new THREE.SphereGeometry(0.012, 6, 6),
      wing: extrude(wingShape(), 0.035),
      bar: new THREE.BoxGeometry(0.36, 0.05, 0.035),
      primary: [0.62, 0.6, 0.56, 0.5, 0.44].map((len) => extrude(featherShape(len, 0.14), 0.02)),
      tail: extrude(featherShape(0.44, 0.14), 0.02),
      tailTip: extrude(featherShape(0.12, 0.11), 0.024),
      leg: new THREE.CylinderGeometry(0.018, 0.016, 0.14, 6),
      toe: new THREE.CylinderGeometry(0.012, 0.01, 0.09, 5),
      band: new THREE.CylinderGeometry(0.03, 0.03, 0.035, 10),
      ...envelopeParts(),
    };
    g.beak.rotateX(Math.PI / 2);

    const right = {
      wing: mirrored(g.wing),
      primary: g.primary.map(mirrored),
    };

    return { m, g, right };
  }, [color]);

  const { m, g, right } = parts;

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const { mood, pose } = state.current;
    const profile = MOODS[mood];
    const grounded = pose !== 'flying';
    const b = blend.current;

    // Ease between flying and standing, rather than snapping.
    const k = 1 - Math.exp(-delta * 4);
    b.fold += ((grounded ? 1 : 0) - b.fold) * k;
    b.land += ((grounded ? 1 : 0) - b.land) * k;

    const { flapHz, bobAmplitude, roll } = profile.animation;

    if (root.current) {
      root.current.position.y = grounded ? Math.abs(Math.sin(t * 2.2)) * 0.015 : Math.sin(t * 1.9) * bobAmplitude * 1.4;
      root.current.rotation.z = grounded ? 0 : THREE.MathUtils.degToRad(roll) * Math.sin(t * 0.8);
      // Nose up a touch while climbing out, down on the final approach.
      const pitch = mood === 'launch' ? -0.18 : mood === 'final-approach' ? 0.12 : 0;
      root.current.rotation.x = THREE.MathUtils.lerp(pitch, 0, b.land);
    }

    // --- wings ---------------------------------------------------------------
    const hz = flapHz || 3;
    const phase = (t * hz) % 1;
    // Quick downstroke, slower recovery.
    const stroke = phase < 0.42 ? Math.sin((phase / 0.42) * Math.PI) : -Math.sin(((phase - 0.42) / 0.58) * Math.PI) * 0.6;
    const flap = stroke * 0.95;
    const wristFold = phase < 0.42 ? 0.05 : 0.55 * Math.sin(((phase - 0.42) / 0.58) * Math.PI);

    // Folded along the body when standing.
    const foldSweep = b.fold * 1.25;
    const idle = Math.sin(t * 1.3) * 0.04;

    const shoulderZ = THREE.MathUtils.lerp(flap, -0.2 + idle, b.fold);
    const shoulderY = foldSweep;
    const wristY = THREE.MathUtils.lerp(wristFold, 2.3, b.fold);

    if (leftShoulder.current) {
      leftShoulder.current.rotation.set(0, shoulderY, -shoulderZ);
    }
    if (rightShoulder.current) {
      rightShoulder.current.rotation.set(0, -shoulderY, shoulderZ);
    }
    if (leftWrist.current) leftWrist.current.rotation.set(0, wristY, -wristFold * 0.4 * (1 - b.fold));
    if (rightWrist.current) rightWrist.current.rotation.set(0, -wristY, wristFold * 0.4 * (1 - b.fold));

    // --- head, tail, feet, letter --------------------------------------------
    if (head.current) {
      // A pigeon's head bob when walking; a steady gaze when flying.
      head.current.rotation.y = grounded ? Math.sin(t * 0.7) * 0.6 : Math.sin(t * 0.55) * 0.12;
      head.current.position.z = 0.6 + (grounded ? Math.max(0, Math.sin(t * 4.4)) * 0.05 : 0);
    }
    if (tail.current) {
      tail.current.rotation.x = THREE.MathUtils.lerp(0.06 + stroke * 0.06, -0.35, b.land);
    }
    if (feet.current) {
      // Tucked back in flight, down to stand on.
      feet.current.rotation.x = THREE.MathUtils.lerp(1.3, 0, b.land);
    }
    if (letter.current) {
      letter.current.visible = pose !== 'arrived';
      letter.current.rotation.z = Math.sin(t * 2.6) * 0.06;
    }
  });

  const Ink = ({ w = 0.025 }: { w?: number }) => <Outlines thickness={w} color={INK} />;

  return (
    <group ref={root}>
      {/* body and chest */}
      <mesh geometry={g.body} material={m.body}>
        <Ink />
      </mesh>
      <mesh geometry={g.belly} material={m.belly} position={[0, -0.1, 0.08]} scale={[1, 0.8, 1.35]} />
      <mesh geometry={g.neck} material={m.neck} position={[0, 0.1, 0.38]}>
        <Ink w={0.02} />
      </mesh>

      {/* head */}
      <group ref={head} position={[0, 0.27, 0.6]}>
        <mesh geometry={g.head} material={m.body}>
          <Ink w={0.02} />
        </mesh>
        <mesh geometry={g.beak} material={m.beak} position={[0, -0.03, 0.26]} />
        <mesh geometry={g.cere} material={m.cere} position={[0, 0.0, 0.18]} scale={[1, 0.7, 1.2]} />
        {[1, -1].map((side) => (
          <group key={side} position={[0.14 * side, 0.05, 0.1]}>
            <mesh geometry={g.eye} material={m.iris} />
            <mesh geometry={g.pupil} material={m.pupil} position={[0.03 * side, 0.004, 0.022]} />
            <mesh geometry={g.shine} material={m.shine} position={[0.045 * side, 0.025, 0.03]} />
          </group>
        ))}

        {/* the letter, held in the beak */}
        <group ref={letter} position={[0, -0.12, 0.42]} rotation={[0.25, 0, 0]}>
          <mesh geometry={g.envelope} material={m.paper}>
            <Ink w={0.012} />
          </mesh>
          <mesh geometry={g.flap} material={m.flap} />
          <mesh geometry={g.seal} material={m.seal} />
        </group>
      </group>

      {/* wings: shoulder hinge, inner wing, wrist hinge, primaries */}
      {(['left', 'right'] as const).map((side) => {
        const s = side === 'left' ? 1 : -1;
        return (
          <group key={side} ref={side === 'left' ? leftShoulder : rightShoulder} position={[0.2 * s, 0.14, 0.12]}>
            <mesh geometry={side === 'left' ? g.wing : right.wing} material={m.wing}>
              <Ink w={0.02} />
            </mesh>
            <mesh geometry={g.bar} material={m.bar} position={[0.36 * s, 0.02, -0.02]} rotation={[0, 0.1 * s, 0]} />
            <mesh geometry={g.bar} material={m.bar} position={[0.34 * s, 0.02, -0.12]} rotation={[0, 0.06 * s, 0]} />
            <group ref={side === 'left' ? leftWrist : rightWrist} position={[0.64 * s, 0, 0]}>
              {(side === 'left' ? g.primary : right.primary).map((geom, i) => (
                <mesh
                  key={i}
                  geometry={geom}
                  material={m.primary}
                  position={[0, 0.004 * i, 0.06 - i * 0.05]}
                  rotation={[0, (0.12 + i * 0.2) * s, 0]}
                >
                  {i === 0 ? <Ink w={0.015} /> : null}
                </mesh>
              ))}
            </group>
          </group>
        );
      })}

      {/* tail fan */}
      <group ref={tail} position={[0, 0.05, -0.56]}>
        {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, Math.PI + i * 0.13, 0]}>
            <mesh geometry={g.tail} material={m.tail} position={[0, 0.003 * Math.abs(i), 0]} rotation={[0, -Math.PI / 2, 0]} />
            <mesh geometry={g.tailTip} material={m.tailTip} position={[0, 0.004 * Math.abs(i) + 0.002, 0.34]} rotation={[0, -Math.PI / 2, 0]} />
          </group>
        ))}
      </group>

      {/* legs and feet, with a band in this bird's colour */}
      <group ref={feet} position={[0, -0.24, 0.05]}>
        {[1, -1].map((side) => (
          <group key={side} position={[0.1 * side, 0, 0]}>
            <mesh geometry={g.leg} material={m.feet} position={[0, -0.07, 0]} />
            <mesh geometry={g.band} material={m.band} position={[0, -0.06, 0]} />
            {[-0.5, 0, 0.5].map((a) => (
              <mesh key={a} geometry={g.toe} material={m.feet} position={[Math.sin(a) * 0.04, -0.14, Math.cos(a) * 0.04]} rotation={[Math.PI / 2, 0, a]} />
            ))}
          </group>
        ))}
      </group>
    </group>
  );
});
