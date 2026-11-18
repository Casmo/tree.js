# Tree ID encoding and opt-in mask channels

Tree Effects stay opt-in and pipeline-agnostic (games bring their own post pipeline), so every channel beyond today's tree mask is opt-in: with nothing set, the scene pass is exactly `{ output, treeMask }` with the same RGBA8 mask, format and cost as before. The Tree ID lives in its own MRT target (`treeId`, one 32-bit unsigned integer, `r32uint`, 0 = no tree) next to the mask, never in it. A Tree gets one ID for all its parts. A Forest Variant gets a contiguous block of IDs, and the shader writes `block base + instanceIndex`, so the ID is per instance without a new instance attribute or any change to the Forest buffers. View normals for Inner Lines are an opt-in `normal` target as well, or the app's own one. The ready-made `TreeEffects` derives the channels from its settings and only changes the scene pass's MRT (which recompiles the scene's materials) when that set of channels changes.

IDs are handed out by one module-wide registry the first time a tree is drawn with the ID channel. It holds no strong references and never reuses an ID within a session. A Forest tree's ID is **frame-relative**: it follows the instance slot, so removing a tree (the last tree is swap-moved into its slot) or growing a Variant (new meshes, a new block) can change the IDs of other trees. The lookups (`treeFromId`, `treeIdOf`) resolve against the current slots, and picking reads and resolves in the same frame.

## Considered Options

- **Encode the ID in the mask (spare channel or a wider format)**: rejected. It would change the mask's format and cost for every app, including the ones that never use an ID.
- **8-bit or 16-bit IDs (`RG16uint` as object + instance)**: rejected. 256 or 65k objects is too few for large worlds of individual Trees plus Forests.
- **`r32float` with whole numbers**: rejected. It is exact only up to 2^24, and on the WebGL2 fallback it needs `EXT_color_buffer_float`. `r32uint` renders in core WebGPU and core WebGL2.
- **An ID that stays fixed for the tree's whole life (an extra per-instance attribute)**: rejected for now. It changes Forest geometry while the channel is on and adds bookkeeping. The only cost of frame-relative IDs is an async pick that races a removeTree.
- **A registry per `treeIdMRT()` call**: rejected. The app would have to carry the object around to every lookup, for little gain.

## Consequences

Limits: about 4.29 billion IDs per session. Each Variant reserves a block the size of its capacity, and a growing Variant reserves a new block. An ID read from an earlier frame can point at another tree, or at none, after a Forest changes. The ID texture is integer: effects read it with exact texel loads, never filtered.
