# Traceability Matrix: Document Rotation & New Item Scheduling

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 13**: Card created at 9:01 AM shown Overdue at 9:08 AM | `src/utils/reviewUx.ts:264` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 1.1, 1.2, 1.3, 1.4 | T01: Same-day creation due state test |
| **O02**: Opposing overdue calculations | `src-tauri/src/algorithms/daqe/terms.rs:130` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 2.2, 2.4 | T02: Monotone bounded overdue sweep |
| **O05**: FSRS document bonuses conflated with card recall | `src/components/review/ReviewQueueView.tsx:1767` | `document-rotation-and-new-item-scheduling`: Disambiguated document rotation semantics | Tasks 2.1, 2.3 | T03: Document reading interval isolation |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `document-rotation-and-new-item-scheduling`: Calendar-day normalized due date evaluation | Tasks 3.1, 3.2, 3.3, 3.4 | T04: Settings search catalog coverage gate |
