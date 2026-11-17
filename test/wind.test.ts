import { describe, expect, it } from 'vitest';
import { Vector3, type NodeMaterial } from 'three/webgpu';
import { createTree, sceneWind, Wind } from '../src/index';

/** What the renderer does with the time uniform once per render (NodeFrame -> node.update). */
function renderAt(wind: Wind, seconds: number): number {
  const node = wind.uniforms.time as unknown as { update(frame: { time: number }): void; value: number };
  node.update({ time: seconds });
  return node.value;
}

describe('Wind', () => {
  it('is calm by default, blowing along +X once it has a strength', () => {
    const wind = new Wind();
    expect(wind.strength).toBe(0);
    expect(wind.direction.toArray()).toEqual([1, 0, 0]);
  });

  it('takes any direction and keeps it as a unit vector', () => {
    const wind = new Wind();
    wind.direction = [0, 0, -4];
    expect(wind.direction.toArray()).toEqual([0, 0, -1]);
    wind.direction = new Vector3(3, 0, 4);
    expect(wind.direction.x).toBeCloseTo(0.6);
    expect(wind.direction.z).toBeCloseTo(0.8);
    expect(wind.uniforms.direction.value.toArray()).toEqual(wind.direction.toArray());
  });

  it('hands out a copy of its direction, so editing it does nothing until assigned back', () => {
    const wind = new Wind();
    wind.direction.set(0, 0, 1);
    expect(wind.direction.toArray()).toEqual([1, 0, 0]);
  });

  it('sets direction and strength together', () => {
    const wind = new Wind().set({ direction: [0, 0, 2], strength: 0.7 });
    expect(wind.direction.toArray()).toEqual([0, 0, 1]);
    expect(wind.strength).toBe(0.7);
    expect(wind.uniforms.strength.value).toBe(0.7);
  });

  it('accepts direction and strength in its constructor', () => {
    const wind = new Wind({ direction: [-1, 0, 0], strength: 2 });
    expect(wind.direction.toArray()).toEqual([-1, 0, 0]);
    expect(wind.strength).toBe(2);
  });

  it('rejects a zero or non-finite direction and a negative strength', () => {
    const wind = new Wind();
    expect(() => (wind.direction = [0, 0, 0])).toThrow(RangeError);
    expect(() => (wind.direction = [Number.NaN, 0, 1])).toThrow(RangeError);
    expect(() => (wind.strength = -0.1)).toThrow(RangeError);
    expect(() => (wind.strength = Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(wind.direction.toArray()).toEqual([1, 0, 0]);
    expect(wind.strength).toBe(0);
  });

  it('follows the renderer clock, unless its time is pinned (pause, screenshots)', () => {
    const wind = new Wind();
    expect(wind.time).toBeNull();
    expect(renderAt(wind, 3.5)).toBe(3.5);
    wind.time = 1.25;
    expect(renderAt(wind, 9)).toBe(1.25);
    wind.time = null;
    expect(renderAt(wind, 9)).toBe(9);
  });

  it('there is one scene-wide Wind that every tree listens to by default', () => {
    expect(sceneWind).toBeInstanceOf(Wind);
  });
});

describe('trees and Wind', () => {
  const definition = { schemaVersion: 2 } as const;

  it('every tree listens to the scene-wide Wind unless given its own', () => {
    const a = createTree(definition, { seed: 1 });
    const b = createTree(definition, { seed: 2 });
    expect(a.wind).toBe(sceneWind);
    expect(b.wind).toBe(sceneWind);
    const storm = new Wind({ strength: 3 });
    expect(createTree(definition, { seed: 3, wind: storm }).wind).toBe(storm);
  });

  it('wood and leaves are displaced by the Wind in the vertex stage (which the shadow pass reuses)', () => {
    const tree = createTree(definition, { seed: 1 });
    expect((tree.wood.material as NodeMaterial).positionNode).toBeTruthy();
    expect(tree.leaves.material.positionNode).toBeTruthy();
  });

  it('takes its Wind response from the Definition', () => {
    const stiff = createTree({ schemaVersion: 2, wind: { trunk: 0, branches: 0.1, leaves: 0.2, frequency: 0.5 } });
    expect(stiff.windResponse.values).toEqual({ trunk: 0, branches: 0.1, leaves: 0.2, frequency: 0.5 });
    expect(stiff.windResponse.uniforms.trunk.value).toBe(0);
    expect(stiff.windResponse.uniforms.frequency.value).toBe(0.5);
    const willow = createTree({ schemaVersion: 2, wind: { trunk: 0.6, branches: 1, leaves: 1 } });
    expect(willow.windResponse.values).toEqual({ trunk: 0.6, branches: 1, leaves: 1, frequency: 1 });
  });

  it('the Wind response can be changed live without rebuilding the tree', () => {
    const tree = createTree(definition, { seed: 1 });
    const material = tree.wood.material;
    tree.windResponse.set({ branches: 0.9 });
    expect(tree.windResponse.values.branches).toBe(0.9);
    expect(tree.windResponse.uniforms.branches.value).toBe(0.9);
    expect(tree.wood.material).toBe(material);
    expect(() => tree.windResponse.set({ frequency: 0 })).toThrow(RangeError);
  });

  it('trees of different Seeds sway out of step', () => {
    const phase = (seed: number) => createTree(definition, { seed }).windResponse.uniforms.phase.value;
    expect(phase(1)).toBe(phase(1));
    expect(phase(1)).not.toBe(phase(2));
  });
});
