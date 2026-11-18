// Scenes for the README's screenshots and GIFs, captured by scripts/readme-media/capture.mjs.
// Query parameters:
//   ?shot=<name>  which scene (see SHOTS below)
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?effects=0|1  the 'effects' shot without / with the Style's suggested Tree Effects
// The page exposes window.readmeShot: once status is 'ready', `frames` is the number of frames and
// `show(i)` sets up and draws frame i (a still has one frame).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createForest,
  createRandom,
  createTree,
  exportBakedTree,
  sceneWind,
  SEASON_PROFILES,
  type ForestPlacement,
  type Tree,
  type TreeDefinitionInput,
} from '@casmo/tree.js';
import { createTreeEffects, SUGGESTED_TREE_EFFECTS } from '@casmo/tree.js/effects';
import lowPoly from '@casmo/tree.js/styles/low-poly';
import stylized from '@casmo/tree.js/styles/stylized';
import realistic from '@casmo/tree.js/styles/realistic';

declare global {
  interface Window {
    readmeShot: { status: 'loading' | 'ready' | 'error'; frames?: number; error?: string; show?: (frame: number) => Promise<void> };
  }
}

window.readmeShot = { status: 'loading' };
const params = new URLSearchParams(location.search);

interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer;
}

interface Shot {
  frames: number;
  /** Updates the scene for frame i (before it is drawn). */
  update?: (frame: number) => void;
  /** Draws a frame; defaults to renderer.renderAsync(scene, camera). */
  render?: () => Promise<void> | void;
}

const DEFAULT_DIRECTION = new THREE.Vector3(1, 0.35, 1).normalize();

/** Points the camera at the box so that all of it is in view. */
function frame(camera: THREE.PerspectiveCamera, box: THREE.Box3, margin = 1.15, direction = DEFAULT_DIRECTION): void {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const vertical = size.y / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const horizontal = Math.max(size.x, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect;
  camera.position.copy(centre).addScaledVector(direction, Math.max(vertical, horizontal) * margin);
  camera.lookAt(centre);
}

/** Puts trees side by side (along x), each scaled to the same height when `height` is given. */
function lineUp(trees: THREE.Object3D[], gap: number, height?: number): THREE.Box3 {
  let x = 0;
  const all = new THREE.Box3();
  for (const tree of trees) {
    if (height) {
      const h = new THREE.Box3().setFromObject(tree).getSize(new THREE.Vector3()).y;
      tree.scale.setScalar(height / h);
    }
    tree.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tree);
    tree.position.x += x - box.min.x;
    x += box.max.x - box.min.x + gap;
    tree.updateMatrixWorld(true);
    all.union(new THREE.Box3().setFromObject(tree));
  }
  const shift = -(all.min.x + all.max.x) / 2;
  for (const tree of trees) tree.position.x += shift;
  all.translate(new THREE.Vector3(shift, 0, 0));
  return all;
}

function ground(stage: Stage, radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  mesh.receiveShadow = true;
  stage.scene.add(mesh);
  return mesh;
}

/** The README's broadleaf: the defaults plus a third branching level and the deciduous Season Profile. */
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

/** A jittered grid of placements. */
function grid(count: number, spacing: number, seed: number): ForestPlacement[] {
  const side = Math.ceil(Math.sqrt(count));
  const random = createRandom(seed);
  const out: ForestPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const x = ((i % side) - (side - 1) / 2) * spacing + random.range(-1, 1) * spacing * 0.3;
    const z = (Math.floor(i / side) - (side - 1) / 2) * spacing + random.range(-1, 1) * spacing * 0.3;
    out.push({ id: i, position: [x, 0, z], rotation: random.range(0, Math.PI * 2), scale: random.range(0.8, 1.2) });
  }
  return out;
}

