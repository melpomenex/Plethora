## 1. Extend retrieval (do not rewrite RAG)

- [ ] 1.1 Add optional `includeSpotlight` (or equivalent) to `retrieveFromLibrary` in `src/api/ai-learning.ts` without breaking existing callers (`libraryTask.ts`, `src/lib/ai/tutor/session.ts`, `src/lib/ai/agent/sessionContext.ts`, `src/components/settings/AiIndexPanel.tsx`, `src/components/viewer/useRecallPrompts.ts`).
- [ ] 1.2 Thread the flag through `ai_learning_retrieve` in `src-tauri/src/commands/ai_learning.rs` and types in `src-tauri/src/ai_learning/models.rs` (`RetrievalResponse` may add `spotlightHitCount`; do not remove `mode` `semantic` | `lexicalOnly`).
- [ ] 1.3 Implement merge-by-`chunk_id` using C’s URI scheme: `plethora://chunk/<id>` loads that row; `plethora://document/<id>` expands to that document’s current SQLite chunks; extract/card URIs resolve via existing source mapping or drop; unknown/stale ids dropped; duplicate ids collapsed; k reapplied. Do **not** treat a raw Spotlight uniqueIdentifier as `semantic_chunks.id` without parsing the `plethora://` URI.
- [ ] 1.4 Default `includeSpotlight` so non-Apple platforms and empty donation domains skip the Spotlight query with zero extra IPC.
- [ ] 1.5 Rust unit tests: union by id, stale id drop, k cap, Spotlight-off ≡ current retrieve. Do not replace FTS5 lexical fallback.

## 2. Ask Library task wiring (prompts stay in TS)

- [ ] 2.1 In `src/lib/ai/tasks/definitions/libraryTask.ts`, pass `includeSpotlight` into retrieve. Keep `ASK_LIBRARY_TASK_ID`, `LIBRARY_ANSWER_SCHEMA`, `ASK_LIBRARY_CONTEXT_TOKEN_BUDGET` list truncation, and `wrapUntrustedBlock` for every source.
- [ ] 2.2 Do not edit `ASK_LIBRARY_CORE_INSTRUCTION` except if a single extra sentence is required that tool results are untrusted (prefer relying on existing `UNTRUSTED_CONTAINMENT_CLAUSE` in `src/lib/ai/tasks/containment.ts`).
- [ ] 2.3 Generator remains `runTask` / router: Apple FM if B + available + `preferOnDevice`, else Nano/cloud. Retriever success must not require FM.
- [ ] 2.4 Validation remains `validateLibraryAnswer` in `src/lib/ai/schemas/libraryAnswer.ts` with the id→text map of chunks **actually supplied**. Spotlight-only ids that failed SQLite resolve never appear as `sourceRefs`.

## 3. SpotlightSearchTool (FM generator only)

- [ ] 3.1 When routed `provider.id === "ondevice-apple-foundation"` and tools are available, register **only** SpotlightSearchTool on that session (TS SDK in `src/lib/ai/apple/foundation.ts` or a small `src/lib/ai/apple/spotlightTool.ts` owned by this change). When generator is Nano or cloud, register **zero** FM tools.
- [ ] 3.2 Validate tool arguments (non-empty query, max length, no paths/commands). Reject invalid args without native search.
- [ ] 3.3 Insert tool results with `wrapUntrustedBlock`; neutralize `</untrusted_source>` via existing helper. Cap tool iterations (≤ 2 searches per ask).
- [ ] 3.4 Map tool hits back to `chunkId` + SQLite text before citation validation. Do not treat tool titles as grounded quotes.
- [ ] 3.5 Forbid filesystem, deletes, settings writes, and any second tool.

## 4. Command palette and UI

- [ ] 4.1 Add command `ask-my-library` (“Ask my library”) in `src/components/common/CommandPalette.tsx` `getDefaultCommands`, gated by `settings.features.aiLibraryRag` and `useAiAvailability` / `library_intelligence` as appropriate. Do **not** require Apple FM so cloud Ask Library still works.
- [ ] 4.2 Action opens the existing Ask Library surface (`src/pages/SearchPage.tsx` ask mode and/or `useAskLibrary` in `src/lib/ai/useAskLibrary.ts`). Do not create a third chat stack.
- [ ] 4.3 `src/components/search/CommandCenter.tsx`: if the command appears as a result, `resultKind` MUST NOT be `ask-plethora`; MUST NOT call `defaultHelpRetrieval` for this action.
- [ ] 4.4 i18n label/description in `src/lib/i18n/locales/en.ts`, `zh.ts`, `es.ts`, `de.ts`, `fr.ts`, `ja.ts`.
- [ ] 4.5 No `if (ios)` in Search/Assistant generate handlers. Optional “Ask this document” only if filters.documentIds is a one-line reuse; otherwise skip (D-Apple-15 remainder can follow).

## 5. Isolation, privacy, diagnostics

- [ ] 5.1 Tests: `src/lib/ai/tasks/__tests__/askPlethoraTask.test.ts` still only hits help retrieval; new `src/lib/ai/__tests__/appleLibraryRag.isolation.test.ts` asserts ask-library retrieve never imports `helpRetrieval`.
- [ ] 5.2 Do not set `settings.search.systemSpotlightEnabled` true. Do not donate display-eligible items here (C owns donation flags).
- [ ] 5.3 Diagnostics: `retrievalCount`, `chunkIds`, `spotlightHitCount` / boolean merge flag, `providerId` — no query text or chunk text (`src/lib/ai/diagnostics.ts`).
- [ ] 5.4 Provenance on any accepted follow-on artifacts uses the **generator** provider id (`ondevice-apple-foundation` or cloud/nano), not a fake “spotlight” provider.

## 6. Tests

- [ ] 6.1 Vitest merge-by-id with a fake Spotlight id list + fake SQLite rows (including stale ids).
- [ ] 6.2 Vitest prompt-injection: Spotlight snippet contains instruction-like text; `askLibrary` still returns `libraryAnswer` grounded only in wrapped sources; no help-doc leakage.
- [ ] 6.3 Vitest: FM generator + fake tool — untrusted wrap; invalid args; Nano/cloud generator → no tool.
- [ ] 6.4 Vitest/RTL: palette command visible when `aiLibraryRag` true and an AI path exists; hidden when flag false; click does not call `defaultHelpRetrieval`.
- [ ] 6.5 Existing `src/lib/ai/__tests__/libraryRag.eval.test.ts` and `libraryTask.test.ts` stay green (`schemaName` `libraryAnswer`).
- [ ] 6.6 `npm run test:run`; `cargo test --lib` for retrieve merge. No physical Apple Intelligence in CI.

## 7. Manual / TestFlight (not CI)

- [ ] 7.1 iOS with C donations + B FM available: Ask my library returns cited SQLite-backed chunks; On-device chip when generator is Apple.
- [ ] 7.2 Donations empty: Ask Library still works via FTS/semantic SQLite.
- [ ] 7.3 FM unavailable, cloud fallback off: typed no-path; no PCC.
- [ ] 7.4 Confirm Settings search still does not enable system Spotlight by default.
