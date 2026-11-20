// Tree Effects example: one Style tree next to non-tree objects, rendered through a RenderPipeline.
// Query parameters (used by the Playwright tests):
//   ?style=low-poly|stylized|realistic|painterly  the tree's Style (default low-poly)
//   ?form=conifer  conifer instead of broadleaf
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (Tree Effects treat it as tree pixels)
//   ?effects=none|outline|glow|grade|style  one effect, the Style's suggested combination (default), or none
//   ?effects=inner-lines  Inner Lines (from depth and normal edges, the normal channel turned on)
//   ?view=mask  show the tree mask (red = tree, green = leaves) instead of the image
//   ?view=treeId  add a second Tree and a small Forest, and show the Tree ID channel (one colour per
//                 ID, black = 0); exposes `effectsExample.readTreeIds()` for the Playwright tests
//   ?pick=tree|second|f0|f1  the scene of ?view=treeId through TreeEffects with `treeId: true`: after
//                 rendering, `effects.pick()` at that tree's trunk (a fixed point); the result is in
//                 `effectsExample.picked` (the name of the picked tree, null for none)
//   ?overlap=plain|between  the scene of ?view=treeId (a second Tree and a small Forest, overlapping
//                 on screen); `between` adds the ID outline: `outline.betweenTrees` on the outline
//   ?highlight=tree|second|f0|f1  the scene of ?view=treeId through TreeEffects with a Highlight:
//                 hover a tree to highlight it (`effects.pick`). After rendering, that tree is picked
//                 at its trunk and highlighted; the result is in `effectsExample.picked`
//   ?pipeline=custom  build the pipeline by hand (treeEffectsPass + applyTreeEffects) with an extra
//                     user effect (vignette) on top, to show the effects compose with other effects
//   ?lod=full|light|impostor  add the small Forest of ?view=treeId (to any view) drawing by Detail Level:
//                 f0 and f1 at that level, plus one tree behind the camera in full (Detail Levels
//                 need WebGPU); `effectsExample.levels` = trees per level
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?depth=reversed|log  render with a reversed or a logarithmic depth buffer (the depth-reading
//                        effects, betweenTrees and Inner Lines, must look the same)
//   ?from=tweaked  start with other colours and numbers for the same effects and switch to the
//                  chosen ones with `effects.set()` (no new graph), to show `set()` updates the look
import * as THREE from 'three/webgpu';
import { float, ivec2, mrt, output, pass, screenCoordinate, select, uint, vec3, vec4 } from 'three/tsl';
import { screenUV } from 'three/tsl';
import { createForest, createTree, extendDefinition, type Forest, type ForestLodOptions, type ForestPlacement, type FruitType, type TreeDefinition, type TreeStyle } from '@casmo/tree.js';
import {
  applyTreeEffects,
  createTreeEffects,
  readTreeId,
  SUGGESTED_TREE_EFFECTS,
  TREE_ID,
  treeEffectsPass,
  treeFromId,
  treeIdMRT,
  treeIdOf,
  treeIdTexture,
  treeMaskMRT,
  type TreeEffectsSettings,
} from '@casmo/tree.js/effects';
import { framingBox } from '../framing';

const styles: Record<string, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('@casmo/tree.js/styles/low-poly'),
  stylized: () => import('@casmo/tree.js/styles/stylized'),
  realistic: () => import('@casmo/tree.js/styles/realistic'),
  painterly: () => import('@casmo/tree.js/styles/painterly'),
};

declare global {
  interface Window {
    effectsExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      rebuilt?: boolean;
      /** `?pick=<name>`: the point picked (CSS pixels) and the name of the tree `effects.pick()` resolved to. */
      picked?: { name: string | null; x: number; y: number };
      /** `?view=treeId`: the Tree ID read under each tree's trunk, its expected ID and the tree it resolves to. */
      readTreeIds?: () => Promise<{ name: string; id: number; expected: number | undefined; resolved: string | null }[]>;
      /** `?view=treeId`: hides the main tree and the ground (sky behind its trunk) and renders once more. */
      hideTree?: () => void;
      /** `?view=treeId`: hides every object (a frame in which nothing is drawn) and renders once more. */
      hideAll?: () => void;
      /** `?lod=<level>`: the Forest trees the GPU drew at each Detail Level (Full, Light, Impostor). */
      levels?: number[];
      /** Each named tree's trunk point (see `?pick`) in CSS pixels on the canvas. */
      trunks?: Record<string, { x: number; y: number }>;
    };
  }
}

