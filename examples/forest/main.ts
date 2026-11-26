// Forest example: hundreds of trees from a few instanced Variants on WebGPURenderer.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?trees=<n>  number of trees (default 400)
//   ?variants=<n>  number of Variants (default 4)
//   ?seed=<n>  forest seed (default 1)
//   ?growth=<0..1>  Growth of the whole forest (default 1)
//   ?season=<0..1>  Season of the whole forest (default 0.37)
//   ?uneven=1  per-tree Growth (younger towards the back) and Season (autumn towards the right)
//   ?wind=<strength>&windTime=<s>  scene-wide Wind; windTime pins the clock (Wind Bursts: window.forestExample.burst and setWindTime)
//   ?cut=<n>  remove every n-th tree after planting (the others must not change)
//   ?style=<name>&form=conifer  a built-in Style's Definition instead of the example's own
//   ?view=tycoon  look down at about 55° (a tycoon game camera) from further back, instead of the default view
//   ?species=<id>  that Species (loadSpecies, e.g. oak) in the ?style (default low-poly), with its Root Flare and Roots
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (a third instanced mesh per Variant)
//   Material Features (off by default; applied with withMaterialFeatures):
//   ?features=suggested  the ?style's SUGGESTED_MATERIAL_FEATURES (low-poly without a ?style)
//   ?crownNormals=<0..1>  Crown Normals at that amount (overrides the suggestion)
//   ?occlusion=<0..1>  Structural Occlusion at that strength (overrides the suggestion)
//   ?translucency=<strength>,<edge>,<ambient>  Leaf Translucency with those settings (overrides the suggestion)
//   Detail Levels (ADR 0010, WebGPU; on ?backend=webgl the forest draws every tree in full):
//   ?lod=1  the default distances (6 and 20 trunk heights)
//   ?lod=<light>,<impostor>[,<fade>]  Light from <light>, Impostor from <impostor> world units (fade default 0.1)
//   ?atlas=<frames>,<size>  (with distances) the Impostor atlas (default 12 frames at 2048)
//   ?lodCamera=1  (with distances) pick the Detail Levels for a camera 40 m behind the view (lod.camera)
//   ?shadows=1  the sun casts shadows (the shadow pass reuses the frame's Detail Levels)
//   ?night=1  a night scene with no light at all (dark sky and ground; only an Enchanted forest's Inner Glow shows)
//   ?plant=<n>  (with lod) plant n more trees in a row in front after Detail Levels are on, then cut every 4th
//   ?unplant=1  (with ?plant) then cut every planted tree again: the forest must look as before
//   ?cutLater=1  (with lod and ?cut) cut the trees after Detail Levels are on instead of right after planting
//   ?hook=leaves|bark[,...]  a Tree Shader Hook on those parts of the forest that tints them magenta
//   ?sceneHook=leaves|bark[,...]  the same hook as the scene-wide default (setSceneShaderHooks)
//   ?hookInputs=1  the hook paints from its inputs instead: red by each tree's position, green by the world normal
import * as THREE from 'three/webgpu';
import { fract, mix, uniform, vec3 } from 'three/tsl';
import {
  createForest,
  createRandom,
  extendDefinition,
  loadStyle,
  sceneWind,
  SEASON_PROFILES,
  selectDetailLevel,
  setSceneShaderHooks,
  SUGGESTED_MATERIAL_FEATURES,
  withMaterialFeatures,
  type Forest,
  type ForestLodOptions,
  type ForestPlacement,
  type FruitType,
  type MaterialFeatures,
  type StyleName,
  type TreeDefinition,
  type TranslucencyDefinition,
  type TreeDefinitionInput,
  type TreeShaderHook,
  type TreeShaderHooks,
  type WindBurstOptions,
} from '@casmo/tree.js';
import { loadSpecies, type SpeciesName } from '@casmo/tree.js/species';
import { setSnow, type SnowExampleOptions } from '../snow';

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
      /** With ?lod: trees drawn at each Detail Level by the GPU (a tree in a cross-fade counts at both). */
      levels?: { full: number; light: number; impostor: number };
      /** With ?lod: the same counts from the CPU's selectDetailLevel. */
      expectedLevels?: { full: number; light: number; impostor: number };
      /** Draws the frame again (the page is otherwise still), resolving once it is drawn. */
      renderAgain?: () => Promise<void>;
      /** With ?lod: sets the Growth of the whole forest, draws it and updates `levels` and `expectedLevels`. */
      setGrowth?: (growth: number) => Promise<void>;
      /** Tunes the forest's live Material Features (only those that are on), then draws the frame again. */
      setMaterialFeatures?: (features: { crownNormals?: number; translucency?: Partial<TranslucencyDefinition>; occlusionStrength?: number }) => Promise<void>;
      /**
       * Sets the magenta Tree Shader Hook on these parts of the forest (`scene`: as the scene-wide default
       * instead) and how strongly it tints (a uniform: no rebuild), then draws the frame again.
       */
      setShaderHooks?: (options: { parts?: string[]; sceneParts?: string[]; amount?: number }) => Promise<void>;
      /** Sets Snow Cover (or the facing test hook) on the forest, the snow amount and settings, and draws the frame again. */
      setSnow?: (options: SnowExampleOptions) => Promise<void>;
      /** Starts a Wind Burst on the scene-wide Wind (at its current time) and draws the frame again. */
      burst?: (options: WindBurstOptions) => Promise<void>;
      /** Pins the scene-wide Wind clock to `seconds` and draws the frame again. */
      setWindTime?: (seconds: number) => Promise<void>;
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

