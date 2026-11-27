# Leaves ride on their growing twig instead of waiting for it

Leaves used to follow the Growth rule every other part follows: a part only sprouts once its parent is fully grown, so nothing ever floats. Because leaves sit only on the outermost twigs, which sprout last, that put the first leaves at Growth ≈0.6–0.7 and a tree at Growth 0.5 looked bare. We decided that leaves no longer wait: from Leaf Start (`leaves.growthStart`, default 0.1) a leaf is carried along on its twig while that twig is still sprouting, and its size is an ease-out leaf curve times its twig's sprout progress, so a tree looks grown-up well before Growth 1. The wood timeline is unchanged; leaves are the one part with a second level of growth (their twig's sprout as well as their own).

## Considered Options

- **Stretch the per-leaf windows** (start at Leaf Start or when the twig is done, whichever is later): rejected, leaves still could not show before ≈0.6, so Leaf Start would barely do anything.
- **Compress the wood timeline** so all twigs are out by 0.5: rejected for now, it changes how the whole tree grows, not just its leaves.
- **Leaves on every branch level**: rejected, it changes the tree at Growth 1 too.

## Consequences

The "never floats" rule still holds, but for leaves it holds because they move with their twig, not because they wait for it. The CPU and TSL Growth backends both have to apply the twig's sprout to leaves.
