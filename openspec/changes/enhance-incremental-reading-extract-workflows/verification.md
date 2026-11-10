# Verification Plan: Incremental Reading Extract Workflows

## Automated Test Suites

### T01: Rich Text Indentation Suite (Vitest)
- File: `src/components/extracts/__tests__/ExtractContentEditor.indent.test.tsx`
- Scenarios:
  - Mount editor with a 2-item unordered list.
  - Position cursor in second list item. Simulate `Tab` key event.
  - Assert DOM structure transforms into nested `<ul>` within the first `<li>`.
  - Simulate `Shift+Tab`. Assert DOM structure lifts back to a flat 2-item list.

### T02: Bidirectional Source Navigation Suite (Vitest)
- File: `src/components/extracts/__tests__/ExtractReaderView.navigation.test.tsx`
- Scenarios:
  - Render extract view with parent document metadata and CFI.
  - Click "Return to Source".
  - Verify document viewer store action `openDocumentAtLocation` is dispatched with correct document ID and CFI.

### T03: Extract Priority Inheritance Suite (Rust)
- File: `src-tauri/src/database/__tests__/extract_priority_inheritance_tests.rs`
- Invariant: Create document with priority 85.0. Call `create_extract` with inheritance flag enabled. Assert new extract's `priority_score` is 85.0.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that list nesting and navigation transitions add zero latency to editor typing or document loading.
