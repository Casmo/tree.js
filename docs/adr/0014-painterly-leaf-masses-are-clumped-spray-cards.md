# Painterly draws Leaf Masses as clumped painted spray cards, with no post

The concepts draft PR (#123, for spec #108) compared four ways to draw Painterly crowns: (A) a painted Leaf Mass mesh, (B) a mass core plus a shell of spray cards, (C) A plus a screen-space Kuwahara filter, and (D) clumped painted spray cards only. It also showed a conifer-only Tier (one drooping fan per branch), B/D hybrids and a round of "smooth" circular cards. The owner chose **D** for both broadleaf trees and conifers. Each Leaf Mass is a clump of alpha-cut, painted leaf-spray cards whose normals are bent to the clump, so the clump is lit and painted as one shape, with the dark-inside to warm-tips gradient and soft wrap lighting.

The round-2 D variants are the tuning range for the Style's per-Leaf Type settings: card density and size (D1/D2), clump count (D3/D4), gradient strength (D5/D6) and card depth in the clump (D7: cards nearer the outside give a fuller outline and show less wood). The original saturation is kept.

Painterly is complete in its own materials. It needs no Tree Effect or Scene Effect to look right, which keeps the ADR 0008 / 0010 default: Painterly may only *suggest* post as opt-in. The clump normal bending is part of Painterly's own `painted` Shading, not a Material Feature, because built-in Styles never switch Material Features on.

## Considered Options

- **A, painted Leaf Mass mesh**: cheapest and stable, but it read as soft blobs with only a slightly ragged edge.
- **B, mass core plus spray cards**: ragged edge without post, but conifers looked like topiary.
- **C, A plus a Kuwahara Tree Effect**: looked painted, but it depends on screen resolution, smears bark, and would make Painterly need post.
- **Tier for conifers**: read well on cone-shaped spruces, but pines looked like stacked umbrellas, and from straight above the crown read as a radial sunburst. D keeps a ragged conifer outline instead.
- **Smooth circular cards (round 3)**: soft and clean, but every conifer turned into round puffs. The owner preferred the painted spray look of D.

## Consequences

- A Painterly crown is mostly alpha-cut cards. The Style's `perDensity` and `sizeScale` per Leaf Type have to keep triangles and draw calls in the range of 'stylized'. Light Detail Levels and Impostors have to keep the painted spray look.
- Conifers use the same clumped cards, with conifer-specific spray textures. There is no separate Tier geometry, so the Tier term is dropped from the glossary.
