# Stylized Painterly: Enchanted's Twist in Painterly's look, with its own shading name

Stylized Painterly combines two Styles: Enchanted's shapes and Painterly's look. Its `apply` writes Enchanted's Twist recipe (the same `FantasyTwistRecipe`, via `applyTwist`) onto any Species or Definition and draws it with Painterly's leaf, bark and detail look; unlike a Fantasy Style it writes no colours, Leaf Palettes or Inner Glow, so the Species keeps its own colours and Season. It keeps real sizes: Painterly's height compression (ADR 0013) is part of Painterly's purpose (tycoon cameras), not of its look. Its own `broadleaf` and `conifer` copy the Enchanted Definitions' shape fields (trunk, Stems, branch levels, gravity, Roots, and their showpiece Twist, a little stronger than the recipe), with a thinner Leaf Mass crown than Painterly's so the sinuous boughs show.

## Considered Options

- **Share the `painted` shading**: rejected. The registry recognises a Definition's Style by its shading (`styleOfShading`: the editor's Style switch, `apply` re-styling, Painterly's "already Painterly-sized" check), so a Stylized Painterly tree would come back as Painterly. Instead it has its own shading value, `stylized-painted`, which every material, weather hook and bake path draws exactly as `painted` (`isPaintedShading`). Custom Tree Shader Hooks that branch on `'painted'` should use `isPaintedShading` to include it.
- **Make it a Fantasy Style with Painterly-like palettes**: rejected. The request is Painterly's colours, which are the Species' own; a Fantasy Style replaces them.

## Consequences

"One shading per Style" still holds. Its leaf look is the same function as Painterly's (`paintedLeaf`), so leaf density and size round-trip between the two. Switching from Enchanted keeps what Enchanted wrote (ADR 0017), switching to Painterly shrinks the tree (it has no `styleScale`).
