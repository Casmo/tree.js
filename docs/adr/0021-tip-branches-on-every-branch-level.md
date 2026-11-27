# Tip Branches on every branch level by default

Supersedes the "levels 1 and 2" rule of ADR 0019. Branches on the third and fourth levels still ended in a flat, cut-off stump even when a level below them carried sub-branches, which looked as unintended as the stumps ADR 0019 removed. An absent `tipBranches` now means 1 on every branch level, so every Stem and branch with a level below it is carried on by a Tip Branch and only the outermost twigs (which have no level below them) keep their end. As in ADR 0019 there is no schema migration: every Species, Style starter and saved or exported Tree Definition that never set a level's Tip Branches gains them on its deeper levels the next time it loads; an explicit value, including 0, is kept.

## The joint: a Tip Branch starts inside its parent

With the extra Tip Branches the joint showed: a Tip Branch starting exactly at its parent's last point tilts its first ring as soon as it leans (a fork, or angle variation), lifting one side off the parent's flat end cap and leaving the cap's edge sticking out. So every Tip Branch now starts back along the parent's centre line from its tip by the parent's tip radius, clamped to the start of the parent's last section (so never past its base on very short parents), with the parent's radius there as its base radius. The Tip Branch's direction, lean, length and taper are computed as before, and the parent keeps its full length and its end cap (now hidden inside the Tip Branch), so a tree's size and Crown Shape do not change. It still counts as sitting at the tip (attach = 1) for Crown Shape curves, Growth timing (it sprouts as soon as its parent is grown) and Wind sway (its base sways as the parent's tip); the small sway mismatch on the buried part is accepted.

## Consequences

- Three- and four-level trees gain twigs (and the leaves and Fruit on them) on their deeper levels; their snapshot tests change. Tip Branches still take the paths after a level's side branches, so no existing branch moves and Sculpts still land (ADR 0003).
- Making the default smaller again later would change every tree again.
- A Tip Branch's first point is no longer its parent's last point, so code that finds a branch's base on its parent must not assume it for Tip Branches. A move Sculpt on a Tip Branch rotates it about this sunk first point, which keeps the joint closed.
