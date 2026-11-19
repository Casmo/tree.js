# Forest Detail Levels: opt-in, GPU-selected, WebGPU only

A Forest can draw each tree at one of three Detail Levels (Full, Light, Impostor) by its distance from one LOD camera, with a dithered cross-fade between neighbouring levels. Like Material Features (ADR 0008) and Tree Effect channels (ADR 0009) it is opt-in: without `lod` a Forest builds no extra meshes, buffers or bake, and renders exactly as before. The level of every tree is chosen by a compute pass that fills indirect draws per Variant and level, so only nearby trees pay for the full mesh. Compute and indirect draws do not exist on WebGPURenderer's WebGL2 fallback, so there a LOD Forest ignores `lod` (one console warning) and draws every tree in full, as today. The rest of the library keeps its WebGL2 promise (ADR 0002).

The Light level is the same Definition and Variant Seed regenerated with fixed reductions (fewer sides and sections, the deepest branch level dropped, larger leaves), which keeps every branch in place because the generator forks its randomness per branch path (ADR 0003). Impostors are octahedral, baked lazily with the app's renderer the first time the Forest is drawn, always at Growth 1, and store per texel not just colour and normals but the leaf's Season data and the Material Feature inputs. That lets a far tree follow Season (leaf colour, leaf drop, blossom) and live Material Feature tuning without a rebake. A tree that is not fully grown never becomes an Impostor.

## Considered Options

- **CPU buckets (a JS loop sorting trees into per-level instance lists each frame)**: works on both backends, but costs a per-frame loop over every tree and uploads. Rejected in favour of compute, accepting no Detail Levels on WebGL2.
- **GPU only (every level draws every tree, the vertex shader collapses the wrong ones)**: rejected. Every tree still runs the full mesh's vertex shader, so little is saved.
- **Dropping WebGL2 for the whole library**: rejected for this feature. It would break ADR 0002 and the README for every app, not only the ones that use Detail Levels.
- **Mesh decimation for the Light level**: rejected. It breaks the per-vertex Growth, Wind and Season attributes.
- **Impostors baked offline into files**: rejected. They would not follow a live Definition and could drift from the Seed.
- **Impostors tinted only, or scaled by Growth**: rejected. A bare winter forest would keep full far crowns, and a young tree is not a scaled-down old one.

## Consequences

A tree's Tree ID stays `block base + slot`: the instance shaders read the slot through the per-level index list, not from `instanceIndex`. Shadow passes and extra cameras reuse the levels the LOD camera chose. Until the bake finishes, far trees draw at the Light level. Impostor atlases cost GPU memory per Variant (colour, normals and Season data).
