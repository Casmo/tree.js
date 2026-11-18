// Tree Effects example: one Style tree next to non-tree objects, rendered through a RenderPipeline.
// Query parameters (used by the Playwright tests):
//   ?style=low-poly|stylized|realistic  the tree's Style (default low-poly)
//   ?form=conifer  conifer instead of broadleaf
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (Tree Effects treat it as tree pixels)
//   ?effects=none|outline|glow|grade|style  one effect, the Style's suggested combination (default), or none
//   ?view=mask  show the tree mask (red = tree, green = leaves) instead of the image
//   ?view=treeId  add a second Tree and a small Forest, and show the Tree ID channel (one colour per
//                 ID, black = 0); exposes `effectsExample.readTreeIds()` for the Playwright tests
//   ?pipeline=custom  build the pipeline by hand (treeEffectsPass + applyTreeEffects) with an extra
//                     user effect (vignette) on top, to show the effects compose with other effects
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
import * as THREE from 'three/webgpu';
import { float, ivec2, mrt, output, pass, screenCoordinate, select, uint, vec3, vec4 } from 'three/tsl';
import { screenUV } from 'three/tsl';
import { createForest, createTree, extendDefinition, type FruitType, type TreeDefinition, type TreeStyle } from '@casmo/tree.js';
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
};

declare global {
  interface Window {
    effectsExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** `?view=treeId`: the Tree ID read under each tree's trunk, its expected ID and the tree it resolves to. */
      readTreeIds?: () => Promise<{ name: string; id: number; expected: number | undefined; resolved: string | null }[]>;
      /** `?view=treeId`: hides the main tree and the ground (sky behind its trunk) and renders once more. */
      hideTree?: () => void;
    };
  }
}

window.effectsExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const styleName = (params.get('style') ?? 'low-poly') as keyof typeof SUGGESTED_TREE_EFFECTS;
const form = params.get('form') === 'conifer' ? 'conifer' : 'broadleaf';
const effectsParam = params.get('effects') ?? 'style';
const statusEl = document.getElementById('status')!;

/** One effect of the Style's combination (with its settings, or a default), all of it, or none. */
function chosenEffects(): TreeEffectsSettings {
  const settings = SUGGESTED_TREE_EFFECTS[styleName];
  switch (effectsParam) {
    case 'none':
      return {};
    case 'outline':
      return { outline: settings.outline ?? {} };
    case 'glow':
      return { glow: settings.glow ?? { intensity: 0.8 } };
    case 'grade':
      return { grade: settings.grade ?? { saturation: 1.3 } };
    case 'style':
      return settings;
    default:
      throw new Error(`Unknown effects "${effectsParam}"`);
  }
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
  // Each tree with a point on its trunk (a little above the ground), to read its ID under.
  const trunk = (x: number, z: number) => new THREE.Vector3(x, size.y * 0.12, z);
  const named = new Map<string, { tree: Parameters<typeof treeIdOf>[0]; at: THREE.Vector3 }>([['tree', { tree, at: trunk(0, 0) }]]);
  if (treeIdView) {
    const back = new THREE.Vector3(-direction.x, 0, -direction.z).normalize();
    const side = new THREE.Vector3(back.z, 0, -back.x);
    const second = createTree(definition, { seed: 2, season: 0.37 });
    second.position.copy(centre).addScaledVector(back, size.x * 0.8).addScaledVector(side, size.x * 0.45).setY(0);
    const spots = [-1.1, 1.1].map((k) => centre.clone().addScaledVector(back, size.x * 1.4).addScaledVector(side, size.x * k));
    const forest = createForest(definition, spots.map((p, i) => ({ id: `f${i}`, position: [p.x, 0, p.z] })), {
      variants: 2,
      seed: 1,
      season: 0.37,
    });
    await Promise.all([second.ready, forest.ready]);
    scene.add(second, forest);
    named.set('second', { tree: second, at: trunk(second.position.x, second.position.z) });
    for (const [i, at] of spots.entries()) named.set(`f${i}`, { tree: forest.get(`f${i}`)!, at: trunk(at.x, at.z) });
    // Hand out the IDs in a fixed order, so the ID colours are the same on every run.
    for (const { tree: t } of named.values()) treeIdOf(t);
  }

  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `Tree Effects (${backend}) - ${styleName} ${form} - ${effectsParam}`;

  const settings = chosenEffects();

  let render: () => void;
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
        const ndc = at.clone().project(camera);
        const x = ((ndc.x + 1) / 2) * renderer.domElement.clientWidth;
        const y = ((1 - ndc.y) / 2) * renderer.domElement.clientHeight;
        const read = await readTreeId(renderer, scenePass, x, y);
        const found = treeFromId(read);
        const resolved = found === undefined ? null : ([...named].find(([, v]) => v.tree === found)?.[0] ?? 'other');
        result.push({ name, id: read, expected: treeIdOf(t), resolved });
      }
      return result;
    };
    window.effectsExample.hideTree = () => {
      tree.visible = ground.visible = false;
      render();
    };
  } else if (params.get('view') === 'mask' || params.get('pipeline') === 'custom') {
    // A hand-built pipeline: the Tree Effects are nodes among the user's own.
    const pipeline = new THREE.RenderPipeline(renderer);
    const input = treeEffectsPass(scene, camera);
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
  } else {
    const effects = createTreeEffects(renderer, scene, camera, { effects: settings });
    render = () => effects.render();
  }
  // Post-processing passes (the outline's selection passes) build their pipelines on first use;
  // render a few frames so the screenshot shows the settled image.
  for (let i = 0; i < Number(params.get('frames') ?? 4); i++) {
    render();
    await new Promise(requestAnimationFrame);
  }
  window.effectsExample = { ...window.effectsExample, status: 'rendered', backend };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.effectsExample = { status: 'error', error: message };
  console.error(error);
});
