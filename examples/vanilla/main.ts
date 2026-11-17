// Minimal vanilla three.js example: one tree (trunk, branch levels, leaves) on WebGPURenderer.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?renderer=classic  use the unsupported classic WebGLRenderer (shows the error)
//   ?seed=<n>  pick a Seed (default 1)
//   ?growth=<0..1>  Growth (default 1, fully grown); only a uniform changes
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?form=conifer  an evergreen conifer instead of the deciduous broadleaf
//   ?style=low-poly|stylized  grow that built-in Style's Definition for the form (loaded with a dynamic import)
//   ?wind=<strength>  scene-wide Wind strength (default 0 = calm); animates unless windTime is given
//   ?windTime=<s>  pin the Wind clock (deterministic screenshots)
//   ?shadows=1  enable shadow mapping (sun casts, ground receives)
import * as THREE from 'three/webgpu';
import { MeshStandardMaterial, WebGLRenderer } from 'three';
import { createTree, sceneWind, SEASON_PROFILES, type TreeDefinition, type TreeDefinitionInput, type TreeStyle } from '../../src/index';

// Built-in Styles are separate chunks, fetched only when asked for.
const styles: Record<string, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('../../src/styles/low-poly'),
  stylized: () => import('../../src/styles/stylized'),
};

declare global {
  interface Window {
    treeExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** id of the leaf BufferGeometry, to check that Season does not regenerate. */
      leafGeometryId?: number;
      /** Sets `tree.season` and re-renders (status goes 'loading' -> 'rendered'). */
      setSeason?: (season: number) => void;
    };
  }
}

window.treeExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const growth = Number(params.get('growth') ?? 1);
const season = Number(params.get('season') ?? 0.37);
const statusEl = document.getElementById('status')!;
const windStrength = Number(params.get('wind') ?? 0);
const windTime = params.get('windTime');
const shadows = params.get('shadows') === '1';
sceneWind.set({ direction: [1, 0, -0.4], strength: windStrength });
if (windTime !== null) sceneWind.time = Number(windTime);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(8.5, 4.5, 8.5);
camera.lookAt(0, 3, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);
if (shadows) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 9, bottom: -3 });
}

const ground = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
  new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }),
);
ground.receiveShadow = true;
scene.add(ground);

// Broadleaf: the defaults plus a third branching level, fuller foliage and the deciduous Season Profile.
const broadleaf: TreeDefinitionInput = {
  schemaVersion: 2,
  branches: [
    { count: 7, angle: 50 },
    { count: 4, start: 0.2, angle: 40, length: 0.45, sides: 4, sections: 3 },
    { count: 3, start: 0.3, end: 1, angle: 35, length: 0.5, sides: 3, sections: 2 },
  ],
  leaves: { count: 6, size: 0.35 },
  season: SEASON_PROFILES.deciduous,
};
// Conifer: a tall trunk with many short, near-horizontal branches and the evergreen Season Profile.
const conifer: TreeDefinitionInput = {
  schemaVersion: 2,
  form: 'conifer',
  trunk: { length: 6, radius: 0.18, taper: 0.9 },
  branches: [
    { count: 22, start: 0.15, end: 0.95, angle: 80, length: 0.28, gravity: -0.3 },
    { count: 3, start: 0.2, angle: 45, length: 0.4, sides: 3, sections: 2 },
  ],
  leaves: { count: 8, size: 0.3 },
  season: SEASON_PROFILES.evergreen,
};
const form = params.get('form') === 'conifer' ? 'conifer' : 'broadleaf';

async function loadDefinition(): Promise<TreeDefinitionInput | TreeDefinition> {
  const styleName = params.get('style');
  if (!styleName) return form === 'conifer' ? conifer : broadleaf;
  const load = styles[styleName];
  if (!load) throw new Error(`Unknown style "${styleName}"`);
  return (await load()).default[form];
}

/** Points the camera at the whole tree (Style trees differ in size). */
function frame(object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const distance = (Math.max(size.y, size.x, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
  const direction = new THREE.Vector3(1, 0.35, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.lookAt(centre);
}

async function main(): Promise<void> {
  const tree = createTree(await loadDefinition(), { seed, growth, season });
  scene.add(tree);
  if (params.get('style')) frame(tree);

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
  renderer.shadowMap.enabled = shadows;
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `WebGPURenderer (${backend}) - ${tree.definition.name || form} - seed ${seed}, growth ${growth}`;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const leafGeometryId = tree.leaves.geometry.id;
  await renderer.renderAsync(scene, camera);
  const setSeason = (value: number): void => {
    window.treeExample.status = 'loading';
    tree.season = value; // a uniform update: no regeneration
    void renderer.renderAsync(scene, camera).then(() => (window.treeExample.status = 'rendered'));
  };
  window.treeExample = { status: 'rendered', backend, leafGeometryId, setSeason };
  // A swaying tree needs a render loop; with a pinned Wind clock one frame is enough.
  if (windStrength > 0 && windTime === null) renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.treeExample = { status: 'error', error: message };
  console.error(error);
});
