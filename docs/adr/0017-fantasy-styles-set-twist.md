# A Fantasy Style sets the Twist of every tree it draws

The two Fantasy Styles, Whimsical (Corkscrew) and Enchanted (Snake), each write their own Twist recipe onto the trunk and every branch level of any Species or Tree Definition they apply to, keeping its Crown Shape, branch counts, Fruit and Roots. This is a second, larger exception to "a Style only chooses the look" (the first is Painterly's size, ADR 0013): a Style may now set Twist, never any other part of the shape. We chose this so that "Oak in Whimsical" is an Oak, but wrung, and the whole Species catalogue becomes fantasy trees for free.

## Considered Options

- **Twist only in each Style's own generic broadleaf and conifer, `apply` stays look-only**: rejected. The 28 Species would come out straight in a fantasy look, which is not what the Styles are for.
- **Keep a source's own Twist and only add where there is none**: rejected. One Species twisted by hand would then look unlike its siblings in the same Style.

## Consequences

Switching a tree from a Fantasy Style to another Style in the Tree Editor keeps everything the Fantasy Style wrote, its Twist, its Leaf Palettes, its Season leaf colours, its bark colour and its Inner Glow (ignored by other shadings), as switching away from Painterly keeps its size: these are now part of the Definition and may hold the user's edits. We rejected restoring the Species' colours or Twist from the remembered Species id, because it would silently throw away hand edits. Switching between the two Fantasy Styles replaces the Twist, palettes and Inner Glow with the new Style's. To get the real Species back, start from it again.

A Fantasy Style also brings its own colours (Leaf Palettes and Season leaf colours, keeping the Species' Season timing) and its own shading (`whimsical`, `enchanted`), so the rule "one shading per Style" still holds.
