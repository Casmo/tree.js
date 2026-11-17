// Minimal vanilla three.js example: one tree (trunk, branch levels, leaves) on WebGPURenderer.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?renderer=classic  use the unsupported classic WebGLRenderer (shows the error)
//   ?seed=<n>  pick a Seed (default 1)
import * as THREE from 'three/webgpu';
import { MeshStandardMaterial, WebGLRenderer } from 'three';
import { createTree } from '../../src/index';

declare global {
  interface Window {
    treeExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string };
  }
}

window.treeExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const statusEl = document.getElementById('status')!;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(8.5, 4.5, 8.5);
camera.lookAt(0, 3, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);

const ground = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
  new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }),
);
scene.add(ground);

const tree = createTree({ schemaVersion: 1 }, { seed });
scene.add(tree);

async function main(): Promise<void> {
  if (params.get('renderer') === 'classic') {
    // A classic-renderer app uses classic materials; only the tree brings TSL node materials.
    ground.material = new MeshStandardMaterial({ color: '#7da05a' });
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);
    renderer.render(scene, camera); // throws UnsupportedRendererError
    return;
  }

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `WebGPURenderer (${backend}) - seed ${seed}`;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  await renderer.renderAsync(scene, camera);
  window.treeExample = { status: 'rendered', backend };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.treeExample = { status: 'error', error: message };
  console.error(error);
});
