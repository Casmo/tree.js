# Root Flare is trunk geometry only; Roots are their own skeleton part

A Stem's Root Flare (`trunk.flare`) is added only when the trunk is swept into the wood mesh: its skeleton points, length and radii stay as they were, so branch attachment (`sampleBranch`, `pathLength`), leaves, Fruit, Growth timing and Sculpts never move when a Definition gains or changes flare. Roots (an optional `roots` block) are grown after the Sculpt pass from each remaining Stem, kept in their own `skeleton.roots` array with their own random stream per Stem, and swept into the wood mesh after the branches; they grow with the trunk, never sway, and are not Sculptable (the Sculpt picker ignores them).

## Considered Options

- **Flare in the Stem's skeleton** (extra points, wider radii, a sunk first point): rejected, because it lengthens the Stem's path and thickens its lowest branches, so every tree with flare would shift its branches and drift its Sculpts.
- **Roots as parentless entries in `skeleton.branches`**: rejected, because parentless branches are Stems everywhere (Sculpt paths, `trunkHeight`, leaves and Fruit on a tree without branch levels, Growth and Wind arrays parallel to the branches).
- **Roots as bare wood geometry with no skeleton**: rejected, because the editor picker, tests and apps then cannot tell where Roots are.
- **Sculptable Roots**: rejected for now; clicking a Root would otherwise select its Stem and move the whole trunk.

## Consequences

The trunk's bottom ring always sits a little below the ground (about a tenth of the trunk radius), also without flare, so the wood geometry of every existing tree changes once; branches, leaves and Fruit stay byte-identical and Sculpts keep working, so no schema version bump is needed. `TreeData.skeleton.roots` and `TreeData.growth.roots` are public API.
