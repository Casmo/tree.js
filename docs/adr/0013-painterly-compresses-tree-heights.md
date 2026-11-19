# The Painterly Style compresses tree heights to 2–4 m

Painterly is aimed at top-down (tycoon) games where trees should be only a bit taller than people, so the Style, not the app, scales each Species uniformly (trunk, branches, leaves, roots together, keeping proportions) so that a fully grown tree's height maps linearly from the Species' real height into 2.0–4.0 m, keeping the order between Species; its generic broadleaf and conifer Definitions are 3 m and 3.5 m. This breaks the earlier rule that a Style only chooses how a tree is drawn: a Style may now set a tree's overall size, never its shape. The other Styles keep real-world sizes.

## Considered Options

- **A general target-height option in the Tree Definition, set by Painterly by default**: rejected for now. No other Style needs it, and it adds a field every Definition and the Tree Editor must carry. It can still be added later without changing Painterly's output.
- **Keep real sizes and let the app scale the object**: rejected. Every tycoon app would have to work out its own per-Species scale, and leaf and bark detail would be sized for 15 m trees.

## Consequences

Switching a tree between Painterly and another Style in the Tree Editor changes its size. A Painterly Tree Definition exported from the Editor stores the scaled lengths, so it stays small in any Style it is later drawn in.
