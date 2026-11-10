# Technical Investigation: Review Editing & Session Consistency

## 1. Problem Evidence

1. **Screenshot 12**: When authoring a Q&A card in the extract popup, typing a single character into the Answer field immediately jumped focus back to the Question input.
2. **Screenshot 06**: Editing tags in Deck Manager via `CompactTagEditor` popped up the editor, but upon closing or re-opening, the tags reverted to their previous state.
3. **Screenshot 14**: Newly created cards without tags showed an empty space in the Tags column with no way to open the tag editor or add tags.
4. **Orig_04**: Clicking "Save" after editing a card in Scroll Mode produced a "Failed to save card" toast.
5. **Orig_09 & Orig_10**: Deleting a card in Review mode left the session stuck on the deleted item, requiring the user to submit an artificial rating (1-4) to advance.

## 2. Root Cause Analysis

1. **Monolithic Dependency Array (`src/components/extracts/QACreatorPopup.tsx:38`)**:
   `useEffect` had `[onCancel, question, answer]` as dependencies, with line 23 executing `questionRef.current?.focus()`. Any change to `answer` triggered this effect and stole focus.
2. **Missing Callback Propagation (`src/components/review/DeckManagerCardRow.tsx:265`)**:
   `DeckManagerCardRow` instantiated `CompactTagEditor` without `onTagsPersisted`. While SQLite updated, React component state was never informed. Additionally, `{card.tags.length > 0 && (` gated the entire component, rendering nothing for untagged cards.
3. **Partial DTO in Scroll Mode (`src/pages/QueueScrollPage.tsx:1842`)**:
   `InlineCardEditor` received an incomplete object lacking entity IDs and version numbers, failing the Rust backend's validation during `update_learning_item`.
4. **Stale Session Pointer (`src/stores/reviewStore.ts:420`)**:
   `deleteCard` updated SQLite but did not update `currentIndex` or filter out the deleted item from `currentSession.items`.

## 3. Remediation Strategy

- Split `useEffect` in `QACreatorPopup.tsx` so focus occurs strictly on mount.
- Wire `onTagsPersisted` in `DeckManagerCardRow.tsx` and provide an add tag button for cards with zero tags.
- Hydrate full `LearningItem` models in `QueueScrollPage.tsx`.
- Automatically advance `currentIndex` and prune the deleted item in `reviewStore.ts`.
