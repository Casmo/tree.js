// Minimal vanilla three.js example: one tree (trunk, branch levels, leaves) on WebGPURenderer.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?renderer=classic  use the unsupported classic WebGLRenderer (shows the error)
//   ?seed=<n>  pick a Seed (default 1)
//   ?growth=<0..1>  Growth (default 1, fully grown); only a uniform changes
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?form=conifer  an evergreen conifer instead of the deciduous broadleaf
//   ?fruit=round|pear|nut|cone|berry  add Fruit of that Fruit Type (sets in late spring, ripens green -> red, drops in autumn)
//   ?style=low-poly|stylized|realistic  grow that built-in Style's Definition for the form (loaded with a dynamic import)
//   ?species=<id>  grow that Species (loadSpecies, e.g. oak) in the ?style (default low-poly)
//   ?leafType=<Leaf Type>&barkType=<Bark Type>  re-apply the Style with this Leaf / Bark Type (e.g. palmate, papery)
//   ?textureBase=<url>  load relative texture URLs (the realistic Style's) from this base path / CDN
//   ?barkMap=<url>&leafMap=<url>  use these textures instead of the Definition's (custom textures)
//   ?wind=<strength>  scene-wide Wind strength (default 0 = calm); animates unless windTime is given
//   ?windTime=<s>  pin the Wind clock (deterministic screenshots)
//   ?shadows=1  enable shadow mapping (sun casts, ground receives)
//   ?backlight=1  put the sun low behind the tree, facing the camera (to see Leaf Translucency)
//   Material Features (off by default; applied with withMaterialFeatures):
//   ?features=suggested  the ?style's SUGGESTED_MATERIAL_FEATURES (low-poly without a ?style)
//   ?crownNormals=<0..1>  Crown Normals at that amount (overrides the suggestion)
//   ?translucency=<strength>,<edge>,<ambient>  Leaf Translucency (overrides the suggestion)
//   ?occlusion=<0..1>  Structural Occlusion at that strength (overrides the suggestion)
//   ?baked=1  show the tree as a Baked Tree: exportBakedTree, loaded back with three's GLTFLoader
//   ?occlusionInVertexColors=1  with ?baked=1: multiply Structural Occlusion into the vertex colours
//   ?hook=leaves|bark|fruit[,...]  a Tree Shader Hook on those parts that tints them magenta
import * as THREE from 'three/webgpu';
import { MeshStandardMaterial, WebGLRenderer } from 'three';
import { mix, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createTree,
  exportBakedTree,
  type BarkType,
  type LeafType,
  extendDefinition,
  sceneWind,
  SEASON_PROFILES,
  setTextureOptions,
  SUGGESTED_MATERIAL_FEATURES,
  withMaterialFeatures,
  type FruitType,
  type MaterialFeatures,
  type StyleName,
  type TreeDefinition,
  type TreeDefinitionInput,
  type TreeShaderHook,
  type TreeShaderHooks,
  type TreeStyle,
} from '@casmo/tree.js';
import { loadSpecies, type SpeciesName } from '@casmo/tree.js/species';
import { framingBox } from '../framing';

// Built-in Styles are separate chunks, fetched only when asked for.
const styles: Record<string, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('@casmo/tree.js/styles/low-poly'),
  stylized: () => import('@casmo/tree.js/styles/stylized'),
  realistic: () => import('@casmo/tree.js/styles/realistic'),
};

