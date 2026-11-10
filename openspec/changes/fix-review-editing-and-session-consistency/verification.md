# Verification Plan: Fix Review Editing & Session Consistency

## Automated Test Suites

### T01: Q&A Creator Modal Focus Isolation (Vitest)
- File: `src/components/extracts/__tests__/QACreatorPopup.focus.test.tsx`
- Scenarios:
  - Mount `QACreatorPopup`. Assert `document.activeElement` is Question textarea.
  - Focus Answer textarea. Fire userEvent typing string `"Mitochondria generates ATP"`.
  - Assert that after each character typed, `document.activeElement` remains the Answer textarea.

### T02: Deck Manager Tag Persistence Suite (Vitest)
- File: `src/components/review/__tests__/DeckManagerCardRow.tags.test.tsx`
- Scenarios:
  - Render card row with tags `["biology"]`. Edit tags to `["biology", "cell"]`. Verify `onUpdateTags` is called with new array and row re-renders with both tags.
  - Render card row with empty tags `[]`. Assert "+ Tag" button is rendered. Click "+ Tag", verify popover opens.

### T03: Scroll Mode Card Edit Persistence Suite (Vitest)
- File: `src/pages/__tests__/QueueScrollPage.cardEdit.test.tsx`
- Scenarios:
  - Render Scroll Mode session. Trigger edit card action on item 2.
  - Modify question text and click save.
  - Assert `update_learning_item` receives complete payload without validation error and toast reports success.

### T04: Review Session Delete Advancement Suite (Vitest)
- File: `src/stores/__tests__/reviewStore.deleteAdvance.test.ts`
- Scenarios:
  - Start session with 5 cards. Advance to card index 1.
  - Call `deleteCard(card[1].id)`.
  - Assert session immediately presents card index 1 (original card 2), total items is 4, and no grade prompt is active.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that card row rendering and tag popover mounting adds zero measurable latency to virtualized lists.
