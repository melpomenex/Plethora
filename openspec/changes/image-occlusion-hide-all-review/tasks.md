## 1. Data Model & Expansion Utilities

- [ ] 1.1 Update `LearningItemInteractionMetadata` in `src/types/learningItemInteractions.ts` to include `occlusionSetId`, `targetRegionId`, and `occlusionMode`.
- [ ] 1.2 Update `expandRegionsToCards` in `src/utils/occlusion.ts` so that in "hide-all" mode, it generates one card per region where all regions are included in `hiddenRegions` and the active target region is explicitly marked with `targetRegionId`.
- [ ] 1.3 Add unit tests in `src/utils/__tests__/occlusion.test.ts` verifying that `expandRegionsToCards` correctly sets `targetRegionId` and sibling regions for both "hide-all" and "hide-one" modes.

## 2. Composer Authoring & Persistence

- [ ] 2.1 Update `ImageOcclusionComposer.tsx` authoring options to surface the "Hide other answers" (default) vs "Show other answers" review mode setting.
- [ ] 2.2 Update `OcclusionComposerHost.tsx` to generate a stable `occlusionSetId` (UUID/timestamp-slug) during batch card creation and persist `occlusionSetId`, `targetRegionId`, `occlusionMode`, and full `imageOcclusionRegions` in each item's `interaction_metadata`.
- [ ] 2.3 Add unit tests in `src/components/occlusion/__tests__/OcclusionComposerHost.test.tsx` verifying batch creation writes shared `occlusionSetId` and proper `targetRegionId` on every card.

## 3. Review Rendering & Answer Reveal

- [ ] 3.1 Refactor `ReviewCard.tsx` image occlusion rendering to differentiate between target region and sibling blocker regions on the front card face.
- [ ] 3.2 Add active target styling with high-contrast accent border and a centered question-mark (`?`) badge while keeping label text concealed.
- [ ] 3.3 Update answer reveal logic in `ReviewCard.tsx` so clicking "Show Answer" unmasks only the target region while keeping sibling regions masked.
- [ ] 3.4 Add a "Reveal all labels" toggle button below the image frame on the revealed card face that unmasks all sibling regions on click.
- [ ] 3.5 Ensure card state resets properly when navigating between cards in a review session.
- [ ] 3.6 Ensure legacy cards without `targetRegionId` continue to render the single mask as the target without errors.

## 4. Verification & Testing

- [ ] 4.1 Add unit and component tests in `src/components/review/__tests__/ReviewCard.test.tsx` for front face sibling masking, target visual distinction, single-target answer reveal, and reveal-all button interaction.
- [ ] 4.2 Test responsive scaling and coordinate alignment across window resize and mobile viewports.
- [ ] 4.3 Verify that card rating and FSRS / SM-x review algorithms remain completely intact and unaffected.
