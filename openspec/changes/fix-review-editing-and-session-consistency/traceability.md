# Traceability Matrix: Fix Review Editing & Session Consistency

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 12**: Focus theft on Answer typing | `src/components/extracts/QACreatorPopup.tsx:23` | `review-editing-and-session-consistency`: Stable focus during card authoring | Tasks 1.1, 1.2, 1.3 | T01: Q&A modal focus suite |
| **Screenshot 06**: Deck Manager tag edit reverts | `src/components/review/DeckManagerCardRow.tsx:265` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 2.1, 2.2, 2.4, 2.5 | T02: Deck Manager tag editing suite |
| **Screenshot 14**: Cannot add tag to untagged card | `src/components/review/DeckManagerCardRow.tsx:264` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 2.3, 2.5 | T02: Deck Manager tag editing suite |
| **Orig_04**: Scroll Mode "Failed to save card" toast | `src/pages/QueueScrollPage.tsx:1842` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 3.1, 3.2 | T03: Scroll Mode card edit persistence test |
| **Orig_09 & Orig_10**: Deleting card requires grade to advance | `src/stores/reviewStore.ts:420` | `review-editing-and-session-consistency`: Advance-on-delete review session transition | Tasks 3.3, 3.4 | T04: Review session delete advancement test |
