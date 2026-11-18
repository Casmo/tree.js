// Species example: pick any Species of the collection and any built-in Style; the Style turns the
// Species into a Tree Definition (`style.apply(species)`) and createTree grows it.
// Query parameters (also kept in sync with the pickers, so a view can be shared):
//   ?species=<id>  a Species id (default oak), e.g. douglas-fir
//   ?style=low-poly|stylized|realistic  (default low-poly)
//   ?seed=<n>  (default 1)   ?season=<0..1>  (default 0.37, summer)
import * as THREE from 'three/webgpu';
import { createTree, loadStyle, STYLE_NAMES, type StyleName, type Tree } from '@casmo/tree.js';
// The namespace import bundles every Species, for their names in the picker; an app that knows
// which Species it needs imports them by name (`import { oak } ...`) or uses loadSpecies(id).
import * as collection from '@casmo/tree.js/species';
import { SPECIES_NAMES, type SpeciesDefinition, type SpeciesName } from '@casmo/tree.js/species';
import { framingBox } from '../framing';

declare global {
  interface Window {
    speciesExample: {
      status: 'loading' | 'rendered' | 'error';
      error?: string;
      species?: string;
      style?: StyleName;
      /** `materials.shading` of the grown Definition (flat / toon / standard). */
      shading?: string;
      /** Trees in the scene (the previous one is disposed of). */
      trees?: number;
    };
  }
}

window.speciesExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const season = Number(params.get('season') ?? 0.37);
const statusEl = document.getElementById('status')!;
const speciesSelect = document.getElementById('species') as HTMLSelectElement;
const styleSelect = document.getElementById('style') as HTMLSelectElement;

const SPECIES = new Map<string, SpeciesDefinition>(
  Object.values(collection)
    .filter((value): value is SpeciesDefinition => typeof value === 'object' && value !== null && 'form' in value && 'id' in value)
    .map((species) => [species.id, species]),
);

for (const form of ['broadleaf', 'conifer'] as const) {
  const group = document.createElement('optgroup');
  group.label = form[0]!.toUpperCase() + form.slice(1);
  for (const id of SPECIES_NAMES) {
    const species = SPECIES.get(id);
    if (species?.form === form) group.append(new Option(species.name, id));
  }
  speciesSelect.append(group);
}
for (const style of STYLE_NAMES) styleSelect.append(new Option(style, style));
const initialSpecies = params.get('species') ?? 'oak';
const initialStyle = params.get('style') ?? 'low-poly';
speciesSelect.value = SPECIES.has(initialSpecies) ? initialSpecies : 'oak';
styleSelect.value = (STYLE_NAMES as string[]).includes(initialStyle) ? initialStyle : 'low-poly';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
scene.add(ground);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

/** Points the camera at the whole tree (Species differ a lot in size) and sizes the ground to it. */
function frame(object: THREE.Object3D): void {
  const box = framingBox(object); // underground Roots don't shift the view
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const distance = (Math.max(size.y, size.x, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.3;
  camera.position.copy(centre).addScaledVector(new THREE.Vector3(1, 0.35, 1).normalize(), distance);
  camera.lookAt(centre);
  ground.scale.setScalar(Math.max(size.x, size.z, size.y * 0.6));
}

let tree: Tree | undefined;
let request = 0;

/** Grows the picked Species in the picked Style, replacing the previous tree. */
async function show(): Promise<void> {
  const current = ++request;
  window.speciesExample = { status: 'loading' };
  const id = speciesSelect.value as SpeciesName;
  const styleName = styleSelect.value as StyleName;
  const query = new URLSearchParams({ species: id, style: styleName });
  for (const key of ['seed', 'season']) if (params.has(key)) query.set(key, params.get(key)!);
  history.replaceState(null, '', `?${query}`);
  const style = await loadStyle(styleName); // each Style is its own chunk
  const next = createTree(style.apply(SPECIES.get(id)!), { seed, season });
  await next.ready; // the realistic Style's textures
  if (current !== request) return next.dispose(); // a newer pick won
  tree?.dispose();
  tree = next;
  scene.add(tree);
  frame(tree);
  await renderer.renderAsync(scene, camera);
  if (current !== request) return;
  statusEl.textContent = `${SPECIES.get(id)!.name} - ${styleName} - seed ${seed}`;
  const trees = scene.children.filter((child) => 'definition' in child).length;
  window.speciesExample = { status: 'rendered', species: id, style: styleName, shading: tree.definition.materials.shading, trees };
}

function run(): void {
  show().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = message;
    window.speciesExample = { status: 'error', error: message };
    console.error(error);
  });
}

speciesSelect.addEventListener('change', run);
styleSelect.addEventListener('change', run);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  void renderer.renderAsync(scene, camera);
});

await renderer.init();
run();
