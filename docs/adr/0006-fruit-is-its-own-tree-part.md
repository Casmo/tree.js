# Fruit is its own tree part with its own mesh

Fruit (including nuts and conifer cones) is a third tree part next to wood and leaves: placed on the outermost twigs from its own random stream, drawn as solid geometry per Fruit Type in its own mesh and material, and carried through Growth, Season (its own amount and colour tracks), Wind, Forest, Baked Trees and Tree Effects. We rejected faking fruit as recoloured leaves (the way blossom works), which could not give fruit its own shape, size or ripening, and merging fruit into the leaves mesh, which would give it leaf textures, alpha cut-out and leaf-only effects.

## Consequences

`Tree`, `Forest` and Baked Trees gain a third mesh, which is public API. Trees without Fruit stay byte-identical, because fruit draws from its own random stream and adds no vertices to wood or leaves.