declare global {
  interface Window {
    treeExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** id of the leaf BufferGeometry, to check that Season does not regenerate. */
      leafGeometryId?: number;
      /** Vertex count of the tree's fruit mesh (0 without Fruit). */
      fruitVertices?: number;
      /** Sets `tree.season` and re-renders (status goes 'loading' -> 'rendered'). */
      setSeason?: (season: number) => void;
      /** Sets the magenta Tree Shader Hook on these parts only (none: removes them) and re-renders. */
      setShaderHooks?: (parts: string[]) => void;
      /** Shows or hides one part's mesh ('wood', 'leaves', 'fruit') and re-renders. */
      setVisible?: (mesh: string, visible: boolean) => void;
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
const backlight = params.get('backlight') === '1';
sceneWind.set({ direction: [1, 0, -0.4], strength: windStrength });
if (windTime !== null) sceneWind.time = Number(windTime);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(8.5, 4.5, 8.5);
camera.lookAt(0, 3, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(...((backlight ? [-6, 3.5, -6] : [5, 8, 3]) as [number, number, number]));
scene.add(sun);
if (shadows) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, backlight ? { left: -9, right: 9, top: 12, bottom: -4 } : { left: -7, right: 7, top: 9, bottom: -3 });
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
  schemaVersion: 3,
  trunk: { length: 6, radius: 0.18, taper: 0.9 },
  branches: [
    {
      count: 22, start: 0.15, end: 0.95, angle: 80, length: 0.28, gravity: -0.3,
      // Crown Shape: a cone (full length at the lowest branches, a tenth at the top).
      lengthProfile: [{ t: 0.15, value: 1 }, { t: 0.915, value: 0.1 }, { t: 1, value: 0.1 }],
    },
    { count: 3, start: 0.2, angle: 45, length: 0.4, sides: 3, sections: 2 },
  ],
  leaves: { count: 8, size: 0.3 },
  season: SEASON_PROFILES.evergreen,
};
/** `?fruit=<type>`: Fruit on the outermost twigs, with Season tracks for setting, ripening and dropping. */
function withFruit(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const type = params.get('fruit') as FruitType | null;
  if (!type) return definition;
  return extendDefinition(definition, {
    fruit: { type, count: 2, size: 0.22, hang: type === 'cone' ? 0.2 : 0.8 },
    season: {
      fruit: [{ t: 0.12, value: 0 }, { t: 0.32, value: 1 }, { t: 0.62, value: 1 }, { t: 0.7, value: 0 }],
      fruitColor: [{ t: 0.25, value: '#7cb342' }, { t: 0.5, value: '#c62828' }],
    },
  });
}

const form = params.get('form') === 'conifer' ? 'conifer' : 'broadleaf';

async function loadDefinition(): Promise<TreeDefinitionInput | TreeDefinition> {
  const speciesName = params.get('species');
  const styleName = params.get('style') ?? (speciesName ? 'low-poly' : null);
  if (!styleName) return form === 'conifer' ? conifer : broadleaf;
  const load = styles[styleName];
  if (!load) throw new Error(`Unknown style "${styleName}"`);
  const style = (await load()).default;
  if (speciesName) return style.apply(await loadSpecies(speciesName as SpeciesName));
  const leafType = params.get('leafType') as LeafType | null;
  const barkType = params.get('barkType') as BarkType | null;
  if (!leafType && !barkType) return style[form];
  // The Style draws the Leaf / Bark Type its own way (for realistic: their textures).
  return style.apply(
    extendDefinition(style[form], {
      ...(leafType ? { leaves: { type: leafType } } : {}),
      ...(barkType ? { materials: { bark: { type: barkType } } } : {}),
    }),
  );
}

/** Points the camera at the whole tree (Style trees differ in size). */
function frame(object: THREE.Object3D): void {
  const box = framingBox(object); // underground Roots don't shift the view
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const distance = (Math.max(size.y, size.x, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
  const direction = new THREE.Vector3(1, 0.35, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.lookAt(centre);
}

/** `?barkMap=` / `?leafMap=`: custom textures on top of the chosen Definition. */
function withCustomTextures(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const barkMap = params.get('barkMap');
  const leafMap = params.get('leafMap');
  if (!barkMap && !leafMap) return definition;
  return extendDefinition(definition, {
    materials: {
      ...(barkMap ? { bark: { color: '#ffffff', map: barkMap, normalMap: null } } : {}),
      ...(leafMap ? { leaf: { map: leafMap } } : {}),
    },
  });
}

/**
 * Material Features from the query: the Style's suggestion (`?features=suggested`), with any single
 * feature given in the query on top. Without any of these the Definition is left as it is (all off).
 */
function withFeatures(definition: TreeDefinitionInput | TreeDefinition): TreeDefinitionInput | TreeDefinition {
  const style = (params.get('style') ?? 'low-poly') as StyleName;
  const features: MaterialFeatures = params.get('features') === 'suggested' ? { ...SUGGESTED_MATERIAL_FEATURES[style] } : {};
  const crownNormals = params.get('crownNormals');
  if (crownNormals !== null) features.crownNormals = Number(crownNormals);
  const translucency = params.get('translucency');
  if (translucency) {
    const [strength, edge, ambient] = translucency.split(',').map(Number);
    features.translucency = { strength: strength!, edge: edge!, ambient: ambient! };
  }
  const occlusion = params.get('occlusion');
  if (occlusion !== null) features.occlusion = { strength: Number(occlusion) };
  return Object.keys(features).length === 0 ? definition : withMaterialFeatures(definition, features);
}

/** `?baked=1`: the tree as another engine gets it, a Baked Tree `.glb` loaded back with three's GLTFLoader. */
async function baked(tree: ReturnType<typeof createTree>): Promise<THREE.Object3D> {
  const glb = await exportBakedTree(tree, { occlusionInVertexColors: params.get('occlusionInVertexColors') === '1' });
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  gltf.scene.traverse((object) => (object.castShadow = object.receiveShadow = true));
  return gltf.scene;
}

/** `?hook=`: a Tree Shader Hook that tints a part magenta (the colour only; lighting stays). */
const magenta: TreeShaderHook = ({ color }) => mix(color, vec3(1, 0, 1), 0.8);
const hooksFor = (parts: string[]): TreeShaderHooks => Object.fromEntries(parts.map((part) => [part, magenta]));

async function main(): Promise<void> {
  const textureBase = params.get('textureBase');
  if (textureBase) setTextureOptions({ basePath: textureBase });
  const tree = createTree(withFeatures(withFruit(withCustomTextures(await loadDefinition()))), {
    seed,
    growth,
    season,
    shaderHooks: hooksFor(params.get('hook')?.split(',') ?? []),
  });
  await tree.ready; // textures (realistic Style, custom maps) are loaded before the first frame
  const shown = params.get('baked') === '1' ? await baked(tree) : tree;
  scene.add(shown);
  if (params.get('style') || params.get('species')) frame(shown);

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
  const rerender = (change: () => void): void => {
    window.treeExample.status = 'loading';
    change();
    void renderer.renderAsync(scene, camera).then(() => (window.treeExample.status = 'rendered'));
  };
  const setShaderHooks = (parts: string[]): void => rerender(() => (tree.shaderHooks = hooksFor(parts)));
  const setVisible = (mesh: string, visible: boolean): void =>
    rerender(() => {
      const object = tree.getObjectByName(mesh);
      if (object) object.visible = visible;
    });
  const fruitVertices = tree.fruit.geometry.getAttribute('position').count;
  window.treeExample = { status: 'rendered', backend, leafGeometryId, fruitVertices, setSeason, setShaderHooks, setVisible };
  // A swaying tree needs a render loop; with a pinned Wind clock one frame is enough.
  if (windStrength > 0 && windTime === null) renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.treeExample = { status: 'error', error: message };
  console.error(error);
});
