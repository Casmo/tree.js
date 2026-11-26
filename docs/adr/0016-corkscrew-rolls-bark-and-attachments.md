# Corkscrew rolls the bark and everything attached to it

A Corkscrew branch or Stem rolls its cross-section around its axis in step with its spiral (one full roll per Twists, in its Spin direction), and its side branches, leaves and Fruit roll with it, even though tree.js otherwise uses parallel-transport frames so a branch's cross-section never rolls. We chose this over a cosmetic-only roll (bark winds, attachments keep their spots) because the Corkscrew is meant to look wrung as a whole: the bark, the tube's facets and what grows from it should all wind together. Snake and untwisted parts keep today's unrolled frames, so no existing tree changes.

## Consequences

- Switching a parent level from Snake to Corkscrew moves where its side branches, leaves and Fruit sit around it, not just its path.
- A Corkscrew needs 6 Sections per Twists (max(Sections, 6 × Twists)), against 3 for Snake (ADR 0015), because a full roll around the axis looks angular at 3.
- Corkscrew's Spin (when Random) and Twist Curve side are drawn from the branch's or Stem's own Twist random stream (ADR 0003), so the same Definition and Seed always give the same tree.
