---
status: superseded by ADR-0021 (which levels default to 1)
---

# Tip Branches are on by default, also for saved Tree Definitions

Stems and first-level branches no longer end in a flat, cut-off stump: by default each grows one Tip Branch that carries it on. An absent `tipBranches` means 1 on branch levels 1 and 2 (the branches growing from the Stems and from the first-level branches) and 0 on deeper levels. We chose this over a schema migration that would write 0 into older saved Definitions, because a stump is never what anyone designed: every existing Species, Style starter and saved or exported Tree Definition gains its Tip Branches the next time it is loaded, and anyone who wants the old stump sets the level's Tip Branches to 0.

## Consequences

- Existing trees change shape (their snapshot tests too), but only by gaining branches. Tip Branches are numbered after a level's side branches, so no existing branch moves, its Seed draws stay the same, and Sculpts still land where they were (ADR 0003).
- A Tree Definition can't tell "absent" from "default", so making the default 0 again later would change every tree again. Exports should keep writing the field once it has been set.
