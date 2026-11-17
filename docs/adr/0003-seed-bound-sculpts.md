# Hand edits are Seed-bound Sculpts that still grow

Direct manipulation in the Tree Editor (moving or deleting a branch, painting leaves) is stored in the Tree Definition as Sculpts addressed by branch path and tied to the Seed they were made on; generation applies them after the procedural pass, so the sculpted tree still responds to Growth, Season and Wind, while every other Seed ignores them. We rejected turning hand edits into parameter changes (it cannot express "remove this one branch") and baking the tree on first edit (it would lose Growth and Season).

## Consequences

Branch paths must be stable for a given Definition and Seed, so changes to the generator that reorder branches break existing Sculpts; such changes need a schema version bump and a migration.
