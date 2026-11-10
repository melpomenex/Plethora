# Verification Plan: Harden AI Learning Actions & Card Quality

## Automated Test Suites

### T01: Tool Parameter Normalization Suite (Vitest)
- File: `src/lib/ai/agent/tools/__tests__/readonly.params.test.ts`
- Scenarios:
  - Invoking `get_related_material` with `{ query: "thermodynamics" }` succeeds and queries embedding store.
  - Invoking `get_related_material` with `{ search: "cell biology", context: "chapter 4" }` succeeds and ignores `context`.
  - Invoking `get_related_material` with empty object returns structured error with accepted aliases list.

### T02: Safety Block Fallback Suite (Vitest)
- File: `src/lib/ai/__tests__/safetyFallback.test.ts`
- Scenarios:
  - Mock native Apple model returning `safety_blocked`.
  - Assert that `useDocumentSummary` does not show a raw red error toast, but sets state to `safety_blocked`.
  - Verify that UI renders `SafetyBlockedNotice` with retry button.

### T03: Extract Card Creation Foreign Key Suite (Rust)
- File: `src-tauri/src/database/__tests__/cards_fk_tests.rs`
- Invariant: Create a document and an extract from that document. Call `create_card_from_extract`. Assert `learning_items.document_id` references the document's UUID and no SQLite error 787 is emitted.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that tool parameter normalization and schema validation adds less than 0.1ms overhead per tool call.
