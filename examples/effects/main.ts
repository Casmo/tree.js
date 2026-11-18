// Tree Effects example: one Style tree next to non-tree objects, rendered through a RenderPipeline.
// Query parameters (used by the Playwright tests):
//   ?style=low-poly|stylized|realistic  the tree's Style (default low-poly)
//   ?form=conifer  conifer instead of broadleaf
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (Tree Effects treat it as tree pixels)
//   ?effects=none|outline|glow|grade|style  one effect, the Style's suggested combination (default), or none
//   ?view=mask  show the tree mask (red = tree, green = leaves) instead of the image
//   ?pipeline=custom  build the pipeline by hand (treeEffectsPass + applyTreeEffects) with an extra
//                     user effect (vignette) on top, to show the effects compose with other effects
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
import * as THREE from 'three/webgpu';
import { float, screenUV, vec4 } from 'three/tsl';
import { createTree, extendDefinition, type FruitType, type TreeDefinition, type TreeStyle } from '@casmo/tree.js';
import {
  applyTreeEffects,
  createTreeEffects,
  SUGGESTED_TREE_EFFECTS,
  treeEffectsPass,
  type TreeEffectsSettings,
} from '@casmo/tree.js/effects';

const styles: Record<string, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('@casmo/tree.js/styles/low-poly'),
  stylized: () => import('@casmo/tree.js/styles/stylized'),
  realistic: () => import('@casmo/tree.js/styles/realistic'),
};

declare global {
  interface Window {
    effectsExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string };
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
  const tree = createTree(withFruit((await load()).default[form]), { seed: 1, season: 0.37 });
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
  const box = new THREE.Box3().setFromObject(tree);
  if (box.max.y > 0) box.min.y = Math.max(box.min.y, 0); // underground Roots don't shift the view
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

  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `Tree Effects (${backend}) - ${styleName} ${form} - ${effectsParam}`;

  const settings = chosenEffects();

  let render: () => void;
  if (params.get('view') === 'mask' || params.get('pipeline') === 'custom') {
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
  window.effectsExample = { status: 'rendered', backend };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.effectsExample = { status: 'error', error: message };
  console.error(error);
});
