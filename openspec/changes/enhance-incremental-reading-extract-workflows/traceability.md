# Traceability Matrix: Incremental Reading Extract Workflows

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 17**: Extract editor missing indentation | `src/components/extracts/ExtractContentEditor.tsx:112` | `incremental-reading-extract-workflows`: Hierarchical indentation in extract note editor | Tasks 1.1, 1.2, 1.3, 1.4 | T01: Rich text indentation suite |
| **Workflow Need**: Return to source navigation | `src/components/extracts/ExtractReaderView.tsx` | `incremental-reading-extract-workflows`: Bidirectional return to source navigation | Tasks 2.1, 2.2, 2.3, 2.4 | T02: Bidirectional source navigation test |
| **Workflow Need**: Extract priority inheritance | `src-tauri/src/commands/extract.rs` | `incremental-reading-extract-workflows`: Extract priority inheritance | Tasks 3.1, 3.2 | T03: Priority inheritance test |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `incremental-reading-extract-workflows`: Extract priority inheritance | Tasks 3.3, 3.4, 3.5, 3.6 | T04: Settings search catalog coverage gate |
