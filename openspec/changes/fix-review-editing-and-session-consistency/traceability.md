# Traceability Matrix: Fix Review Editing & Session Consistency

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 12**: Focus theft on Answer typing | `src/components/extracts/QACreatorPopup.tsx:23` | `review-editing-and-session-consistency`: Stable focus during card authoring | Tasks 1.1, 1.2, 1.3 | T01: Q&A modal focus suite |
| **Screenshot 06**: Deck Manager tag edit reverts | `src/components/review/DeckManagerCardRow.tsx:265` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 2.1, 2.2, 2.4, 2.5 | T02: Deck Manager tag editing suite |
| **Screenshot 14**: Cannot add tag to untagged card | `src/components/review/DeckManagerCardRow.tsx:264` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 2.3, 2.5 | T02: Deck Manager tag editing suite |
| **Orig_04**: Scroll Mode "Failed to save card" toast | `src/pages/QueueScrollPage.tsx:1842` | `review-editing-and-session-consistency`: Complete tag editing and add affordance in Deck Manager | Tasks 3.1, 3.2 | T03: Scroll Mode card edit persistence test |
| **Orig_09 & Orig_10**: Deleting card requires grade to advance | `src/stores/reviewStore.ts:420` | `review-editing-and-session-consistency`: Advance-on-delete review session transition | Tasks 3.3, 3.4 | T04: Review session delete advancement test |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| R02, R05 | 4.1 | Renderer and parity tests exist. Real persisted cloze/mask fixture and native visual acceptance pending. |
| R01, R03, R06, R08 | 4.2 | Inline editor exists. Verify actual entry and SQLite/browser save for every edit surface. |
| R04 | 4.3 | Advance-on-removal source identified. Restart, stale reload and undo verification pending. |
| R07, R09 | 4.4 | Existing local tag and focus code present. Real workflow tests pending. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| R01–R03, R05, R06, R08 | [Same persisted card is usable across review surfaces](specs/review-editing-and-session-consistency/spec.md#requirement-same-persisted-card-is-usable-across-review-surfaces) |
| R04 | [Advance-on-delete review session transition](specs/review-editing-and-session-consistency/spec.md#requirement-advance-on-delete-review-session-transition) |
| R07 | [Complete tag editing and add affordance in Deck Manager](specs/review-editing-and-session-consistency/spec.md#requirement-complete-tag-editing-and-add-affordance-in-deck-manager) |
| R09 | [Stable focus during card authoring](specs/review-editing-and-session-consistency/spec.md#requirement-stable-focus-during-card-authoring) |
