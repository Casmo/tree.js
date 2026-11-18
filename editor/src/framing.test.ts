import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createTree } from '@casmo/tree.js';
import { framingBox } from './framing';

describe('camera framing', () => {
  it('ignores geometry below the ground: underground Roots and the sunk trunk base never move the framed box', () => {
    const rooted = createTree({ schemaVersion: 3, trunk: { flare: 0.8 }, roots: { count: 6, angle: 40, length: 0.4 } }, { seed: 3 });
    const all = new THREE.Box3().setFromObject(rooted);
    expect(all.min.y).toBeLessThan(0);
    const box = framingBox(rooted);
    expect(box.min.y).toBe(0);
    expect(box.max.toArray()).toEqual(all.max.toArray());
    expect([box.min.x, box.min.z]).toEqual([all.min.x, all.min.z]);
  });

  it('keeps an object that is all below the ground as it is', () => {
    const sunk = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    sunk.position.y = -2;
    sunk.updateMatrixWorld();
    expect(framingBox(sunk).min.y).toBeCloseTo(-2.5, 6);
  });
});
