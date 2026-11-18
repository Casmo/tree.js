// Forest example: hundreds of trees from a few instanced Variants on WebGPURenderer.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?trees=<n>  number of trees (default 400)
//   ?variants=<n>  number of Variants (default 4)
//   ?seed=<n>  forest seed (default 1)
//   ?growth=<0..1>  Growth of the whole forest (default 1)
//   ?season=<0..1>  Season of the whole forest (default 0.37)
//   ?uneven=1  per-tree Growth (younger towards the back) and Season (autumn towards the right)
//   ?wind=<strength>&windTime=<s>  scene-wide Wind; windTime pins the clock
//   ?cut=<n>  remove every n-th tree after planting (the others must not change)
//   ?style=<name>&form=conifer  a built-in Style's Definition instead of the example's own
//   ?species=<id>  that Species (loadSpecies, e.g. oak) in the ?style (default low-poly), with its Root Flare and Roots
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (a third instanced mesh per Variant)
//   ?occlusion=<0..1>  Structural Occlusion at that strength (a Material Feature, off by default)
import * as THREE from 'three/webgpu';
import {
  createForest,
  createRandom,
  extendDefinition,
  loadStyle,
  sceneWind,
  SEASON_PROFILES,
  type ForestPlacement,
  type FruitType,
  type StyleName,
  type TreeDefinition,
  type TreeDefinitionInput,
} from '@casmo/tree.js';
import { loadSpecies, type SpeciesName } from '@casmo/tree.js/species';

declare global {
  interface Window {
    forestExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      trees?: number;
      /** Draw calls of the last frame (2 per Variant, 3 with Fruit, plus the ground and the background). */
      drawCalls?: number;
      /** Fruit instances drawn over all Variants (0 without Fruit). */
      fruitInstances?: number;
      /** Roots in the Variant with the fewest (0 without a `roots` block). */
      roots?: number;
    };
  }
}

window.forestExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);
const statusEl = document.getElementById('status')!;
sceneWind.set({ direction: [1, 0, -0.4], strength: number('wind', 0) });
const windTime = params.get('windTime');
if (windTime !== null) sceneWind.time = Number(windTime);

const definition: TreeDefinitionInput = {
  schemaVersion: 2,
  branches: [
    { count: 6, angle: 50 },
    { count: 3, start: 0.25, angle: 40, length: 0.45, sides: 4, sections: 3 },
  ],
  leaves: { count: 6, size: 0.4 },
  season: SEASON_PROFILES.deciduous,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 300);
camera.position.set(0, 22, 46);
camera.lookAt(0, 0, -4);
scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
scene.add(ground);

// A jittered grid; the jitter comes from the tree.js Random so the forest is reproducible.
const count = number('trees', 400);
const side = Math.ceil(Math.sqrt(count));
const spacing = 3.2;
const jitter = createRandom(99);
const placements: ForestPlacement[] = [];
for (let i = 0; i < count; i++) {
  const x = ((i % side) - (side - 1) / 2) * spacing + jitter.range(-1, 1);
  const z = (Math.floor(i / side) - (side - 1) / 2) * spacing + jitter.range(-1, 1);
  placements.push({ id: i, position: [x, 0, z], rotation: jitter.range(0, Math.PI * 2), scale: jitter.range(0.8, 1.2) });
}

async function loadDefinition(): Promise<TreeDefinitionInput | TreeDefinition> {
  const species = params.get('species');
  const style = params.get('style') ?? (species ? 'low-poly' : null);
  if (!style) return definition;
  const loaded = await loadStyle(style as StyleName);
  if (species) return loaded.apply(await loadSpecies(species as SpeciesName));
  return loaded[params.get('form') === 'conifer' ? 'conifer' : 'broadleaf'];
}

/** `?fruit=<type>`: Fruit on the outermost twigs, ripe (red) in late summer. */
function withFruit(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const type = params.get('fruit') as FruitType | null;
  if (!type) return definition;
  return extendDefinition(definition, {
    fruit: { type, count: 3, size: 0.3, hang: type === 'cone' ? 0.2 : 0.8 },
    season: {
      fruit: [{ t: 0.12, value: 0 }, { t: 0.32, value: 1 }, { t: 0.62, value: 1 }, { t: 0.7, value: 0 }],
      fruitColor: [{ t: 0.25, value: '#7cb342' }, { t: 0.36, value: '#d32f2f' }],
    },
  });
}

/** `?occlusion=<0..1>`: Structural Occlusion (a Material Feature) at that strength. */
function withOcclusion(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const strength = params.get('occlusion');
  if (strength === null) return definition;
  return extendDefinition(definition, { materials: { occlusion: { strength: Number(strength) } } });
}

/** `?crownNormals=<0..1>`: the Crown Normals Material Feature (off when absent). */
function withCrownNormals(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const amount = params.get('crownNormals');
  return amount === null ? definition : extendDefinition(definition, { materials: { leaf: { crownNormals: Number(amount) } } });
}

async function main(): Promise<void> {
  const forest = createForest(withOcclusion(withCrownNormals(withFruit(await loadDefinition()))), placements, {
    variants: number('variants', 4),
    seed: number('seed', 1),
    growth: number('growth', 1),
    season: number('season', 0.37),
  });
  const cut = number('cut', 0);
  if (cut > 0) for (let i = 0; i < count; i += cut) forest.removeTree(i);
  if (params.get('uneven') === '1') {
    const half = (side * spacing) / 2;
    for (const tree of forest.trees) {
      const [x, , z] = tree.placement.position as [number, number, number];
      tree.growth = 1 - Math.min(Math.max((half - z) / (2 * half), 0), 1) * 0.6;
      tree.season = 0.37 + Math.min(Math.max((x + half) / (2 * half), 0), 1) * 0.35;
    }
  }
  await forest.ready; // textures (realistic Style) are loaded before the first frame
  scene.add(forest);

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  await renderer.renderAsync(scene, camera);
  const drawCalls = renderer.info.render.drawCalls;
  statusEl.textContent = `WebGPURenderer (${backend}) - ${forest.size} trees, ${forest.variants.length} Variants, ${drawCalls} draw calls`;
  const fruitInstances = forest.variants.reduce((sum, v) => sum + (v.fruit?.count ?? 0), 0);
  const roots = Math.min(...forest.variants.map((v) => v.data.skeleton.roots.length));
  window.forestExample = { status: 'rendered', backend, trees: forest.size, drawCalls, fruitInstances, roots };
  if (sceneWind.strength > 0 && windTime === null) renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.forestExample = { status: 'error', error: message };
  console.error(error);
});
