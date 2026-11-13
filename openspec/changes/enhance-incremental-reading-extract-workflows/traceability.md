# Traceability Matrix: Incremental Reading Extract Workflows

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 17**: Extract editor missing indentation | `src/components/extracts/ExtractContentEditor.tsx:112` | `incremental-reading-extract-workflows`: Hierarchical indentation in extract note editor | Tasks 1.1, 1.2, 1.3, 1.4 | T01: Rich text indentation suite |
| **Workflow Need**: Return to source navigation | `src/components/extracts/ExtractReaderView.tsx` | `incremental-reading-extract-workflows`: Bidirectional return to source navigation | Tasks 2.1, 2.2, 2.3, 2.4 | T02: Bidirectional source navigation test |
| **Workflow Need**: Extract priority inheritance | `src-tauri/src/commands/extract.rs` | `incremental-reading-extract-workflows`: Extract priority inheritance | Tasks 3.1, 3.2 | T03: Priority inheritance test |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `incremental-reading-extract-workflows`: Extract priority inheritance | Tasks 3.3, 3.4, 3.5, 3.6 | T04: Settings search catalog coverage gate |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| X03, X04 | 4.1 | Existing indent and selection-context metadata verified in source. Real round-trip pending. |
| X01 | 4.2 | Existing passage cloze action located. Cross-reader direct creation and no side effects pending. |
| X02 | 4.3 | Combined entry point absent in current command search. Test native/browser failure and durable retry before UI release. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| X01 | [Direct cloze creation from reader selection](specs/incremental-reading-extract-workflows/spec.md#requirement-direct-cloze-creation-from-reader-selection) |
| X02 | [Extract and Reschedule is an atomic reading action](specs/incremental-reading-extract-workflows/spec.md#requirement-extract-and-reschedule-is-an-atomic-reading-action) |
| X03 | [Hierarchical indentation in extract note editor](specs/incremental-reading-extract-workflows/spec.md#requirement-hierarchical-indentation-in-extract-note-editor) |
| X04 | [Bidirectional return to source navigation](specs/incremental-reading-extract-workflows/spec.md#requirement-bidirectional-return-to-source-navigation) |
