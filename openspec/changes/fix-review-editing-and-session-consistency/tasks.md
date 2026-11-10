# Tasks: Fix Review Editing & Session Consistency

## 1. Focus Management & Q&A Creator Modal

- [ ] 1.1 In `src/components/extracts/QACreatorPopup.tsx`, decouple `questionRef.current?.focus()` into a dedicated mount-only `useEffect` with empty dependency array `[]`.
- [ ] 1.2 Store `handleSubmit` in a ref to decouple the keyboard event listener effect from `question` and `answer` state.
- [ ] 1.3 Add Vitest component test in `src/components/extracts/__tests__/QACreatorPopup.focus.test.tsx` verifying that typing in the answer textarea does NOT trigger focus shift to the question input.

## 2. Deck Manager Tag Editing & Add Affordance

- [ ] 2.1 Update `DeckManagerCardRowProps` in `src/components/review/DeckManagerCardRow.tsx` to include `onUpdateTags: (cardId: string, tags: string[]) => void`.
- [ ] 2.2 Pass `onTagsPersisted` callback to `CompactTagEditor` in `DeckManagerCardRow.tsx:265`.
- [ ] 2.3 Render a "+ Tag" button when `card.tags.length === 0` to allow adding tags to untagged cards.
- [ ] 2.4 Update `DeckManager.tsx` to handle `onUpdateTags` and update local state and filter caches.
- [ ] 2.5 Add component test in `src/components/review/__tests__/DeckManagerCardRow.tags.test.tsx` verifying that saving tags updates the displayed row without page reload, and that untagged cards display an add affordance.

## 3. Scroll Mode Card Editing & Review Deletion

- [ ] 3.1 Update `src/pages/QueueScrollPage.tsx` to pass complete hydrated card records to `InlineCardEditor`.
- [ ] 3.2 Add error handling and optimistic rollback for card edits in Scroll Mode.
- [ ] 3.3 Update `src/stores/reviewStore.ts` `deleteCard` to advance the active session immediately to the next card without demanding a recall grade.
- [ ] 3.4 Add integration test in `src/stores/__tests__/reviewStore.deleteAdvance.test.ts` verifying that deleting a card removes it from the session, advances the index, and requires no grade.
- [ ] 3.5 Run `npm run bench:check` to ensure no performance regression.
