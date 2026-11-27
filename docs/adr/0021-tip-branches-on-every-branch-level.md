# Tip Branches on every branch level by default

Supersedes the "levels 1 and 2" rule of ADR 0019. Branches on the third and fourth levels still ended in a flat, cut-off stump even when a level below them carried sub-branches, which looked as unintended as the stumps ADR 0019 removed. An absent `tipBranches` now means 1 on every branch level, so every Stem and branch with a level below it is carried on by a Tip Branch and only the outermost twigs (which have no level below them) keep their end. As in ADR 0019 there is no schema migration: every Species, Style starter and saved or exported Tree Definition that never set a level's Tip Branches gains them on its deeper levels the next time it loads; an explicit value, including 0, is kept.

## Consequences

- Three- and four-level trees gain twigs (and the leaves and Fruit on them) on their deeper levels; their snapshot tests change. Tip Branches still take the paths after a level's side branches, so no existing branch moves and Sculpts still land (ADR 0003).
- Making the default smaller again later would change every tree again.
