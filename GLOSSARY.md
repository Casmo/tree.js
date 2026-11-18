# tree.js

A three.js library that generates trees procedurally in different Styles, plus a Tree Editor to design them.

## Language

**Tree Definition**:
The full parameter set that describes how a tree is generated (trunk, branches, leaves, materials), independent of any Seed.
_Avoid_: Config, preset, recipe

**Seed**:
A number that, combined with a Tree Definition, picks one specific individual tree, varying its shape, colours and how it responds to Growth and Season within the Definition's ranges; the same Definition and Seed always give the same tree.
_Avoid_: Random, variation id

**Style**:
A visual look shipped with the library, such as low-poly, stylized or realistic, that can be applied to any Species: it sets how the tree is drawn (shading, leaf shape, textures, level of detail), not what shape it grows.
_Avoid_: Theme, type, kind

**Species**:
A named kind of real tree shipped with the library, such as Oak, Birch or Douglas Fir, described once by its shape, foliage, colours and Season Profile, and drawn in any Style.
_Avoid_: Preset, tree type

**Form**:
The overall kind of tree a Tree Definition grows, such as broadleaf or conifer.
_Avoid_: Tree type

**Growth**:
How far a tree has grown, a value from 0 (sapling) to 1 (fully grown) that the app may change at any moment to animate it.
_Avoid_: Age, progress, scale

**Season**:
The point in the yearly cycle, a value from 0 (first day of spring) to 1 (last day of winter), that sets a tree's leaf colour and leaf coverage.
_Avoid_: Weather, time of year

**Season Profile**:
The part of a Tree Definition that says how leaf colour, leaf coverage and blossom change across Season, as keyframes from 0 to 1.
_Avoid_: Season preset, season style

**Wind**:
The sway of branches and leaves, set by a scene-wide direction and strength and a per-tree response.
_Avoid_: Sway, animation

**Tree Effect**:
An opt-in post-processing effect that only alters the pixels of trees, such as an outline or leaf glow.
_Avoid_: Post preset, filter

**Baked Tree**:
A static export of one tree at a fixed Seed, Growth and Season, with no Growth, Season or Wind left to change.
_Avoid_: Static mesh, snapshot

**Sculpt**:
A hand edit made in the Tree Editor to one branch or leaf area of the tree produced by one specific Seed; it has no effect on any other Seed.
_Avoid_: Override, tweak, manual edit

**Forest**:
Many trees of one Tree Definition placed together, drawn from a few shared Variants; each tree keeps its own look when others are added or removed.
_Avoid_: Group, scatter, instances

**Variant**:
One Seed's tree shared by many trees in a Forest.
_Avoid_: Copy, clone

**Tree Editor**:
The web app in which a person designs a Tree Definition and exports it.
_Avoid_: Designer, builder, playground
