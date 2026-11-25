# Twist adds Sections beyond the Style's polygon detail

A branch level or trunk with Twist > 0 is drawn with max(Sections, 3 × Twists) Sections, even though Sections are otherwise polygon detail chosen by the Style (low-poly uses 1–2). We chose this over keeping the Style's Sections because a Twist cannot show on a 1–2 Section branch at all, so the slider would silently do nothing on low-poly trees; the cost is more polygons than the Style asked for whenever Twist is used.

## Consequences

- With Twist = 0 nothing changes: every existing tree, Species and golden glTF hash stays identical.
- The extra Sections must not change the rest of the branch: Gravity's total pull is spread over them, Bend's jitter stays tied to the original Sections, and children, leaves and Fruit keep attaching at the same fraction along the branch.
- Twist draws from its own random stream per branch or Stem, so branch paths and Sculpts (ADR 0003) are unaffected and no schema migration is needed.
