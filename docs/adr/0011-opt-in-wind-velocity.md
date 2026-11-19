# Wind-aware velocity is opt-in and only for the velocity channel

Wind moves vertices in the tree materials' `positionNode`, which three's `velocity` node does not see, so TRAA ghosts and motion blur misses swaying leaves. The velocity channel therefore includes the movement of Wind since the previous frame (the same Wind formula evaluated at the previous frame's time, with each Forest instance's own phase), but only when a scene pass asks for it (TRAA or motion blur). The tree materials are not changed for this: Trees and Forests register their Wind motion in a side table keyed by each material's `positionNode`, and the channel's velocity node (`windVelocity`, a subclass of three's `VelocityNode`) looks it up per draw and moves each tree vertex back by the Wind displacement; other materials get three's velocity unchanged. A material whose `positionNode` the app replaces therefore loses its Wind velocity. With no velocity channel the trees, their geometry and their materials are exactly as before, the same opt-in rule as the Tree ID channel (ADR 0009). Only Wind is included; Growth and Season changes are not treated as motion.

## Considered Options

- **Always output Wind velocity**: rejected. It would add a target and shader work to every app, including the many that never use temporal effects.
- **Leave TRAA and motion blur Wind-unaware**: rejected. Swaying leaves would ghost under TRAA, the main reason to offer it for trees.
- **Include Growth changes**: rejected. Growth is usually changed in steps or slowly, and its previous value would have to be tracked per tree.