window.effectsExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const styleName = (params.get('style') ?? 'low-poly') as keyof typeof SUGGESTED_TREE_EFFECTS;
const form = params.get('form') === 'conifer' ? 'conifer' : 'broadleaf';
const effectsParam = params.get('effects') ?? 'style';
const statusEl = document.getElementById('status')!;
const lodName = params.get('lod');
if (lodName !== null && !['full', 'light', 'impostor'].includes(lodName)) throw new Error(`Unknown lod "${lodName}"`);

/**
 * `?lod=full|light|impostor`: switch distances (no fade) that put f0 and f1 at that Detail Level and
 * the tree `near` (`near` units from the camera) in full, so f0 and f1 sit at other places in their
 * level list than in the Variant (slot ≠ instance index).
 */
function lodFor(name: string, near: number, far: number): ForestLodOptions {
  const between = (k: number) => near + (far - near) * k;
  if (name === 'impostor') return { light: between(1 / 3), impostor: between(2 / 3), fade: 0 };
  if (name === 'light') return { light: between(1 / 2), impostor: 1e4, fade: 0 };
  return { light: 1e4, impostor: 1e4, fade: 0 };
}

/** One effect of the Style's combination (with its settings, or a default), all of it, or none. */
function chosenEffects(): TreeEffectsSettings {
  const settings = SUGGESTED_TREE_EFFECTS[styleName];
  switch (effectsParam) {
    case 'none':
      return {};
    case 'outline': {
      // The plain outline; `?overlap=between` adds the lines between trees.
      return { outline: { ...settings.outline, betweenTrees: undefined } };
    }
    case 'glow':
      return { glow: settings.glow ?? { intensity: 0.8 } };
    case 'grade':
      return { grade: settings.grade ?? { saturation: 1.3 } };
    case 'inner-lines':
      return { innerLines: {} }; // the defaults, the same for every Style
    case 'style':
      return settings;
    default:
      throw new Error(`Unknown effects "${effectsParam}"`);
  }
}

/** `?overlap=between`: the outline also between overlapping trees (the Tree ID channel comes with it). */
function withBetweenTrees(settings: TreeEffectsSettings): TreeEffectsSettings {
  if (params.get('overlap') !== 'between' || !settings.outline) return settings;
  return { ...settings, outline: { ...settings.outline, betweenTrees: true } };
}

/** The same effects as `settings` with every colour and number changed (the same shape). */
function tweaked(settings: TreeEffectsSettings): TreeEffectsSettings {
  return {
    ...(settings.grade && { grade: { exposure: 1.3, saturation: 0.2, contrast: 1.5, tint: '#88aaff' } }),
    ...(settings.glow && { glow: { color: '#ff0000', intensity: 2, threshold: 0.01, radius: settings.glow.radius } }),
    ...(settings.innerLines && { innerLines: { color: '#0000ff', thickness: 2, strength: 1, normalThreshold: 0.2, depthThreshold: 0.05 } }),
    ...(settings.outline && { outline: { color: '#ff00ff', thickness: 5, strength: 0.4, betweenTrees: settings.outline.betweenTrees } }),
  };
}

/** `?fruit=<type>`: big ripe Fruit on the outermost twigs, so the effects have Fruit to cover. */
function withFruit(definition: TreeDefinition): TreeDefinition {
  const type = params.get('fruit') as FruitType | null;
  if (!type) return definition;
  return extendDefinition(definition, {
    fruit: { type, count: 3, size: 0.35, hang: type === 'cone' ? 0.2 : 0.8 },
    season: { fruitColor: [{ t: 0, value: '#d32f2f' }] },
  });
}

