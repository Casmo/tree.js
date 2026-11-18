// Material Features example: the same tree twice, on the left as the Style draws it (no Material
// Features) and on the right with that Style's SUGGESTED_MATERIAL_FEATURES, applied with
// withMaterialFeatures. The sun stands low behind the trees, so Leaf Translucency shows as well as
// Crown Normals and Structural Occlusion. Nothing else changes: same renderer, scene, lights.
// Query parameters (used by the Playwright tests):
//   ?style=low-poly|stylized|realistic  the trees' Style (default stylized)
//   ?species=<id>  that Species (loadSpecies, e.g. oak) instead of the Style's own broadleaf
//   ?form=conifer  the Style's conifer instead of its broadleaf
//   ?seed=<n>  the Seed of both trees (default 1)
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?light=front  the sun behind the camera instead of behind the trees
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
import * as THREE from 'three/webgpu';
import { createTree, loadStyle, SUGGESTED_MATERIAL_FEATURES, withMaterialFeatures, type StyleName } from '@casmo/tree.js';
import { loadSpecies, type SpeciesName } from '@casmo/tree.js/species';
import { framingBox } from '../framing';

declare global {
  interface Window {
    featuresExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string };
  }
}

window.featuresExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const styleName = (params.get('style') ?? 'stylized') as StyleName;
const seed = Number(params.get('seed') ?? 1);
const season = Number(params.get('season') ?? 0.37);
const statusEl = document.getElementById('status')!;

async function main(): Promise<void> {
  const style = await loadStyle(styleName);
  const species = params.get('species');
  const definition = species
    ? style.apply(await loadSpecies(species as SpeciesName))
    : style[params.get('form') === 'conifer' ? 'conifer' : 'broadleaf'];

  // The whole opt-in: one line.
  const withFeatures = withMaterialFeatures(definition, SUGGESTED_MATERIAL_FEATURES[styleName]);

  const off = createTree(definition, { seed, season });
  const on = createTree(withFeatures, { seed, season });
  await Promise.all([off.ready, on.ready]);

  // Side by side, a little more than a crown apart.
  const size = framingBox(off).getSize(new THREE.Vector3());
  const gap = Math.max(size.x, size.z) * 0.6 + 0.5;
  off.position.x = -gap;
  on.position.x = gap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f0');
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
  sun.position.set(...((params.get('light') === 'front' ? [4, 8, 10] : [-9, 6, -6]) as [number, number, number]));
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  scene.add(ground, off, on);

  // Frame both trees from the front.
  const box = framingBox(off).union(framingBox(on));
  const both = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
  const fit = Math.max(both.y, both.x / camera.aspect) / 2 / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(centre.x, centre.y + both.y * 0.1, centre.z + fit * 1.15 + both.z / 2);
  camera.lookAt(centre);

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `Material Features (${backend}) - ${styleName} ${species ?? ''} - off | suggested`;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.render(scene, camera);
  });
  await renderer.renderAsync(scene, camera);
  window.featuresExample = { status: 'rendered', backend };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.featuresExample = { status: 'error', error: message };
  console.error(error);
});
