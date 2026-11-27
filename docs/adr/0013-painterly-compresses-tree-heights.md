# The Painterly Style compresses tree heights to 2–4 m

Painterly is aimed at top-down (tycoon) games where trees should be only a bit taller than people, so the Style, not the app, scales each Species uniformly (trunk, branches, leaves, roots together, keeping proportions) so that a fully grown tree's height maps linearly from the Species' real height into 2.0–4.0 m, keeping the order between Species; its generic broadleaf and conifer Definitions are 3 m and 3.5 m. This breaks the earlier rule that a Style only chooses how a tree is drawn: a Style may now set a tree's overall size, never its shape. The other Styles keep real-world sizes.

## Considered Options

- **A general target-height option in the Tree Definition, set by Painterly by default**: rejected for now. No other Style needs it, and it adds a field every Definition and the Tree Editor must carry. It can still be added later without changing Painterly's output.
- **Keep real sizes and let the app scale the object**: rejected. Every tycoon app would have to work out its own per-Species scale, and leaf and bark detail would be sized for 15 m trees.

## Consequences

Switching a tree between Painterly and another Style in the Tree Editor changes its size. A Painterly Tree Definition exported from the Editor stores the scaled lengths, so it stays small in any Style it is later drawn in.

The catalogue's real heights (juniper, the lowest, to redwood, the tallest) map to 2.2–3.8 m, inside the 2–4 m bound, because a Seed varies a tree's height by up to about ±7 %: so every Seed of every Species stays within 2–4 m. The mapping is linear and clamped, so it keeps the order for any height, also outside the catalogue.

Painterly never shrinks a tree twice. It records the scale it applied in the optional Definition field `styleScale` (its own hand-sized broadleaf and conifer carry 1), which other Styles keep; applying Painterly to a Definition that has a `styleScale`, or that is drawn with `painted` shading, keeps its size. A tree's height alone cannot tell a Painterly-sized tree from a small real one: any rule like "keep trees under 4 m" breaks the order (a 3.9 m tree would stay 3.9 m while a 4.2 m one became 2.2 m).

Tip Branches (ADR 0019) made every Species taller by its trunk's Tip Branch, by the same rule everywhere, so the catalogue was measured again (`CATALOGUE_HEIGHTS`, 5.45–16.22 m): juniper replaced peach as the lowest Species (peach, apple and plum are within about 6 % of it), and the Painterly broadleaf and conifer were scaled down uniformly to stay 3 m and 3.5 m. The mapping and the 2.2–3.8 m range did not change.
