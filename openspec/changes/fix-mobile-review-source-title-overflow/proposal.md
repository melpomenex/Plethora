## Why

On mobile, a review card's source document title can escape its source strip and run off screen, as shown in the supplied screenshot. Learners need a readable, contained source control that reliably takes them back to the originating passage without sacrificing touch usability or access to the full title.

## What Changes

- Keep the source strip, its text, and every action inside the review card at narrow widths and enlarged text sizes, including unusually long titles without spaces.
- Make the document title the primary passage-navigation target. On compact layouts, allow up to two title lines with a visible ellipsis when necessary; keep the source icon, navigation cue, and available page number visible.
- Provide a separate, clearly labelled source-details disclosure that reveals the full wrapping title and any excerpt on touch devices. Full-title access must work without hover and when there is no excerpt.
- Keep external source links separate from buttons and place secondary source information in the expanded details so it cannot crowd out the title.
- Preserve existing passage resolution, return-to-card state, loading and unavailable outcomes, theme styling, and keyboard access.
- Add focused interaction and real-browser layout coverage for the reported overflow and its long-content and text-size variants.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flashcard-review-session`: Add requirements for contained, readable, touch-accessible source-document controls within review cards, including full-title disclosure and distinct navigation and preview actions.

## Impact

- Primary implementation: `src/components/review/CardSourceContext.tsx`; inspect its containing layout in `src/components/review/ReviewCard.tsx` and change ancestors only if needed to permit shrinking.
- Reuse `src/utils/cardSourceNavigation.ts` and the existing `onActivate` contract. Source resolution, persisted provenance, reader navigation, review scheduling, and backend APIs remain outside this change.
- Extend `src/components/review/__tests__/CardSourceContext.test.tsx`; add a small source-strip harness and geometry checks using the existing `src/visual` Playwright setup. Localize any new disclosure labels using the existing locale files.
- Coordinate with the existing `add-review-source-context` and `add-flashcard-source-navigation` changes, whose source component and navigation plumbing are already present in this checkout. This is a focused presentation and interaction follow-up, not another provenance implementation.
- No new production dependencies, schema migration, global overflow suppression, or theme redesign.
