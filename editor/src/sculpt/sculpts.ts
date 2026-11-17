// Sculpt edits (ADR 0003): pure functions from a Definition to a new Definition with one more hand
// edit for one Seed. The viewport tools and the Sculpt panel only call these; the store then
// regenerates the preview and records an undo step like for any other Definition change.
import { Euler, Quaternion } from 'three/webgpu';
import { extendDefinition, type Sculpt, type TreeDefinition } from '@casmo/tree.js';

/** True if `path` is `root` or grows from it. */
export const inSubtree = (path: string, root: string): boolean => path === root || path.startsWith(`${root}.`);

/** The Sculpts that apply on `seed` (every other Seed ignores them). */
export function sculptsOn(definition: TreeDefinition, seed: number): Sculpt[] {
  return definition.sculpts.filter((s) => s.seed === seed);
}

function withSculpts(definition: TreeDefinition, sculpts: Sculpt[]): TreeDefinition {
  return extendDefinition(definition, { sculpts });
}

/**
 * Deletes a branch and everything growing from it on `seed`. Earlier Sculpts of that Seed inside the
 * deleted part are dropped (they no longer show).
 */
export function deleteBranch(definition: TreeDefinition, seed: number, path: string): TreeDefinition {
  const kept = definition.sculpts.filter((s) => s.seed !== seed || !inSubtree(s.path, path));
  return withSculpts(definition, [...kept, { seed, path, action: 'delete' }]);
}

/** A change made by one drag: a rotation (quaternion x, y, z, w, tree space) and a length factor, about the branch base. */
export interface MoveDelta {
  rotation: [number, number, number, number];
  scale: number;
}

/**
 * Turns and stretches a branch (and everything on it) about its base, as the tree looks now on `seed`.
 * Repeated moves of the same branch fold into its existing `move` Sculpt when no later move of an
 * ancestor or descendant sits between them (the result is the same); otherwise a new Sculpt is added.
 */
export function moveBranch(definition: TreeDefinition, seed: number, path: string, delta: MoveDelta): TreeDefinition {
  const sculpts = definition.sculpts;
  const related = (s: Sculpt) => s.seed === seed && s.action === 'move' && (inSubtree(s.path, path) || inSubtree(path, s.path));
  const last = sculpts.findLastIndex(related);
  const existing = last >= 0 ? sculpts[last]! : null;
  const rotation = new Quaternion(...delta.rotation);
  if (existing?.action === 'move' && existing.path === path) {
    const total = rotation.multiply(new Quaternion().setFromEuler(new Euler(...existing.rotation, 'XYZ')));
    const merged: Sculpt = { ...existing, rotation: eulerTuple(total), scale: existing.scale * delta.scale };
    return withSculpts(definition, sculpts.with(last, merged));
  }
  return withSculpts(definition, [...sculpts, { seed, path, action: 'move', rotation: eulerTuple(rotation), scale: delta.scale }]);
}

function eulerTuple(rotation: Quaternion): [number, number, number] {
  const euler = new Euler().setFromQuaternion(rotation, 'XYZ');
  return [euler.x, euler.y, euler.z];
}

/**
 * Paints the leaf coverage (0 = bare .. 1 = all leaves) of the given branches (and everything on them)
 * on `seed`. Painting a branch again replaces its earlier paint; paint that changes nothing (e.g.
 * full coverage where no other paint applies) is left out, so the Definition stays tidy.
 */
export function paintLeaves(definition: TreeDefinition, seed: number, paths: readonly string[], coverage: number): TreeDefinition {
  let sculpts = definition.sculpts;
  for (const path of paths) {
    sculpts = sculpts.filter((s) => !(s.seed === seed && s.action === 'leaves' && s.path === path));
    if (leafCoverage(sculpts, seed, path) !== coverage) sculpts = [...sculpts, { seed, path, action: 'leaves', coverage }];
  }
  return sculpts === definition.sculpts ? definition : withSculpts(definition, sculpts);
}

/** The painted leaf coverage of branch `path` on `seed` (the last paint covering it wins; 1 if unpainted). */
export function leafCoverage(sculpts: readonly Sculpt[], seed: number, path: string): number {
  let coverage = 1;
  for (const s of sculpts) if (s.seed === seed && s.action === 'leaves' && inSubtree(path, s.path)) coverage = s.coverage;
  return coverage;
}
