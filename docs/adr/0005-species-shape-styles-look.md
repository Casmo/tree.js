# A Species describes shape once; a Style turns it into a Tree Definition

Each Species (Oak, Birch, Douglas Fir, ...) is authored once as Style-neutral data: Stems, branch levels with Crown Shape curves, foliage as a Leaf Type with a density and real-world size, bark colour, Season Profile and Wind. A Style is a pure function that turns a Species into an ordinary, complete Tree Definition: it chooses shading, polygon detail, textures, and how the Leaf Type is drawn (clumps, puffs, needles or textured cards, with its own leaf count and size). We rejected hand-authoring every Species in every Style (28 × 3 Definitions that drift apart) and storing per-Style overrides inside each Species, because adding a Style or a Species should cost one piece of work, not one per pair.

## Consequences

The existing `broadleaf` and `conifer` Definitions of each Style stay as they are, so current apps and screenshots don't change; Species are an additional way in. The generated Tree Definition remembers its Species and Leaf Type, so the Tree Editor can apply a different Style later. A Style's mapping is code, so how a Species looks in a Style can change between library versions unless the result is exported as a Tree Definition.
