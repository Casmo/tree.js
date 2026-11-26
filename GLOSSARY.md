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
A visual look shipped with the library, such as low-poly, stylized, realistic, painterly, whimsical or enchanted, that can be applied to any Species: it sets how the tree is drawn (shading, leaf shape, textures, polygon detail) and may set its overall size (painterly scales every tree to 2–4 m, keeping its proportions) or its Twist (a Fantasy Style), but never anything else about what shape it grows.
_Avoid_: Theme, type, kind

**Fantasy Style**:
A Style that draws trees as no real tree looks and wrings every tree it draws with its own Twist, keeping the Species' Crown Shape, branches and Fruit: Whimsical or Enchanted.
_Avoid_: Twisted style, fantasy preset

**Whimsical**:
The Fantasy Style built on Corkscrew: every tree swirls as one around a single Spin, in candy-bright colours with round puffs of leaves at its tips.
_Avoid_: Seuss, cartoon, Truffula

**Enchanted**:
The Fantasy Style built on Snake: long, sinuous trunks and branches with deep blue-violet bark and leaves that glow from within, made for dark scenes.
_Avoid_: Magic, glowing, bioluminescent style

**Species**:
A named kind of real tree shipped with the library, such as Oak, Birch or Douglas Fir, described once by its shape, foliage, colours and Season Profile, and drawn in any Style.
_Avoid_: Preset, tree type

**Form**:
The broad group a Species belongs to, broadleaf or conifer, used to sort Species; it does not change how a tree grows.
_Avoid_: Tree type

**Leaf Type**:
The kind of leaf a Species has, such as broad, lobed, palmate, compound, needle or scale; each Style decides how to draw it.
_Avoid_: Leaf shape, foliage style

**Bark Type**:
The kind of bark surface a Species has, such as furrowed, smooth, papery, fibrous or plated; each Style decides how to draw it.
_Avoid_: Bark texture, bark style

**Fruit**:
What a tree bears on its outermost twigs after blossom, such as apples, nuts or cones; it swells, ripens and drops across Season and only appears on a fully grown tree.
_Avoid_: Produce, seeds

**Fruit Type**:
The kind of Fruit a Species bears: round, pear, nut, cone or berry; each Style decides how to draw it.
_Avoid_: Fruit shape

**Leaf Mass**:
One of the few large, ragged masses a Painterly crown is drawn as: a clump of painted leaf-spray cards whose normals are bent to the clump, so it is lit and painted as one shape, standing in for many leaves (ADR 0014).
_Avoid_: Blob, puff

**Stem**:
One of the trunks a tree grows from the ground; most trees have a single Stem, a juniper or an olive may have several.
_Avoid_: Trunk copy, multi-trunk

**Root Flare**:
The widening of a Stem towards the ground, where it sinks into the soil instead of standing on it like a post pushed into the ground.
_Avoid_: Buttress, trunk foot, base flare

**Root**:
A woody part growing from the Root Flare of a Stem, outwards and slightly down, that tapers to a point below the ground; it grows with its Stem, never sways in the Wind and cannot be Sculpted.
_Avoid_: Surface root, root branch

**Ground Tint**:
A darker or mossy colour of the bark close to the ground, fading out a short way up the Stem.
_Avoid_: Moss, dirt, base colour

**Crown Shape**:
The outline of a tree's branches, set by how branch length and branch angle change from the base to the tip of the parent they grow from, such as a cone, a ball, a column, a vase or a flat top.
_Avoid_: Silhouette, profile

**Twist**:
The smooth twists and turns a branch or Stem makes along its length, a set number of times (its Twists), in one of two Twist Styles: Snake or Corkscrew; unlike bark that spirals around a branch, a Twist moves where the branch goes.
_Avoid_: Curve (that is a Crown Shape curve), meander, wobble, bend (that is Bend, the random jitter at every Section)

**Twist Style**:
The kind of Twist a branch level or trunk makes: Snake or Corkscrew.
_Avoid_: Twist mode, twist type

**Snake**:
The Twist Style where each turn swings the branch out to one side and back onto its course, each turn roughly opposite the last, so it ends heading where it would have without Twist.
_Avoid_: Zigzag, wave

**Corkscrew**:
The Twist Style where the branch spirals around its own course, one full turn per Twists, like a helix.
_Avoid_: Helix, spiral (that is Spiral, the angle between neighbouring branches around their parent), rotation

**Spin**:
Which way round a Corkscrew turns: clockwise, counter-clockwise, or Random, where the Seed picks per branch or Stem.
_Avoid_: Handedness, direction

**Twist Curve**:
How far the course of a Corkscrew itself bends while it spirals, so the branch or Stem ends up heading in a clearly turned direction.
_Avoid_: Curve (that is a Crown Shape curve), bend (that is Bend)

**Follow Twist**:
A branch level setting by which Corkscrew branches on a Corkscrew parent take the parent's Spin, pick up its spiral where they attach and bend their Twist Curve the same way, so the tree swirls as one.
_Avoid_: Inherit twist, chain twist