async function main(): Promise<void> {
  const load = styles[styleName];
  if (!load) throw new Error(`Unknown style "${styleName}"`);
  const definition = withFruit((await load()).default[form]);
  const tree = createTree(definition, { seed: 1, season: 0.37 });
  await tree.ready;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f0');
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.position.set(5, 8, 3);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  scene.add(ground, tree);

  // Frame the tree, then put non-tree objects in front of and next to it.
  const box = framingBox(tree); // underground Roots don't shift the view
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  const distance = (Math.max(size.x, size.y, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.3;
  const direction = new THREE.Vector3(1, 0.35, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.lookAt(centre);
  const s = size.y / 6;
  const crate = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5), new THREE.MeshStandardNodeMaterial({ color: '#c0503a' }));
  crate.position.copy(centre).addScaledVector(direction, size.x * 0.6).setY(s * 0.75);
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), new THREE.MeshStandardNodeMaterial({ color: '#8a8f99', flatShading: true }));
  rock.position.set(centre.x - size.x * 0.7, s * 0.5, centre.z + size.z * 0.7);
  scene.add(crate, rock);

  // `?view=treeId`: more trees to tell apart, a second Tree and a Forest, overlapping on screen.
  const treeIdView = params.get('view') === 'treeId';
  const highlightName = params.get('highlight');
  const pickName = params.get('pick') ?? highlightName;
  const overlap = params.has('overlap');
  // Each tree with a point on its trunk (a little above the ground), to read its ID under.
  const trunk = (x: number, z: number) => new THREE.Vector3(x, size.y * 0.12, z);
  const named = new Map<string, { tree: Parameters<typeof treeIdOf>[0]; at: THREE.Vector3 }>([['tree', { tree, at: trunk(0, 0) }]]);
  let forest: Forest | undefined;
  if (treeIdView || pickName || overlap || lodName) {
    const back = new THREE.Vector3(-direction.x, 0, -direction.z).normalize();
    const side = new THREE.Vector3(back.z, 0, -back.x);
    const second = createTree(definition, { seed: 2, season: 0.37 });
    second.position.copy(centre).addScaledVector(back, size.x * 0.8).addScaledVector(side, size.x * 0.45).setY(0);
    const spots = [-1.1, 1.1].map((k) => centre.clone().addScaledVector(back, size.x * 1.4).addScaledVector(side, size.x * k));
    const placements: ForestPlacement[] = spots.map((p, i) => ({ id: `f${i}`, position: [p.x, 0, p.z] }));
    let lod: ForestLodOptions | undefined;
    if (lodName) {
      // One Variant with a tree behind the camera (out of view: further back than its crown is wide) in its first slot.
      const near = camera.position.clone().addScaledVector(new THREE.Vector3(direction.x, 0, direction.z).normalize(), size.x * 1.5).setY(0);
      placements.unshift({ id: 'near', position: [near.x, 0, near.z] });
      lod = lodFor(lodName, camera.position.distanceTo(near), Math.min(...spots.map((p) => camera.position.distanceTo(p.clone().setY(0)))));
    }
    forest = createForest(definition, placements, { variants: lodName ? 1 : 2, seed: 1, season: 0.37, lod });
    await Promise.all([second.ready, forest.ready]);
    scene.add(second, forest);
    named.set('second', { tree: second, at: trunk(second.position.x, second.position.z) });
    for (const [i, at] of spots.entries()) named.set(`f${i}`, { tree: forest.get(`f${i}`)!, at: trunk(at.x, at.z) });
    // Hand out the IDs in a fixed order, so the ID colours are the same on every run.
    for (const { tree: t } of named.values()) treeIdOf(t);
  }

  const depthBuffer = params.get('depth');
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    forceWebGL: params.get('backend') === 'webgl',
    reversedDepthBuffer: depthBuffer === 'reversed',
    logarithmicDepthBuffer: depthBuffer === 'log',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `Tree Effects (${backend}) - ${styleName} ${form} - ${effectsParam}`;

  const settings = withBetweenTrees(chosenEffects());

  let render: () => void;
  let rebuilt: boolean | undefined;
  let pick: (() => Promise<NonNullable<typeof window.effectsExample.picked>>) | undefined;
  /** A tree's trunk point in CSS pixels on the canvas. */
  const onScreen = (at: THREE.Vector3) => {
    const ndc = at.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * renderer.domElement.clientWidth, y: ((1 - ndc.y) / 2) * renderer.domElement.clientHeight };
  };
  /** The name of a tree in the scene, `null` for none. */
  const nameOf = (found: ReturnType<typeof treeFromId>) => (found === undefined ? null : ([...named].find(([, v]) => v.tree === found)?.[0] ?? 'other'));
  if (treeIdView) {
    // The Tree ID building block in a hand-built scene pass: one colour per ID (black = no tree).
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()).merge(treeIdMRT()));
    treeIdTexture(scenePass);
    const ids = scenePass.getTextureNode(TREE_ID).load(ivec2(screenCoordinate.xy));
    const id = uint(ids.x);
    const hash = id.mul(uint(2654435761));
    const rgb = vec3(hash.bitAnd(uint(255)), hash.shiftRight(uint(8)).bitAnd(uint(255)), hash.shiftRight(uint(16)).bitAnd(uint(255)));
    pipeline.outputColorTransform = false;
    pipeline.outputNode = vec4(select(id.equal(uint(0)), vec3(0), vec3(rgb).div(255).mul(0.8).add(0.2)), 1);
    render = () => pipeline.render();
    window.effectsExample.readTreeIds = async () => {
      const result = [];
      for (const [name, { tree: t, at }] of named) {
        const { x, y } = onScreen(at);
        const read = await readTreeId(renderer, scenePass, x, y);
        const resolved = nameOf(treeFromId(read));
        result.push({ name, id: read, expected: treeIdOf(t), resolved });
      }
      return result;
    };
    window.effectsExample.hideTree = () => {
      tree.visible = ground.visible = false;
      render();
    };
    window.effectsExample.hideAll = () => {
      for (const object of scene.children) object.visible = false;
      render();
    };
  } else if (params.get('view') === 'mask' || params.get('pipeline') === 'custom') {
    // A hand-built pipeline: the Tree Effects are nodes among the user's own.
    const pipeline = new THREE.RenderPipeline(renderer);
    // The channels the chosen effects need (the low-poly and stylized suggestions use Inner Lines).
    const input = treeEffectsPass(scene, camera, null, { normal: !!settings.innerLines, treeId: !!settings.outline?.betweenTrees });
    if (params.get('view') === 'mask') {
      pipeline.outputColorTransform = false;
      pipeline.outputNode = vec4(input.mask.rgb, 1);
    } else {
      const treeColor = applyTreeEffects(input, settings);
      // The user's own effect afterwards: a vignette over the whole image.
      const vignette = float(1).sub(screenUV.sub(0.5).length().mul(0.9).pow(2));
      pipeline.outputNode = vec4(treeColor.rgb.mul(vignette), 1);
    }
    render = () => pipeline.render();
  } else if (pickName) {
    // GPU picking through the ready-made pipeline: the Tree ID channel on without an effect needing it.
    const target = named.get(pickName);
    if (!target) throw new Error(`Unknown tree to pick "${pickName}"`);
    const effects = createTreeEffects(renderer, scene, camera, {
      effects: highlightName ? { ...settings, highlight: {} } : settings,
      treeId: true,
    });
    render = () => effects.render();
    /** Highlights the tree under a point (none off the trees) and renders. */
    const highlightAt = async (x: number, y: number) => {
      const found = await effects.pick(x, y);
      effects.highlighted.splice(0, effects.highlighted.length, ...(found ? [found] : []));
      render();
      return found;
    };
    if (highlightName) {
      // Hover-to-highlight: the list is read every frame, so changing it never recompiles.
      let picking = false;
      renderer.domElement.addEventListener('pointermove', (event) => {
        if (picking) return;
        picking = true;
        void highlightAt(event.offsetX, event.offsetY).finally(() => (picking = false));
      });
    }
    pick = async () => {
      const { x, y } = onScreen(target.at);
      if (!highlightName) return { name: nameOf(await effects.pick(x, y)), x, y };
      const found = await highlightAt(x, y);
      await new Promise(requestAnimationFrame);
      render();
      return { name: nameOf(found), x, y };
    };
  } else if (params.get('from') === 'tweaked') {
    const effects = createTreeEffects(renderer, scene, camera, { effects: tweaked(settings) });
    for (let i = 0; i < 2; i++) {
      effects.render();
      await new Promise(requestAnimationFrame);
    }
    const before = effects.pipeline.outputNode;
    effects.set(settings);
    rebuilt = effects.pipeline.outputNode !== before;
    render = () => effects.render();
  } else {
    const effects = createTreeEffects(renderer, scene, camera, { effects: settings });
    render = () => effects.render();
  }
  // Post-processing passes (the outline's selection passes) build their pipelines on first use;
  // render a few frames so the screenshot shows the settled image.
  for (let i = 0; i < Number(params.get('frames') ?? 4); i++) {
    render();
    // ?lod: the first frame turns the Detail Levels on (and bakes the Impostors); draw by level from the next.
    if (i === 0 && forest?.lod) await forest.lodReady;
    await new Promise(requestAnimationFrame);
  }
  const levels = forest?.lod ? await forest.detailLevelCounts(renderer) : undefined;
  const picked = await pick?.();
  const trunks = Object.fromEntries([...named].map(([name, { at }]) => [name, onScreen(at)]));
  window.effectsExample = { ...window.effectsExample, status: 'rendered', backend, rebuilt, picked, levels, trunks };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.effectsExample = { status: 'error', error: message };
  console.error(error);
});