const night = params.get('night') === '1';
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? '#0b0a1c' : '#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 300);
if (params.get('view') === 'tycoon') {
  // About 55° down from 32 m away: the near trees ~25 m, the far edge ~65 m from the camera.
  camera.position.set(0, 26, 14);
  camera.far = 400;
  camera.updateProjectionMatrix();
} else {
  camera.position.set(0, 22, 46);
}
camera.lookAt(0, 0, -4);
// At night (?night=1) both lights are off: the scene is unlit.
scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', night ? 0 : 1.5));
const sun = new THREE.DirectionalLight('#ffffff', night ? 0 : 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
scene.add(ground);
const shadows = params.get('shadows') === '1';
if (shadows) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 0.5, far: 120 });
  sun.position.set(25, 40, 15);
  ground.receiveShadow = true;
}
// ?lodCamera=1: a camera far behind the view picks the Detail Levels (it is never rendered).
const lodCamera = new THREE.PerspectiveCamera();
lodCamera.position.set(0, 22, 46 + 40);

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

/** Material Features from the query: the Style's suggestion (`?features=suggested`), single features on top. */
function withFeatures(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const style = (params.get('style') ?? 'low-poly') as StyleName;
  const features: MaterialFeatures = params.get('features') === 'suggested' ? { ...SUGGESTED_MATERIAL_FEATURES[style] } : {};
  const crownNormals = params.get('crownNormals');
  if (crownNormals !== null) features.crownNormals = Number(crownNormals);
  const occlusion = params.get('occlusion');
  if (occlusion !== null) features.occlusion = { strength: Number(occlusion) };
  const translucency = params.get('translucency')?.split(',').map(Number);
  if (translucency) features.translucency = { strength: translucency[0]!, edge: translucency[1]!, ambient: translucency[2]! };
  return Object.keys(features).length === 0 ? definition : withMaterialFeatures(definition, features);
}

/** `?lod=1` or `?lod=<light>,<impostor>[,<fade>]`; undefined without (or with `?lod=0`). */
function lodOption(): true | ForestLodOptions | undefined {
  const lod = params.get('lod');
  if (lod === null || lod === '0') return undefined;
  const camera = params.get('lodCamera') === '1' ? { camera: lodCamera } : {};
  if (lod === '1') return true;
  const [light, impostor, fade] = lod.split(',').map(Number);
  const atlas = params.get('atlas')?.split(',').map(Number);
  const impostorAtlas = atlas ? { impostorAtlas: { frames: atlas[0]!, size: atlas[1]! } } : {};
  return { light: light!, impostor: impostor!, ...(fade !== undefined ? { fade } : {}), ...camera, ...impostorAtlas };
}

/** Trees per Detail Level as the CPU selects them for `camera`. */
function expectedLevels(forest: Forest): { full: number; light: number; impostor: number } {
  const counts = [0, 0, 0];
  const settings = forest.lod!;
  const eye = (settings.camera ?? camera).position;
  for (const tree of forest.trees) {
    const [x, y, z] = tree.placement.position as [number, number, number];
    const distance = eye.distanceTo(new THREE.Vector3(x, y, z));
    const { level, fade } = selectDetailLevel(distance, tree.placement.scale ?? 1, forest.instanceState(tree).growth, settings);
    counts[level]! += 1;
    if (fade > 0) counts[level + 1]! += 1;
  }
  return { full: counts[0]!, light: counts[1]!, impostor: counts[2]! };
}

// ?hook= / ?sceneHook=: a Tree Shader Hook that tints a part magenta, by a live amount.
const hookAmount = uniform(0.8);
const magenta: TreeShaderHook =
  params.get('hookInputs') === '1'
    ? ({ color, normal, treePosition }) => mix(color, vec3(fract(treePosition.x.mul(0.37)), normal.y.mul(0.5).add(0.5), 1), hookAmount)
    : ({ color }) => mix(color, vec3(1, 0, 1), hookAmount);