**Growth**:
How far a tree has grown, a value from 0 (sapling) to 1 (fully grown) that the app may change at any moment to animate it.
_Avoid_: Age, progress, scale

**Season**:
The point in the yearly cycle, a value from 0 (first day of spring) to 1 (last day of winter), that sets a tree's leaf colour and leaf coverage.
_Avoid_: Weather, time of year

**Leaf Palette**:
One of several alternative sets of leaf colours across Season in a Tree Definition, with a matching accent colour for the bark; the Seed picks one per tree, so a Forest of one Definition can come in many colours.
_Avoid_: Colour scheme, theme, colour variant

**Season Profile**:
The part of a Tree Definition that says how leaf colour, leaf coverage and blossom change across Season, as keyframes from 0 to 1.
_Avoid_: Season preset, season style

**Wind**:
The sway of branches and leaves, set by a scene-wide direction and strength and a per-tree response.
_Avoid_: Sway, animation

**Wind Burst**:
A short, local push of air from a point on the ground, such as where a building is placed, that bends nearby trees away from it and fades out within a second or two, on top of the scene-wide Wind.
_Avoid_: Blast, gust, impulse

**Tree Effect**:
An opt-in post-processing effect that only alters the pixels of trees, such as an outline or leaf glow, either shipped with the library or written by the app; the one exception is the thin ring a Highlight draws just around its trees.
_Avoid_: Post preset, filter

**Scene Effect**:
An opt-in effect that alters the whole frame, not just the trees, such as tone mapping, anti-aliasing, ambient occlusion, bloom, fog or god rays.
_Avoid_: Post effect, filter, scene preset

**Scene Pipeline**:
The opt-in, ready-made way to render a scene with a Style's suggested Tree Effects and Scene Effects together; the app may change any part of it or use the parts on their own instead.
_Avoid_: Post stack, render preset

**Inner Lines**:
A Tree Effect that draws ink lines inside a tree where its surface folds or steps away from the viewer, such as around each leaf clump, on top of the outline around the tree.
_Avoid_: Edge detection, Sobel lines, inner outline

**Highlight**:
A Tree Effect that marks the trees the app points out, such as the one under the cursor, by brightening and tinting them and drawing a ring just outside them, optionally pulsing.
_Avoid_: Selection, hover, focus

**Tree ID**:
A number that tells which single tree (a Tree or one tree of a Forest) drew a pixel, 0 where no tree did; it is only valid for the frame it was drawn in, because a Forest may reorder its trees when one is added or removed.
_Avoid_: Object id, instance id, pick id

**Material Feature**:
An opt-in change to how a tree's own materials are lit or shaded, such as Crown Normals, Leaf Translucency or Structural Occlusion; unlike a Tree Effect it needs no extra pass and works with the app's own lights.
_Avoid_: Shader effect, material effect, post effect

**Tree Shader Hook**:
A piece of shading the app hands to the library for one tree part (bark, leaves or fruit) that changes the surface colour of every tree it is set on, near or far, without the app touching the tree's materials.
_Avoid_: Material patch, onBeforeCompile, custom material

**Snow Cover**:
A ready-made, opt-in Tree Shader Hook that whitens the upward-facing surfaces of trees by a scene-wide snow amount, drawn to suit the tree's Style.
_Avoid_: Weather, frost, winter

**Wetness**:
A ready-made, opt-in Tree Shader Hook that darkens trees and gives them a sheen by a scene-wide wetness amount, as after rain, drawn to suit the tree's Style.
_Avoid_: Rain, weather, wet look

**Crown Volume**:
The single smooth ellipsoid that encloses a tree's leaves when fully grown, used to light and shade the crown as one shape.
_Avoid_: Crown hull, crown sphere, bounding volume

**Crown Normals**:
A Material Feature that bends each leaf's lighting direction towards the surface of the Crown Volume, from 0 (each leaf lit on its own) to 1 (the crown lit as one soft shape).
_Avoid_: Spherical normals, bent normals, foliage normals

**Leaf Translucency**:
A Material Feature where light shining through the leaves towards the viewer makes them glow in their own colour, more at the thin edge of the crown.
_Avoid_: Subsurface, back-lighting, leaf glow

**Structural Occlusion**:
A Material Feature that darkens the ambient light on parts of a tree hidden by the tree itself, such as leaves deep in the crown and the trunk under it, worked out once from the tree's shape.
_Avoid_: Structural AO, baked AO, vertex AO

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

**Detail Level**:
How finely one tree of a Forest is drawn for its distance from the camera: Full, Light (the same Variant with fewer faces and leaves) or Impostor, cross-fading between neighbouring levels; a Forest only has Detail Levels when the app asks for them.
_Avoid_: LOD, level of detail, quality

**Impostor**:
A picture of a fully grown Variant, taken from many directions and drawn as a card turned to the camera that is still lit, follows Season and sways in the Wind; the farthest Detail Level.
_Avoid_: Billboard, sprite, card

**Tree Editor**:
The web app in which a person designs a Tree Definition and exports it.
_Avoid_: Designer, builder, playground
