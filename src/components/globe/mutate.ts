/**
 * Writes to three.js objects from the frame loop.
 *
 * The React compiler treats anything a hook returned as frozen, which is
 * right for React state and wrong for a three.js scene: these objects are
 * created once precisely so they can be changed in place sixty times a
 * second without allocating. Going through named functions keeps that
 * deliberate and greppable, instead of scattering lint suppressions.
 */

import type * as THREE from 'three';

export function setUniform(material: THREE.ShaderMaterial, name: string, value: unknown): void {
  material.uniforms[name].value = value;
}

export function setVisible(object: THREE.Object3D, visible: boolean): void {
  object.visible = visible;
}

export function setOpacity(material: THREE.Material, opacity: number): void {
  material.opacity = opacity;
}

export function setMaterial(mesh: THREE.Mesh, material: THREE.Material): void {
  if (mesh.material !== material) mesh.material = material;
}

export function markDirty(attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute): void {
  attribute.needsUpdate = true;
}