const SHOTS: Record<string, (stage: Stage) => Promise<Shot>> = {
  /** Top of the README: a mixed stylized forest going through a year. */
  async hero({ scene, camera }) {
    const placements = grid(260, 4.2, 7);
    const forests = [
      createForest(stylized.broadleaf, placements.filter((_, i) => i % 3 !== 0), { variants: 4, seed: 1, season: 0 }),
      createForest(stylized.conifer, placements.filter((_, i) => i % 3 === 0), { variants: 3, seed: 2, season: 0 }),
    ];
    scene.add(...forests);
    scene.fog = new THREE.Fog('#cfe3f0', 40, 95);
    ground({ scene } as Stage, 120);
    camera.position.set(-14, 11, 34);
    camera.lookAt(0, 2, 0);
    const frames = 48;
    return {
      frames,
      update(i) {
        for (const forest of forests) forest.season = 0.05 + i / frames;
      },
    };
  },

  /** Quick start: exactly the tree of the code sample. */
  async 'quick-start'({ scene, camera }) {
    const tree = createTree(lowPoly.broadleaf, { seed: 42, growth: 1, season: 0.4 });
    scene.add(tree);
    ground({ scene } as Stage, 8);
    frame(camera, new THREE.Box3().setFromObject(tree), 1.3);
    return { frames: 1 };
  },

  /** WebGPURenderer: the same scene on WebGPU and on the WebGL2 fallback (captured twice). */
  async renderer({ scene, camera }) {
    const trees = [createTree(lowPoly.broadleaf, { seed: 3, season: 0.37 }), createTree(lowPoly.conifer, { seed: 8, season: 0.37 })];
    scene.add(...trees);
    ground({ scene } as Stage, 12);
    frame(camera, lineUp(trees, 0.6), 1.25);
    return { frames: 1 };
  },

  /** Styles: low-poly, stylized and realistic, broadleaf and conifer each. */
  async styles({ scene, camera }) {
    const trees = [
      createTree(lowPoly.broadleaf, { seed: 1, season: 0.37 }),
      createTree(lowPoly.conifer, { seed: 1, season: 0.37 }),
      createTree(stylized.broadleaf, { seed: 1, season: 0.37 }),
      createTree(stylized.conifer, { seed: 1, season: 0.37 }),
      createTree(realistic.broadleaf, { seed: 1, season: 0.37 }),
      createTree(realistic.conifer, { seed: 1, season: 0.37 }),
    ];
    await Promise.all(trees.map((tree) => tree.ready));
    scene.add(...trees);
    ground({ scene } as Stage, 40);
    frame(camera, lineUp(trees, 0.8, 6), 1.05, new THREE.Vector3(0, 0.2, 1).normalize());
    return { frames: 1 };
  },

  /** Tree Definitions and Seeds: the README's birch, five Seeds. */
  async seeds({ scene, camera }) {
    const birch: TreeDefinitionInput = {
      schemaVersion: 3,
      trunk: { length: 6, radius: 0.15 },
      branches: [
        { count: 6, angle: 45 },
        { count: 4, length: 0.5 },
      ],
      leaves: { count: 6, shape: 'card', size: 0.3 },
      materials: { bark: { color: '#d8d2c4' } },
    };
    const trees = [1, 2, 3, 4, 5].map((seed) => createTree(birch, { seed }));
    scene.add(...trees);
    ground({ scene } as Stage, 40);
    frame(camera, lineUp(trees, 0.2), 1.05, new THREE.Vector3(0, 0.2, 1).normalize());
    return { frames: 1 };
  },

  /** Growth and Season: a tree grows up, then goes through a year. */
  async 'growth-season'({ scene, camera }) {
    const tree = createTree(stylized.broadleaf, { seed: 5, growth: 1, season: 0.37 });
    scene.add(tree);
    ground({ scene } as Stage, 10);
    frame(camera, new THREE.Box3().setFromObject(tree), 1.25);
    const grow = 36;
    const year = 60;
    return {
      frames: grow + year,
      update(i) {
        if (i < grow) {
          tree.growth = i / (grow - 1);
          tree.season = 0.3;
        } else {
          tree.growth = 1;
          tree.season = 0.3 + (i - grow) / year;
        }
      },
    };
  },

  /** Wind: trees swaying in a fairly strong wind. */
  async wind({ scene, camera }) {
    sceneWind.set({ direction: [1, 0, -0.4], strength: 1 });
    const trees = [
      createTree(lowPoly.broadleaf, { seed: 2, season: 0.37 }),
      createTree(stylized.conifer, { seed: 4, season: 0.37 }),
      createTree(stylized.broadleaf, { seed: 6, season: 0.37 }),
    ];
    scene.add(...trees);
    ground({ scene } as Stage, 20);
    frame(camera, lineUp(trees, 0.8, 6), 1.15, new THREE.Vector3(0, 0.25, 1).normalize());
    const fps = 15;
    return { frames: 60, update: (i) => (sceneWind.time = 2 + i / fps) };
  },

  /** Forests: 400 instanced trees with per-tree Season (autumn towards the right) and Growth. */
  async forest({ scene, camera }) {
    const placements = grid(400, 3.2, 99);
    const forest = createForest(broadleaf, placements, { variants: 4, seed: 1, growth: 1, season: 0.37 });
    const half = (20 * 3.2) / 2;
    for (const tree of forest.trees) {
      const [x, , z] = tree.placement.position as [number, number, number];
      tree.growth = 1 - Math.min(Math.max((half - z) / (2 * half), 0), 1) * 0.15;
      tree.season = 0.37 + Math.min(Math.max((x + half) / (2 * half), 0), 1) * 0.3;
    }
    scene.add(forest);
    scene.fog = new THREE.Fog('#cfe3f0', 60, 130);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
    scene.add(plane);
    camera.far = 300;
    camera.position.set(0, 14, 44);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return { frames: 1 };
  },

  /** Tree Effects: one stylized tree next to non-tree objects (captured with and without effects). */
  async effects({ scene, camera, renderer }) {
    const tree = createTree(stylized.broadleaf, { seed: 1, season: 0.37 });
    scene.add(tree);
    ground({ scene } as Stage, 30);
    const box = new THREE.Box3().setFromObject(tree);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    frame(camera, box, 1.6);
    const s = size.y / 6;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5), new THREE.MeshStandardNodeMaterial({ color: '#c0503a' }));
    crate.position.set(centre.x + size.x * 0.75, s * 0.75, centre.z - size.z * 0.1);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), new THREE.MeshStandardNodeMaterial({ color: '#8a8f99', flatShading: true }));
    rock.position.set(centre.x - size.x * 0.7, s * 0.5, centre.z + size.z * 0.7);
    scene.add(crate, rock);
    const effects = createTreeEffects(renderer, scene, camera, { effects: params.get('effects') === '0' ? {} : SUGGESTED_TREE_EFFECTS.stylized });
    return {
      frames: 1,
      async render() {
        // The effect passes build their pipelines on first use: draw a few frames.
        for (let i = 0; i < 4; i++) {
          effects.render();
          await new Promise(requestAnimationFrame);
        }
      },
    };
  },

  /** Baked Trees: a .glb exported by exportBakedTree, loaded back with GLTFLoader, on a turntable. */
  async baked({ scene, camera }) {
    const source = createTree(lowPoly.broadleaf, { seed: 4 });
    const glb = await exportBakedTree(source, { growth: 1, season: 0.6 });
    source.dispose();
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const turntable = new THREE.Group();
    turntable.add(gltf.scene);
    scene.add(turntable);
    ground({ scene } as Stage, 8);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    frame(camera, new THREE.Box3().setFromCenterAndSize(box.getCenter(new THREE.Vector3()), new THREE.Vector3(size, box.max.y - box.min.y, size * 0.5)), 1.1);
    const frames = 60;
    return { frames, update: (i) => (turntable.rotation.y = (i / frames) * Math.PI * 2) };
  },

  /** Textures: the realistic Style up close (bark with normal map, leaf cards and needles). */
  async textures({ scene, camera }) {
    const trees: Tree[] = [createTree(realistic.broadleaf, { seed: 2, season: 0.37 }), createTree(realistic.conifer, { seed: 3, season: 0.37 })];
    await Promise.all(trees.map((tree) => tree.ready));
    scene.add(...trees);
    ground({ scene } as Stage, 20);
    const box = lineUp(trees, 0.3, 6);
    const centre = box.getCenter(new THREE.Vector3());
    camera.position.set(centre.x + 1.5, 2.6, box.max.z + 5);
    camera.lookAt(centre.x, 2.9, 0);
    return { frames: 1 };
  },
};

async function main(): Promise<void> {
  const name = params.get('shot') ?? 'hero';
  const setup = SHOTS[name];
  if (!setup) throw new Error(`Unknown shot "${name}"`);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f0');
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.position.set(5, 8, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  sceneWind.set({ strength: 0 });
  sceneWind.time = 0;

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const stage = { scene, camera, renderer };
  const shot = await setup(stage);
  const render = shot.render ?? (() => renderer.renderAsync(scene, camera));
  window.readmeShot = {
    status: 'ready',
    frames: shot.frames,
    async show(i) {
      shot.update?.(i);
      await render();
      await new Promise(requestAnimationFrame);
    },
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.readmeShot = { status: 'error', error: message };
  console.error(error);
});
