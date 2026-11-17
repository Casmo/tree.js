# tree.js

Procedural trees for [three.js](https://threejs.org): one Tree Definition and a Seed grow a unique tree, in a
low-poly, stylized or realistic Style. Trees grow (Growth), change through the year (Season) and sway in the
Wind, all on the GPU through TSL node materials, so animating them never regenerates geometry. Place
thousands at once as an instanced Forest, add opt-in Tree Effects, or design your own trees in the
[Tree Editor](#tree-editor).

- [Install](#install)
- [Quick start](#quick-start)
- [WebGPURenderer is required](#webgpurenderer-is-required)
- [Styles](#styles)
- [Tree Definitions and Seeds](#tree-definitions-and-seeds)
- [Growth and Season](#growth-and-season)
- [Wind](#wind)
- [Forests](#forests)
- [Tree Effects](#tree-effects)
- [React Three Fiber](#react-three-fiber)
- [Without a bundler: import map (CDN)](#without-a-bundler-import-map-cdn)
- [Baked Trees (glTF export)](#baked-trees-gltf-export)
- [Textures](#textures)
- [Tree Editor](#tree-editor)
- [Examples](#examples)

## Install

```sh
npm install @casmo/tree.js three
```

`three` (r187 or newer) is a peer dependency. For the React bindings also install `react` (19) and
`@react-three/fiber` (v9); vanilla three.js apps don't need them.

| Import | What |
| --- | --- |
| `@casmo/tree.js` | `createTree`, `createForest`, Definitions, Wind, Baked Tree export, `loadStyle`, ... |
| `@casmo/tree.js/styles/low-poly` (`stylized`, `realistic`) | a built-in Style: one Tree Definition per Form (a few kB of data) |
| `@casmo/tree.js/effects` | Tree Effects (post-processing) |
| `@casmo/tree.js/react` | `<Tree>`, `<Forest>`, `<Wind>`, `useTreeStyle` for React Three Fiber |

## Quick start

```ts
import * as THREE from 'three/webgpu';
import { createTree } from '@casmo/tree.js';
import lowPoly from '@casmo/tree.js/styles/low-poly';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(9, 4, 9);
camera.lookAt(0, 2.5, 0);

const tree = createTree(lowPoly.broadleaf, { seed: 42, growth: 1, season: 0.4 });
scene.add(tree);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

A `Tree` is a three.js `Group` with two meshes, `tree.wood` and `tree.leaves` (both cast and receive
shadows). `tree.dispose()` frees its geometries and materials and removes it from the scene.

## WebGPURenderer is required

Tree materials are TSL node materials, so trees must be drawn by `WebGPURenderer` from `three/webgpu`
(not the classic `WebGLRenderer`). WebGPURenderer uses WebGPU where the browser has it and falls back to
WebGL2 by itself, so you keep WebGL2 support; pass `forceWebGL: true` to try the fallback. Call
`await renderer.init()` before the first render. Drawing a tree with any other renderer throws an
`UnsupportedRendererError` that says so:

```ts
import { assertWebGPURenderer, UnsupportedRendererError } from '@casmo/tree.js';

try {
  assertWebGPURenderer(renderer); // what every tree mesh checks before it is drawn
} catch (error) {
  if (error instanceof UnsupportedRendererError) console.error(error.message);
}
```

The rest of your scene can keep any materials; only the trees need the node renderer.

## Styles

A Style is a ready-made look with one Tree Definition per Form (`broadleaf`, `conifer`):

| Style | Look |
| --- | --- |
| `low-poly` | faceted (flat shading), solid colours, clump and needle leaves |
| `stylized` | soft two-tone (toon) shading, round leaf puffs, pink blossom in early spring |
| `realistic` | textured bark (with normal map) and leaf cards |

Each Style is its own small module, so you only download the ones you use. Import one statically, or load
it on demand by name:

```ts
import { createTree, extendDefinition, loadStyle } from '@casmo/tree.js';
import stylized from '@casmo/tree.js/styles/stylized';

const oak = createTree(stylized.broadleaf, { seed: 1 });
const pine = createTree(stylized.conifer, { seed: 2 });

const realistic = await loadStyle('realistic'); // dynamic import of '@casmo/tree.js/styles/realistic'
const birch = createTree(realistic.broadleaf, { seed: 3 });
await birch.ready; // resolves once its textures have loaded (instantly for trees without textures)

// A Style's Definitions are plain data: start from one and change what you like.
const tallPine = createTree(extendDefinition(stylized.conifer, { trunk: { length: 9 } }), { seed: 2 });
scene.add(oak, pine, birch, tallPine);
```

## Tree Definitions and Seeds

A Tree Definition is plain JSON (what the Tree Editor exports): trunk, branch levels, leaves, materials,
the Season Profile, the Wind response, Seed variation ranges and Sculpts. Every field is documented in
[`src/definition/types.ts`](src/definition/types.ts); missing fields get defaults, so a Definition can be
small. The Seed picks one individual tree within the Definition's ranges: the same Definition and Seed
always give exactly the same tree.

```ts
import { createTree, fetchDefinition, parseDefinition, TreeDefinitionError, type TreeDefinitionInput } from '@casmo/tree.js';

const birch: TreeDefinitionInput = {
  schemaVersion: 2,
  form: 'broadleaf',
  trunk: { length: 6, radius: 0.15 },
  branches: [
    { count: 6, angle: 45 },
    { count: 4, length: 0.5 },
  ],
  leaves: { count: 6, shape: 'card', size: 0.3 },
  materials: { bark: { color: '#d8d2c4' } },
};
const trees = [1, 2, 3].map((seed) => createTree(birch, { seed })); // three different birches

const fromEditor = await fetchDefinition('/trees/my-oak.json'); // a Tree Editor export
const tree = createTree(fromEditor, { seed: 7 });

try {
  parseDefinition('{"schemaVersion": 2, "trunk": {"length": -1}}');
} catch (error) {
  if (error instanceof TreeDefinitionError) console.warn(error.field, error.message); // 'trunk.length'
}
```

Older Definitions (lower `schemaVersion`) are migrated when parsed. `extendDefinition(base, patch)`
deep-merges a patch (arrays replace) and validates the result. Sculpts (hand edits made in the Tree Editor)
belong to one Seed: they only change the tree of that Seed.

## Growth and Season

**Growth** goes from 0 (sapling) to 1 (fully grown); branches sprout after their parent and leaves come
last. **Season** goes from 0 (first day of spring) to 1 (last day of winter) and sets leaf colour, leaf
coverage and blossom from the Definition's Season Profile (values outside 0..1 wrap around the year).
Both only write a uniform, so they are cheap to animate every frame:

```ts
import { createTree, SEASON_PROFILES } from '@casmo/tree.js';

const tree = createTree({ schemaVersion: 2, season: SEASON_PROFILES.deciduous }, { seed: 5, growth: 0, season: 0 });
scene.add(tree);

renderer.setAnimationLoop((time) => {
  tree.growth = Math.min(1, time / 10_000); // grows in 10 s
  tree.season = time / 60_000; // a year per minute
  renderer.render(scene, camera);
});
```

Each tree's Seed shifts its timing a little (`variation.growth`, `variation.season`), so trees of one
Definition don't change in lockstep. `SEASON_PROFILES.deciduous` and `.evergreen` are ready-made Season
Profiles; write your own as keyframes in the Definition's `season` (`leafColor`, `leafCoverage`,
`blossom`, `blossomColor`).

## Wind

Wind has a scene-wide part (direction and strength) and a per-tree part (the Definition's `wind`
response: how much the trunk, branches and leaves move). Every tree sways with the shared `sceneWind`
unless you give it another `Wind`. All of it is uniforms, so changing the wind is free:

```ts
import { createTree, sceneWind, Wind } from '@casmo/tree.js';

sceneWind.set({ direction: [1, 0, -0.4], strength: 0.6 }); // 0 = calm (default), 1 = strong
const swaying = createTree({ schemaVersion: 2, wind: { trunk: 0.4, branches: 0.8, leaves: 1 } }, { seed: 1 });

// A separate wind, e.g. for a sheltered courtyard:
const breeze = new Wind({ direction: [0, 0, 1], strength: 0.2 });
const sheltered = createTree({ schemaVersion: 2 }, { seed: 2, wind: breeze });

swaying.windResponse.set({ leaves: 0.5 }); // change one tree's response live
sceneWind.time = 1.5; // pin the wind clock (seconds), e.g. for screenshots; null = the renderer's clock
scene.add(swaying, sheltered);
```

A swaying tree needs a render loop (`renderer.setAnimationLoop`).

## Forests

A Forest draws many trees of one Definition from a few Variants (Seeds), each instanced, so 1,000 trees
cost two draw calls per Variant. Every tree still looks its own: its Variant, rotation, Growth delay,
Season shift and wind phase come from a hash of the forest seed and the tree's id (or position), so adding
or removing trees never changes the others.

```ts
import { Raycaster } from 'three/webgpu';
import { createForest, type ForestPlacement } from '@casmo/tree.js';
import lowPoly from '@casmo/tree.js/styles/low-poly';

const placements: ForestPlacement[] = [];
for (let i = 0; i < 400; i++) {
  placements.push({ id: i, position: [(i % 20) * 4, 0, Math.floor(i / 20) * 4], rotation: i * 2.4, scale: 0.8 + (i % 5) * 0.1 });
}
const forest = createForest(lowPoly.conifer, placements, { variants: 4, seed: 1, growth: 1, season: 0.3 });
scene.add(forest);

forest.season = 0.65; // every tree, each with its own shift
forest.addTree({ id: 'new', position: [-4, 0, 0] });
forest.removeTree(17); // by id, key or ForestTree
const tree = forest.get('new');
if (tree) tree.growth = 0.3; // per-tree Growth and Season

// Which tree did the user click?
const raycaster = new Raycaster(); // set from the pointer: raycaster.setFromCamera(pointer, camera)
const [hit] = raycaster.intersectObject(forest);
if (hit) console.log(forest.treeAt(hit)?.key);
```

`forest.dispose()` frees everything. `forest.ready` resolves once its textures have loaded.

## Tree Effects

`@casmo/tree.js/effects` has opt-in post-processing (TSL nodes for three.js `RenderPipeline`) that only
changes the pixels of trees: an **outline**, a **leaf glow** and **colour grading**. Trees look fine
without them. Every tree.js material (Trees and Forests) is found automatically (a per-object tree mask in
an MRT output), so no tree has to be registered.

```ts
import { createTreeEffects } from '@casmo/tree.js/effects';

const effects = createTreeEffects(renderer, scene, camera, { effects: 'stylized' }); // the Style's suggested combination
renderer.setAnimationLoop(() => effects.render()); // instead of renderer.render(scene, camera)
effects.set({ outline: { color: '#203018', thickness: 2 }, grade: { saturation: 1.1 } }); // or null = none
```

Pass `selection: [tree]` to outline only some trees. In your own pipeline, the effects are nodes that
compose with your other effects:

```ts
import * as THREE from 'three/webgpu';
import { float, screenUV, vec4 } from 'three/tsl';
import { applyTreeEffects, TREE_EFFECT_PRESETS, treeEffectsPass } from '@casmo/tree.js/effects';

const pipeline = new THREE.RenderPipeline(renderer);
const input = treeEffectsPass(scene, camera); // { pass, color, mask }
const trees = applyTreeEffects(input, TREE_EFFECT_PRESETS['low-poly']); // or treeOutline / leafGlow / treeColorGrade
const vignette = float(1).sub(screenUV.sub(0.5).length().mul(0.9).pow(2)); // your own effect on top
pipeline.outputNode = vec4(trees.rgb.mul(vignette), 1);
renderer.setAnimationLoop(() => pipeline.render());
```

To add the tree mask to a scene pass you already have, merge `treeMaskMRT()` into its MRT and read the
mask with `scenePass.getTextureNode(TREE_MASK)`.

## React Three Fiber

`@casmo/tree.js/react` has `<Tree>`, `<Forest>`, `<Wind>` and `useTreeStyle`. Trees use TSL node
materials, so give `<Canvas>` a `WebGPURenderer` (it falls back to WebGL2 by itself). R3F v9 takes an
async `gl` factory, which must `await renderer.init()` before it returns:

```tsx
import * as THREE from 'three/webgpu';
import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Forest, Tree, Wind, useTreeStyle } from '@casmo/tree.js/react';

function Trees() {
  const lowPoly = useTreeStyle('low-poly'); // dynamic import; suspends while it loads
  return (
    <>
      <Tree style={lowPoly} form="broadleaf" seed={1} growth={0.8} season={0.4} />
      <Tree style="low-poly" form="conifer" seed={2} position={[3, 0, 0]} castShadow={false} />
      <Tree definition={{ schemaVersion: 2, leaves: { count: 4 } }} seed={7} position={[-3, 0, 0]} />
      <Forest
        style={lowPoly}
        form="conifer"
        placements={[
          { id: 'a', position: [0, 0, -8] },
          { id: 'b', position: [4, 0, -9], growth: 0.5 },
        ]}
      />
    </>
  );
}

function App() {
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [9, 4, 9] }}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as THREE.WebGPURendererParameters);
        await renderer.init();
        return renderer;
      }}
    >
      <hemisphereLight args={['#ffffff', '#6a7a4a', 1.5]} />
      <directionalLight position={[5, 8, 3]} intensity={2.5} castShadow />
      <Wind direction={[1, 0, 0]} strength={0.5} />
      <Suspense fallback={null}>
        <Trees />
      </Suspense>
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

- `growth`, `season`, `castShadow`/`receiveShadow` and `<Wind>` props only update uniforms or flags on the same tree.
- A new `seed`, `definition` (compared by value), `style`/`form` or `wind` regenerates the tree. Trees are disposed of on unmount.
- `style` also takes a Style name (`<Tree style="low-poly" />`), which suspends like `useTreeStyle`. The `ref` is the tree.js `Tree` (or `Forest`) object.
- `<Forest>` diffs its `placements` by id: changing the array plants and cuts trees without touching the others; per-tree `growth`/`season` override the forest's.
- Use `shadows="percentage"` (plain `shadows` asks for a shadow type WebGPURenderer no longer has).

## Without a bundler: import map (CDN)

The package is plain ES modules, so it runs straight from a CDN with an
[import map](https://developer.mozilla.org/docs/Web/HTML/Element/script/type/importmap). Map `three`'s
entry points and the library (with a trailing-slash entry for its subpaths):

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js",
      "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js",
      "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.tsl.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/",
      "@casmo/tree.js": "https://cdn.jsdelivr.net/npm/@casmo/tree.js/dist/index.js",
      "@casmo/tree.js/": "https://cdn.jsdelivr.net/npm/@casmo/tree.js/dist/"
    }
  }
</script>
<script type="module">
  import * as THREE from 'three/webgpu';
  import { createTree, loadStyle } from '@casmo/tree.js';
  import { createTreeEffects } from '@casmo/tree.js/effects.js'; // subpaths: dist/<name>.js

  const lowPoly = await loadStyle('low-poly'); // or import '@casmo/tree.js/styles/low-poly.js'
  const tree = createTree(lowPoly.broadleaf, { seed: 3 });
  // ...the same scene setup as in the quick start
</script>
```

Styles and the realistic textures load relative to the library's URL, so they come from the CDN too. See
[`examples/cdn/index.html`](examples/cdn/index.html) for a complete page (with Growth, Season and Wind sliders).

## Baked Trees (glTF export)

A Baked Tree is a static copy of one tree at a fixed Growth and Season (no Growth, Season or Wind left), with
classic `MeshStandardMaterial`s, for other engines or tools:

```ts
import { bakeTree, createTree, disposeBakedTree, exportBakedTree } from '@casmo/tree.js';

const tree = createTree({ schemaVersion: 2 }, { seed: 4 });
const glb = await exportBakedTree(tree, { growth: 1, season: 0.6 }); // ArrayBuffer (.glb); binary: false = glTF JSON
const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));

const baked = bakeTree(tree, { season: 0.6 }); // a THREE.Group, e.g. for your own exporter
// ...export it, then free its geometries and materials:
disposeBakedTree(baked);
```

## Textures

Definitions with textures (the realistic Style, or your own `materials.bark.map` / `materials.leaf.map`
URLs) load them relative to the package's `dist/textures/` by default. To serve them yourself, copy that
folder and point tree.js at it, app-wide or per tree:

```ts
import { createTree, setTextureOptions } from '@casmo/tree.js';
import realistic from '@casmo/tree.js/styles/realistic';

setTextureOptions({ basePath: 'https://cdn.example.com/tree-textures/' });
const tree = createTree(realistic.conifer, {
  seed: 1,
  textures: { urls: { 'realistic/needles.png': '/my-needles.png' } }, // per-tree overrides win
});
await tree.ready;
```

## Tree Editor

The Tree Editor is a web app for designing Tree Definitions: start from a Style, change every parameter with
a live preview (Seed, Growth, Season, Wind, Tree Effects), sculpt single branches and leaf areas of one Seed
(move, delete, paint leaves), undo/redo, and export the Definition as JSON for
`createTree(definition)` (or a Baked Tree as `.glb`). It is published on GitHub Pages
([casmo.github.io/tree.js](https://casmo.github.io/tree.js/)); run it locally with `npm run dev:editor`.

## Examples

| Example | Run | What |
| --- | --- | --- |
| [`examples/vanilla`](examples/vanilla/main.ts) | `/examples/vanilla/` | one tree in plain three.js; `?style=low-poly&form=conifer&seed=2&growth=0.6&season=0.7&wind=0.5` |
| [`examples/cdn`](examples/cdn/index.html) | `/examples/cdn/` | no bundler: a single HTML page with an import map |
| [`examples/react`](examples/react/main.tsx) | `/examples/react/` | React Three Fiber: `<Tree>`, `<Wind>`, `useTreeStyle`; `?scene=forest` for `<Forest>` |
| [`examples/forest`](examples/forest/main.ts) | `/examples/forest/` | a 400-tree Forest; `?trees=&variants=&style=&season=` |
| [`examples/effects`](examples/effects/main.ts) | `/examples/effects/` | Tree Effects per Style; `?style=stylized&effects=outline` |

```sh
npm install
npm run dev              # then open http://localhost:5173/examples/vanilla/ (or any example above)
npm run build:examples   # production build of the bundled examples -> examples/dist
```

The examples import the library by its package name (`@casmo/tree.js`), exactly like an app would; in this
repository that name resolves to the sources. The CDN example needs no build at all: copy
`examples/cdn/index.html` anywhere and open it over http(s). (The dev server rewrites its imports to the
sources too; the e2e test serves it unmodified, with the import map answered by the built `dist/`.)

## Development

`npm test` (Vitest), `npm run typecheck`, `npm run lint`, `npm run build` (library -> `dist/`),
`npm run test:e2e` (Playwright; run `npm run build` and `npm run build:examples` first, as CI does).
Design decisions live in [`docs/adr`](docs/adr), the vocabulary in [`GLOSSARY.md`](GLOSSARY.md).

## License

MIT
