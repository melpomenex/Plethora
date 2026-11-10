# Traceability Matrix: Selectable Strict Manual Queue Ordering

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **O01**: 50/30/20 & 0.8/0.2 memory urgency weighting | `src-tauri/src/algorithms/daqe/terms.rs:223` | `strict-manual-queue-ordering`: User-selectable queue ordering mode | Tasks 1.1, 1.2, 1.3, 1.5, 2.1, 2.3 | T01: Pure priority monotonicity test |
| **O04**: Manual priority counted twice / overridden | `src-tauri/src/algorithms/daqe/ranker.rs:57` | `strict-manual-queue-ordering`: Strict manual ordering bypasses synthetic interleaving | Tasks 1.2, 1.4, 2.2, 2.4 | T02: Variety guard bypass verification |
| **O10**: Keyboard priority shortcut persistence | `src/components/review/QueuePriorityEditor.tsx:115` | `strict-manual-queue-ordering`: User-selectable queue ordering mode | Tasks 1.5, 2.3 | T03: Shortcut commit and reload test |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `strict-manual-queue-ordering`: Settings search discoverability | Tasks 3.1, 3.2, 3.3, 3.4 | T04: Settings search catalog coverage gate |
