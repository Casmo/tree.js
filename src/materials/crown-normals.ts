import { length, mix, normalView, select, transformNormalToView } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import type { CrownVolume } from '../generator';
import { crownNodes } from './crown-nodes';

/**
 * Crown Normals (GLOSSARY): blends the leaf material's normal from the leaf's own normal towards the
 * Crown Volume's normal at that point, by `amount` (0..1, a uniform: Definitions that differ only in it
 * share one shader, and a Tree tunes it live). Only call it when the feature is on (amount > 0); without
 * it the material keeps its own normal.
 *
 * - `growth`: the Growth node of the material's `positionNode` (the Volume scales with it).
 * - `toObject`: turns a tree-space normal into the mesh's own space (a Forest rotates it by the
 *   instance, as it does the Growth and Wind displacement); default: tree space is object space.
 *
 * The leaf normal is the material's view-space normal: the screen-space facet normal under flat
 * shading (so facets stay visible below 1), the smooth one facing the viewer otherwise.
 */
export function applyCrownNormals(
  material: MeshStandardNodeMaterial,
  amount: Node<'float'>,
  crown: CrownVolume,
  growth: Node<'float'>,
  toObject: (normal: Node<'vec3'>) => Node<'vec3'> = (normal) => normal,
): void {
  const crownView = transformNormalToView(toObject(crownNodes(crown, growth).normal)).normalize();
  const blend = mix(normalView, crownView, amount);
  // A leaf normal facing exactly away from the crown's cancels out half way: fall back to the crown's.
  material.normalNode = select(length(blend).greaterThan(1e-4), blend.normalize(), crownView);
}
