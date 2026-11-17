# tree.js
Modulair trees in Three JS.

## React Three Fiber

`@casmo/tree.js/react` has `<Tree>`, `<Wind>` and `useTreeStyle`. It needs `react` (19) and
`@react-three/fiber` (v9), which are optional peer dependencies, so vanilla three.js users don't install them.
Trees use TSL node materials, so give `<Canvas>` a `WebGPURenderer` (it falls back to WebGL2 by itself).
R3F v9 takes an async `gl` factory, which must `await renderer.init()` before it returns:

```tsx
import * as THREE from 'three/webgpu';
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Tree, Wind, useTreeStyle } from '@casmo/tree.js/react';

function Trees() {
  const lowPoly = useTreeStyle('low-poly'); // dynamic import; suspends while it loads
  return (
    <>
      <Tree style={lowPoly} form="broadleaf" seed={1} growth={0.8} season={0.4} />
      <Tree style={lowPoly} form="conifer" seed={2} position={[3, 0, 0]} castShadow={false} />
      <Tree definition={{ schemaVersion: 2, leaves: { count: 4 } }} seed={7} position={[-3, 0, 0]} />
    </>
  );
}

<Canvas
  shadows="percentage"
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer(props as THREE.WebGPURendererParameters);
    await renderer.init();
    return renderer;
  }}
>
  <Wind direction={[1, 0, 0]} strength={0.5} />
  <Suspense fallback={null}>
    <Trees />
  </Suspense>
</Canvas>;
```

- `growth`, `season`, `castShadow`/`receiveShadow` and `<Wind>` props only update uniforms or flags on the same tree.
- A new `seed`, `definition` (compared by value), `style`/`form` or `wind` regenerates the tree. Trees are disposed of on unmount.
- `style` also takes a Style name (`<Tree style="low-poly" />`), which suspends like `useTreeStyle`. The `ref` is the tree.js `Tree` object.
- Outside React, `loadStyle('low-poly')` (core entry) loads a built-in Style the same way.
