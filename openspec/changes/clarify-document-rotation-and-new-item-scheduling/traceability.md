# Traceability Matrix: Document Rotation & New Item Scheduling

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 13**: Card created at 9:01 AM shown Overdue at 9:08 AM | `src/utils/reviewUx.ts:264` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 1.1, 1.2, 1.3, 1.4 | T01: Same-day creation due state test |
| **O02**: Opposing overdue calculations | `src-tauri/src/algorithms/daqe/terms.rs:130` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 2.2, 2.4 | T02: Monotone bounded overdue sweep |
| **O05**: FSRS document bonuses conflated with card recall | `src/components/review/ReviewQueueView.tsx:1767` | `document-rotation-and-new-item-scheduling`: Disambiguated document rotation semantics | Tasks 2.1, 2.3 | T03: Document reading interval isolation |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 3.1, 3.2, 3.3, 3.4 | T04: Settings search catalog coverage gate |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| D03 | 4.1 | Deck Manager defect verified in source. Browser/native visual and zone/DST assertions pending. |
| D01–D02 | 4.2 | Settings consumers and current scheduler source audited. Run existing default 7, change to 14, native and browser reload, and explicit postpone cases. |
| D04 | 4.3 | Existing new/future semantics inspected. Run seeded creation and first interaction for each kind on both adapters. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| D01 | [Disambiguated document rotation semantics](specs/document-rotation-and-new-item-scheduling/spec.md#requirement-disambiguated-document-rotation-semantics) |
| D02 | [Configured document revisit interval](specs/document-rotation-and-new-item-scheduling/spec.md#requirement-configured-document-revisit-interval) |
| D03 | [Calendar-day normalized due date evaluation](specs/document-rotation-and-new-item-scheduling/spec.md#requirement-calendar-day-normalized-due-date-evaluation) |
| D04 | [New items retain immediate eligible availability](specs/document-rotation-and-new-item-scheduling/spec.md#requirement-new-items-retain-immediate-eligible-availability) |
