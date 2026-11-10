# Technical Investigation: Incremental Reading Extract Workflows

## 1. Problem Evidence

1. **Screenshot 17**: The extract rich text note editor provided basic bold/italic formatting, but lacked indentation actions. Users attempting to structure notes into nested outlines found that pressing Tab did not indent bullet lists.
2. **Workflow Friction**: Users studying extracts during queue sessions had no direct one-click link back to the parent document passage, breaking contextual comprehension.
3. **Priority Disconnect**: High-priority books yielded extracts that defaulted to neutral 50% priority, requiring manual re-prioritization for every extracted snippet.

## 2. Root Cause Analysis

1. **Incomplete TipTap Extension Configuration (`src/components/extracts/ExtractContentEditor.tsx:112`)**:
   `ExtractContentEditor` registered basic marks and nodes, but omitted list nesting commands (`sinkListItem`, `liftListItem`). Furthermore, native tab key handling was not intercepted inside lists, causing browser focus to leave the editor.
2. **Unconnected Navigation Primitives**:
   `extracts` table stored `cfi` (for EPUBs) and `page_number` (for PDFs), but `ExtractReaderView.tsx` lacked a button wired to the viewer's `jumpToLocation` dispatch.
3. **Hardcoded Extract Priority Initialization**:
   `create_extract` in `src-tauri/src/commands/extract.rs` assigned a default priority score without inspecting parent document priority.

## 3. Remediation Strategy

- Add TipTap list sink/lift commands, toolbar buttons, and Tab/Shift-Tab keybindings.
- Wire a "Return to Source" button in `ExtractReaderView.tsx` to DocumentViewer navigation.
- Add priority inheritance logic in `create_extract`.
