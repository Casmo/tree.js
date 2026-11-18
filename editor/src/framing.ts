import * as THREE from 'three/webgpu';

/**
 * The box the camera frames an object by: its bounding box, cut off at the ground (y = 0), so
 * geometry below it (Roots, the sunk trunk base) never shifts the view. An object that is
 * entirely below the ground keeps its box.
 */
export function framingBox(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object);
  if (box.max.y > 0) box.min.y = Math.max(box.min.y, 0);
  return box;
}
