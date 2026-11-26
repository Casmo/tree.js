// Custom Tree Effect example: the bare setup of a Tree Effect of your own that only touches foliage.
// Start from `foliageOnly` below and put your own look (a brush, a posterize, a hatch...) in `look`.
// Query parameters (used by the Playwright tests):
//   ?effect=on|pass-through|off  the custom effect with a demo look (default), the bare pass-through
//                                (your look = the colour itself), or no custom effect at all
//   ?effects=style  the Style's suggested Tree Effects too (the custom effect runs before the outline)
//   ?style=low-poly|stylized|realistic|painterly  the tree's Style (default stylized)
//   ?view=mask  show the tree mask (red = tree, green = leaves) instead of the image
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
import * as THREE from 'three/webgpu';
import { color, mix, uniform, vec4 } from 'three/tsl';
import { createTree, type TreeStyle } from '@casmo/tree.js';
import { createTreeEffects, SUGGESTED_TREE_EFFECTS, type CustomTreeEffect } from '@casmo/tree.js/effects';
import { framingBox } from '../framing';

const styles: Record<string, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('@casmo/tree.js/styles/low-poly'),
  stylized: () => import('@casmo/tree.js/styles/stylized'),
  realistic: () => import('@casmo/tree.js/styles/realistic'),
  painterly: () => import('@casmo/tree.js/styles/painterly'),
  whimsical: () => import('@casmo/tree.js/styles/whimsical'),
};

declare global {
  interface Window {
    customEffectExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string };
  }
}

window.customEffectExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const styleName = (params.get('style') ?? 'stylized') as keyof typeof SUGGESTED_TREE_EFFECTS;
const effectParam = params.get('effect') ?? 'on';
if (!['on', 'pass-through', 'off'].includes(effectParam)) throw new Error(`Unknown effect "${effectParam}"`);
const statusEl = document.getElementById('status')!;

/** The options of the custom effect: how strongly the look replaces the leaf colour (0..1). */
interface FoliageOptions {
  strength: number;
}

/**
 * A foliage-only custom Tree Effect. `input.color` is the colour so far, `input.mask` the tree mask:
 * its `g` channel is 1 on leaf pixels and 0 everywhere else (bark, Fruit, the rest of the scene).
 * Options that change live are uniforms, set in `update()`.
 */
function foliageOnly(demo: boolean): CustomTreeEffect<FoliageOptions> {
  return {
    before: 'outline', // under the outline, when it is on
    build(input, options) {
      const strength = uniform(options.strength);
      // Your look goes here. The pass-through: the colour itself. The demo: a warm autumn tint.
      const look = demo ? input.color.rgb.mul(color('#ffb347')).mul(1.6) : input.color.rgb;
      const node = vec4(mix(input.color.rgb, look, input.mask.g.mul(strength)), input.color.a);
      return { node, update: (next) => (strength.value = next.strength) };
    },
  };
}

async function main(): Promise<void> {
  const load = styles[styleName];
  if (!load) throw new Error(`Unknown style "${styleName}"`);
  const tree = createTree((await load()).default.broadleaf, { seed: 1, season: 0.37 });
  await tree.ready;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f0');
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.position.set(5, 8, 3);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  scene.add(ground, tree);

  const box = framingBox(tree);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  const distance = (Math.max(size.x, size.y, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.3;
  const direction = new THREE.Vector3(1, 0.35, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.lookAt(centre);
  // A non-tree object next to the tree: the effect must leave it alone.
  const s = size.y / 6;
  const crate = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5), new THREE.MeshStandardNodeMaterial({ color: '#c0503a' }));
  crate.position.copy(centre).addScaledVector(direction, size.x * 0.6).setY(s * 0.75);
  scene.add(crate);

  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `custom Tree Effect (${backend}) - ${styleName} - ${effectParam}`;

  // The setup: the ready-made TreeEffects pipeline, plus the custom effect with its options.
  const effects = createTreeEffects(renderer, scene, camera, { effects: params.get('effects') === 'style' ? styleName : null });
  if (effectParam !== 'off') {
    const foliage = foliageOnly(effectParam === 'on');
    effects.addEffect(foliage, { strength: 0.2 });
    effects.updateEffect(foliage, { strength: 0.8 }); // live, e.g. from a slider: no new graph
  }

  let render = () => effects.render();
  if (params.get('view') === 'mask') {
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false;
    pipeline.outputNode = vec4(effects.scenePass.mask.rgb, 1);
    render = () => pipeline.render();
  }
  for (let i = 0; i < 3; i++) {
    render();
    await new Promise(requestAnimationFrame);
  }
  window.customEffectExample = { status: 'rendered', backend };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.customEffectExample = { status: 'error', error: message };
  console.error(error);
});
