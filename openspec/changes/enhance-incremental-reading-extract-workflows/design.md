# Architectural Design: Enhance Incremental Reading Extract Workflows

## Problem Diagnosis

### 1. Missing Rich Text Indentation
In `src/components/extracts/ExtractContentEditor.tsx:112`:
The toolbar provides bold, italic, headings, lists, and highlighting, but omits:
- `Indent` (`Tab` / indent button)
- `Outdent` (`Shift+Tab` / outdent button)
When users create multi-level bulleted or numbered notes, pressing Tab either loses focus from the editor or inserts a raw tab character without restructuring the HTML list tree (`<ul><li>...</li></ul>`). This is evidenced in Screenshot 17.

### 2. Disconnected Extract Navigation
Extracts store `document_id` and optional `cfi` / `page_number`, but the UI lacks an explicit, prominent "View in Source" action. When reviewing an extract in isolation, users cannot easily inspect surrounding context in the parent book.

### 3. Extract Priority Disconnect
When an extract is created from a document with 95% priority, the extract currently defaults to 50% priority unless manually edited. In incremental reading, child extracts represent the most valuable pieces of high-priority reading material and should naturally inherit or be calibrated against the parent's priority.

## Architectural Solutions

### 1. TipTap Indentation & Outdent Integration
In `ExtractContentEditor.tsx`:
1. Register TipTap list and indentation extensions (`@tiptap/extension-task-list`, sink/lift list items):
```ts
editor.commands.sinkListItem('listItem') // Indent
editor.commands.liftListItem('listItem') // Outdent
```
2. Add toolbar buttons with Phosphor icons `TextIndent` and `TextOutdent`.
3. Intercept `Tab` and `Shift+Tab` within lists to execute `sinkListItem` / `liftListItem` without changing browser focus.

### 2. Deep "Return to Source" Navigation Link
In `ExtractReaderView.tsx`:
1. Add a persistent header action "Open Source Context" (`ArrowSquareOut`).
2. When activated, query parent document metadata and navigate to the viewer with exact navigation payload:
   - For EPUB: navigate to stored `cfi`.
   - For PDF: navigate to stored `page_number` with word highlight rects.
   - For Web/Text: scroll to character offset with brief background pulse animation.

### 3. Configurable Priority Inheritance
1. Add `extractPriorityInheritance: "inherit" | "manual" | "default"` in `UserSettings`.
2. In `src-tauri/src/database/extracts.rs`:
   When creating an extract, if `extractPriorityInheritance === "inherit"`, copy parent document's `priority_score` and `canonical_priority` to the extract row.
