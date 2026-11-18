# Crown Shape is a pair of curves per branch level, and `form` is removed from the Definition

Branch length and branch angle each get an optional keyframe curve over the attach position on the parent (0 = base .. 1 = tip), per branch level. The conifer cone, until now the only effect of `form: 'conifer'`, is one such length curve, so `form` is removed from the Tree Definition and a schema migration rewrites conifers into the equivalent curve (identical trees). We chose curves over adding more `form` values or a named crown-shape enum (conical, spherical, flame, ...) because one general parameter covers round, cone, column, vase and flat-topped crowns, reuses the keyframe type and editor UI the Season Profile already has, and keeps the generator free of per-shape special cases.

## Consequences

Form survives only as a label that groups Species (broadleaf / conifer); it never changes geometry. The editor offers named Crown Shapes as one-click curve presets, not as stored values.
