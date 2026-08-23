## Why

Ask my library and Ask this document already exist (`libraryTask`, `useAskLibrary`, `LibraryAnswer` grounding). Android should not get a separate RAG product. This change **composes** independently selectable retrievers and generators so AppSearch+Nano, SQLite+Nano, SQLite+cloud, etc. are configuration, not forks.

## Existing behavior

- Retrieval: `ai_learning` FTS5 ∪ cosine.
- Generation: `runTask` ask-library with untrusted chunks and citation validation.
- Help docs: `askPlethoraTask` — separate corpus.

## What Changes

- Formalize `RagComposition` from A: `retrieverId` (`ai_learning` | `appsearch-hybrid` | `document-only`) × generator (`ondevice` | `cloud` | `none`).
- Ask this document = retrieve with document id filter (already possible) + generator.
- Command palette: “Ask my library” / “Ask this document” / “Find related” — no vendor names.
- Grounded answers keep `LibraryAnswer` + navigation locators.
- Generator may be unavailable (no Nano, no key): retrieval-only results still show sources.
- Foreground: generation pauses/fails with `ForegroundRequired`; retrieval may finish.

## Capabilities

### Modified Capabilities
- `ai-library-rag`: composition, retrieval-only mode, namespace isolation from help.

## Non-goals

- Implementing AppSearch (C) or Nano (B).
- Mixing help docs with the user library.

## Dependencies

A required. B and C optional at runtime; D must work with fakes.

## Expected ownership

**Agent D** owns `libraryTask.ts`, `useAskLibrary.ts`, composition wiring. Not `plethora-android-genai` or AppSearch schema.
