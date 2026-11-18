# Material Features are opt-in and pass-free

tree.js is embedded in games that bring their own renderer setup, lights, post-processing and look, so Material Features (Crown Normals, Leaf Translucency, Structural Occlusion) are optional fields in the Tree Definition's `materials` section. They are off when absent, never switched on by a built-in Style or Species, and live entirely inside the tree's own node materials. Turning one on never touches the app's renderer, scene, lights or pipeline and adds no render pass. With nothing set, every tree (every Style and Species, Forest and Baked Tree) has byte-identical geometry and attributes and the same materials as before. Suggested values per Style are published as data (`SUGGESTED_MATERIAL_FEATURES`, like `SUGGESTED_TREE_EFFECTS`) for the app to pass in explicitly.

## Considered Options

- **On by default in the built-in Styles**: rejected. Every app's trees would change look on upgrade and could clash with the game's own lighting and SSAO.
- **Screen-space versions (Tree Effects or app post passes)**: rejected for these three. They need extra passes and MRT, don't work in Baked Trees, and structural occlusion inside the crown can't be seen in screen space anyway.
- **Emissive hacks for translucency**: rejected. Translucency is a per-light term in the lighting models, so it follows every light and shadow in the app's scene.

## Consequences

Per-vertex data a feature needs (the `aOcclusion` attribute) is only generated when that feature is set. The Crown Volume is always computed, but it is stored next to the geometry (`TreeData.crown`), not in it. A lighting model is only replaced when Leaf Translucency is set. Baked Trees carry the results in standard glTF channels (Crown Normals blended into `NORMAL`, `_OCCLUSION` with the strength applied, `KHR_materials_diffuse_transmission`), with the settings in `extras`, so other engines can use them.
