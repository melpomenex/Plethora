## Why

Ask Library already exists: `retrieveFromLibrary` (`src/api/ai-learning.ts` → Rust `ai_learning_retrieve`) then `runTask` on `ask-library` (`src/lib/ai/tasks/definitions/libraryTask.ts`) with `libraryAnswer` validation and citation grounding. Help **Ask Plethora** is a **separate** in-memory product-docs index (`src/features/help/helpRetrieval.ts`, `askPlethoraTask.ts`). Binding D-Apple-7: retriever ⊥ generator; D-Apple-6/8: Spotlight is derived, opt-in for system display, and `SpotlightSearchTool` is the only FM tool if used.

iOS users still cannot (a) merge Apple Spotlight semantic candidates into library retrieval by stable chunk id, (b) generate answers with Apple FM when B is present, or (c) invoke Ask Library from the command palette without colliding with Ask Plethora. This change wires those seams **without** rewriting the RAG stack.

## What Changes

- Extend `retrieveFromLibrary` / `ai_learning_retrieve` with an **optional** Spotlight candidate source (change C’s donations). Merge by `semantic_chunks.id` / `SearchResult.chunkId`. SQLite semantic + FTS5 lexical remain the default path.
- Keep generation on the existing `ask-library` task and router (Nano / Apple FM / cloud independently from the retriever).
- If the generator is Apple FM **and** FM tool calling is enabled, attach **only** `SpotlightSearchTool`: read-only, argument-validated, results wrapped as `<untrusted_source>` via `src/lib/ai/tasks/containment.ts`. No filesystem, deletes, or settings writes.
- Add command palette command **Ask my library** (capability-gated), opening the existing Ask Library surface (`useAskLibrary` / `SearchPage` ask mode / assistant). Must not merge with `resultKind: "ask-plethora"` in `CommandCenter.tsx`.
- Grounded citations continue to use `src/lib/ai/schemas/libraryAnswer.ts` (quotes verified against retrieved text; fabricated refs dropped).
- Prompt-injection: Spotlight hits and library chunks are untrusted. Help index is never a retrieval source for this path.
- Feature remains behind `settings.features.aiLibraryRag`. System-wide Spotlight display stays opt-in `settings.search.systemSpotlightEnabled` default **false** (C/A); this change does not turn it on.

## Capabilities

### New Capabilities

- `apple-library-rag`: Apple-path Ask Library wiring — optional Spotlight merge in `retrieveFromLibrary`, independent Apple FM (or cloud/Nano) generation, palette command, SpotlightSearchTool containment, citation/help-index isolation.

### Modified Capabilities

- `ai-library-rag`: Retrieval MAY include Spotlight candidates merged by chunk id; generator MAY be `ondevice-apple-foundation`; command palette gains Ask my library; help Ask Plethora remains a different index.
- `apple-foundation-models` (soft): When B is present, Ask Library may set `toolCalling` usage for SpotlightSearchTool only; B may have shipped `toolCalling: false` until this change enables the tool on FM sessions.

## Impact

- **TS retrieval:** `src/api/ai-learning.ts` `retrieveFromLibrary` options; `src/lib/ai/tasks/definitions/libraryTask.ts` `askLibrary()` (retrieve injection only — **do not rewrite prompts** except wrapping tool results).
- **Rust:** additive optional Spotlight probe/merge in `src-tauri/src/commands/ai_learning.rs` / `src-tauri/src/ai_learning/` — call C’s donation lookup by id; no new canonical store.
- **Palette:** `src/components/common/CommandPalette.tsx` `getDefaultCommands`; `src/components/search/CommandCenter.tsx` command results — **not** help retrieval.
- **Hooks/UI:** `src/lib/ai/useAskLibrary.ts`, `src/pages/SearchPage.tsx` (reuse ask mode), possibly `src/components/assistant/AssistantPanel.tsx` entry — capability gated.
- **i18n:** command label/description in all six locales.
- **Tests:** merge-by-id, help-index isolation, tool untrusted wrapping, palette gating, FakeAppleFoundationProvider + fake retriever.

## Owns

- Retriever merge (SQLite ± Spotlight) and Ask Library wiring to optional Apple FM generator.
- Command palette **Ask my library**.
- SpotlightSearchTool session policy (read-only, untrusted results) when the generator is FM.
- Tests proving help Ask Plethora index is not queried.

## Must NOT change

- `src/features/help/helpRetrieval.ts` corpus, `askPlethoraTask.ts` prompts, or CommandCenter help ranking **except** adding a separate command that must not share `resultKind: "ask-plethora"`.
- Canonical SQLite schema for `semantic_chunks` (C owns donations; this change only **reads** ids).
- Foundation Models Swift prompts / `@Generable` libraryAnswer (B owns); this change **uses** `schemaName: libraryAnswer`.
- `src/lib/ai/providers/index.ts` routing order (A).
- System Spotlight eligibility default (must remain false; D-Apple-6).
- Whole RAG rewrite (no new vector DB, no replacing FTS5, no dropping lexical fallback).
- Agent write tools, filesystem tools, or additional FM tools beyond Spotlight search.

## Dependencies

- **Hard:** `extend-ai-capability-routing-for-apple` (A) — errors, capabilities, plugin crate, fakes.
- **Hard:** `add-apple-spotlight-semantic-index` (C) — rebuildable Spotlight donations with 1:1 Plethora ids (`semantic_chunks.id`, `documents.id`). Without C, Spotlight merge is a no-op and SQLite retrieval still works.
- **Soft:** `add-apple-foundation-models-provider` (B) — on-device generator + optional `SpotlightSearchTool`. Without B, Ask Library still runs with cloud (if allowed) or reports no generator; retrieval-only improvements from C can still land.
- **Soft:** existing `ai-library-rag` / `libraryTask.ts` / `libraryAnswer.ts` (already in tree).

## Parallelization Notes

- Do not start before A. Prefer C before claiming Spotlight merge in production; implementation can feature-detect empty Spotlight and skip.
- Coordinate with B on `toolCalling` / tool-argument DTO only; do not edit `FoundationModelsBridge.swift` product prompts.
- Coordinate with C on id URI format; do not edit indexer donation text.
- Palette file `CommandPalette.tsx` / `CommandCenter.tsx` also used by other features — add one command with `capabilityId`, do not restyle the palette.

## Migration / Backward Compatibility

- Android/desktop: `retrieveFromLibrary` without Spotlight behaves as today (semantic or `lexicalOnly`).
- iOS without donations: identical to current Ask Library (FTS/embeddings).
- iOS with C donations: extra candidates merged by id; scores may change but citations still verify quotes.
- `aiLibraryRag` flag unchanged. No reindex required beyond C’s Spotlight projector.
- Ask Plethora command and help search unchanged.

## Risks

- Merging help and library indexes would leak product docs into personal answers or personal notes into help — **forbidden**; tests must lock this.
- SpotlightSearchTool without untrusted wrapping enables prompt injection from donated snippets.
- Tool calling that can write/delete would violate D-Apple-8.
- Turning on system Spotlight display would leak private library (C/A setting; this change must not default it true).
- Duplicate Ask UIs confusing users — palette command must land on the **same** `useAskLibrary` state machine, not a third chat.
- Over-fetching Spotlight + SQLite blowing Apple FM context — keep existing `ASK_LIBRARY_CONTEXT_TOKEN_BUDGET` truncation in `libraryTask.ts`.
