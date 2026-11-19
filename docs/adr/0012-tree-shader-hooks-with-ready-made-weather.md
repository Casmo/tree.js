# Apps change tree shading through Tree Shader Hooks; Snow Cover and Wetness are ready-made hooks

Games that embed tree.js want tree-only looks of their own (snow, rain, a painterly foliage shader), but the tree materials are node materials the library builds and keeps rewiring (Wind, Growth, Season), and far Forest trees are Impostors with a different material, so patching materials from outside misses or breaks trees. The library therefore offers one supported seam, the Tree Shader Hook: a TSL function per tree part that receives the tree's base colour and inputs such as the world normal after Wind, Season, Growth and the tree's position, and returns a new colour; the library applies it to Trees, every Forest Detail Level and Impostors. Snow Cover and Wetness ship on top of that seam as opt-in hooks that follow the Style and take settings, driven by scene-wide amounts like Wind; like Material Features (ADR 0008) nothing changes for an app that sets no hook.

## Considered Options

- **Only built-in Snow and Wetness features, no general hook**: rejected. Every other tree-only look (a brush shader, drought colour) would need a library change.
- **Only the hook, each game writes its own snow**: rejected. Most games want snow that just works with the Style; the ready-made hook is also the reference for writing your own.
- **Let apps patch `tree.leaves.material` themselves**: rejected. It is undocumented, misses Impostors and Forest Detail Levels, and breaks when the library rebuilds a material.