const hooksFor = (parts: string[]): TreeShaderHooks => Object.fromEntries(parts.map((part) => [part, magenta]));
const partsParam = (name: string) => params.get(name)?.split(',').filter(Boolean) ?? [];
setSceneShaderHooks(hooksFor(partsParam('sceneHook')));

async function main(): Promise<void> {
  const lod = lodOption();
  const forest = createForest(withFeatures(withFruit(await loadDefinition())), placements, {
    variants: number('variants', 4),
    seed: number('seed', 1),
    growth: number('growth', 1),
    season: number('season', 0.37),
    lod,
    shaderHooks: hooksFor(partsParam('hook')),
  });
  const cut = number('cut', 0);
  const cutTrees = () => {
    for (let i = 0; i < count; i += cut) forest.removeTree(i);
  };
  const cutLater = lod !== undefined && params.get('cutLater') === '1';
  if (cut > 0 && !cutLater) cutTrees();
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
  renderer.shadowMap.enabled = shadows;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  await renderer.renderAsync(scene, camera);
  let levels: Window['forestExample']['levels'];
  const countLevels = async () => {
    const [full, light, impostor] = await forest.detailLevelCounts(renderer);
    return { full: full!, light: light!, impostor: impostor! };
  };
  if (lod) {
    // The first frame finds the backend (and draws every tree in full); Detail Levels draw from the next.
    await forest.lodReady;
    await renderer.renderAsync(scene, camera);
    const plant = number('plant', 0);
    if (plant > 0) {
      // Past the Variants' capacity: they grow while drawing by Detail Level.
      for (let i = 0; i < plant; i++) forest.addTree({ id: `planted ${i}`, position: [(i - plant / 2) * 0.3, 0, 30 - (i % 3) * 2] });
      for (let i = 0; i < plant; i += 4) forest.removeTree(`planted ${i}`);
      if (params.get('unplant') === '1') {
        await renderer.renderAsync(scene, camera);
        for (let i = 0; i < plant; i++) forest.removeTree(`planted ${i}`);
      }
      await renderer.renderAsync(scene, camera);
    }
    if (cut > 0 && cutLater) {
      // Swap-removes on a forest that draws by Detail Level: the other trees must not change.
      cutTrees();
      await renderer.renderAsync(scene, camera);
    }
    if (backend === 'webgpu') levels = await countLevels();
  }
  const drawCalls = renderer.info.render.drawCalls;
  statusEl.textContent = `WebGPURenderer (${backend}) - ${forest.size} trees, ${forest.variants.length} Variants, ${drawCalls} draw calls`;
  const fruitInstances = forest.variants.reduce((sum, v) => sum + (v.fruit?.count ?? 0), 0);
  const roots = Math.min(...forest.variants.map((v) => v.data.skeleton.roots.length));
  window.forestExample = {
    status: 'rendered',
    backend,
    trees: forest.size,
    drawCalls,
    fruitInstances,
    roots,
    ...(levels ? { levels, expectedLevels: expectedLevels(forest) } : {}),
    renderAgain: () => renderer.renderAsync(scene, camera),
    setMaterialFeatures: async ({ crownNormals, translucency, occlusionStrength }) => {
      if (crownNormals !== undefined) forest.crownNormals = crownNormals;
      if (translucency !== undefined) forest.translucency = translucency;
      if (occlusionStrength !== undefined) forest.occlusionStrength = occlusionStrength;
      await renderer.renderAsync(scene, camera);
    },
    setShaderHooks: async ({ parts, sceneParts, amount }) => {
      if (parts !== undefined) forest.shaderHooks = hooksFor(parts);
      if (sceneParts !== undefined) setSceneShaderHooks(hooksFor(sceneParts));
      if (amount !== undefined) hookAmount.value = amount;
      await renderer.renderAsync(scene, camera);
    },
    setSnow: async (options) => {
      await setSnow((hooks) => (forest.shaderHooks = hooks), options);
      await renderer.renderAsync(scene, camera);
    },
    burst: async (options) => {
      sceneWind.burst(options);
      await renderer.renderAsync(scene, camera);
    },
    setWindTime: async (seconds) => {
      sceneWind.time = seconds;
      await renderer.renderAsync(scene, camera);
    },
    ...(levels
      ? {
          setGrowth: async (growth: number) => {
            forest.growth = growth;
            await renderer.renderAsync(scene, camera);
            Object.assign(window.forestExample, { levels: await countLevels(), expectedLevels: expectedLevels(forest) });
          },
        }
      : {}),
  };
  if (sceneWind.strength > 0 && windTime === null) renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.forestExample = { status: 'error', error: message };
  console.error(error);
});
