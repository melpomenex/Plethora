## Why

Image Occlusion flashcards in Plethora currently expose surrounding labels during review because each card is stored and rendered with only its own isolated target mask. When reviewing one region of an anatomy diagram, map, or flowchart, neighboring labels remain visible and leak contextual answers, preventing genuine recall. Revealing the answer unmasks all regions at once rather than just the target. Additionally, cards generated from the same authoring session lack sibling set awareness, making synchronized edits and consistent hide-all behavior impossible.

## What Changes

- **Shared Occlusion-Set Architecture**: Group cards created from the same source image into a canonical `OcclusionSet` (`occlusionSetId`), tracking the complete list of diagram regions alongside each card's `targetRegionId`.
- **Default "Hide All, Guess One" Review**: During review, all sibling regions in the occlusion set remain masked to prevent contextual answer leakage.
- **Active Target Visual Distinction**: The active target region being tested is clearly distinguishable from sibling blocker masks (e.g., active accent border, subtle `?` badge, theme-aware focus styling) without leaking the answer.
- **Target-Only Reveal**: Revealing the answer unmasks only the active target region; all sibling masks remain concealed.
- **"Reveal All" Affordance**: Provide an optional post-reveal action ("Reveal all labels") allowing learners to uncover all sibling labels on demand for full diagram context.
- **Optional "Hide One, Guess One" Mode**: Support authoring and card configuration where only the target is masked and sibling labels remain visible when intentional surrounding context is desired.
- **Backward Compatibility & Schedulers**: Seamlessly support legacy single-mask cards, integrate with FSRS and SM-x scheduling, and preserve review histories without data corruption.

## Capabilities

### New Capabilities
- `image-occlusion-review`: Review-time rendering of occlusion masks, visual distinction between target and sibling masks, target-only answer reveal, and on-demand reveal-all toggle.
- `image-occlusion-sets`: Canonical occlusion set model, card sibling relationships, batch authoring expansion, and non-destructive editing synchronization.

### Modified Capabilities

## Impact

- **Frontend Review UI**: `src/components/review/ReviewCard.tsx` updated to render target vs sibling masks, single-target reveal, and the reveal-all toggle.
- **Authoring & Composer**: `src/components/occlusion/ImageOcclusionComposer.tsx`, `src/components/occlusion/OcclusionComposerHost.tsx`, `src/utils/occlusion.ts` updated to persist `occlusionSetId`, `targetRegionId`, and `allRegions` in `interaction_metadata`.
- **Data Models & Types**: `src/types/learningItemInteractions.ts` extended with `occlusionSetId`, `targetRegionId`, `occlusionMode`, and sibling region metadata.
- **Scheduler & Sync**: Review queue, FSRS/SM-x scheduler, rating submissions, and Yjs/SQLite persistence operate with zero disruptions.
