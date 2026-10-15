## Why

Plethora currently includes a rudimentary automatic tagging mechanism that assigns incorrect and misleading tags to imported items. In particular, documents with no relationship to mathematics frequently receive a `math` tag, software engineering documents receive `history` tags because "software" contains the substring "war", and general prose receives `biology` or `language` tags due to un-tokenized substring matches on words like "cell" or "sentence". Furthermore, every single imported document receives a hardcoded `"auto-tagged"` label regardless of content.

This legacy heuristic undermines user trust in library organization. We are replacing this broken mechanism with **Smart Tagging**: a robust, quiet personal knowledge librarian that automatically organizes imported documents and items into meaningful semantic topics.

**Smart Tagging is ON by default and works completely offline without an LLM or API keys.** When a user configures a local or cloud LLM, Smart Tagging seamlessly enhances topic precision and nuance using structured schema generation without ever compromising privacy or making AI availability a prerequisite for document ingestion.

## What Changes

- **Eliminate Legacy Faulty Heuristics**: Remove the un-tokenized substring matching logic in `src-tauri/src/commands/document.rs` (`suggest_auto_tags`) and `src/lib/browser-backend.ts` (`suggestAutoTags`), as well as the unconditional `"auto-tagged"` junk tag.
- **Tier 1 Baseline Smart Tagger (Local / Zero-LLM)**: Implement a fast, deterministic, statistical keyword and domain-signature classifier that extracts candidate topics from document metadata (title, headings, author, domain, structured metadata) and representative content chunks using tokenization, stopword filtering, TF-IDF/BM25 term-frequency scoring, and domain co-occurrence evidence thresholds.
- **Tier 2 LLM-Enhanced Refinement**: When an LLM provider is configured and available (local Ollama, Android on-device Gemini Nano, or user-selected cloud model), pass representative document summaries and retrieved candidate tags into a strongly validated structured task (`SmartTaggingTask` in `src/lib/ai/tasks/definitions/smartTaggingTask.ts`) to refine semantic subjects and disambiguate nuanced themes.
- **Prefer Existing User Taxonomy**: Retrieve relevant candidate tags from the user's existing library before proposing new ones; prevent synonym proliferation (e.g. `Machine Learning` vs `AI / ML`) by mapping incoming concepts to existing tag clusters.
- **Semantic Duplicate Detection & Normalization**: Canonicalize proposed tags against existing tags using case-insensitive matching, singular/plural normalization, and hyphenation normalization.
- **Strict Confidence Gating**: Distinguish between high confidence (automatically applied) and low confidence (rejected). If insufficient evidence exists, assign **no semantic tag** rather than inventing a false positive.
- **Asynchronous Ingestion Integration**: Run Smart Tagging in a non-blocking background task post-import across all document types (PDFs, EPUBs, web articles, YouTube transcripts, X/Twitter threads, audio/podcasts, and manual notes). Import is never held hostage by AI inference.
- **Manual Authority & Provenance**: User-assigned tags are authoritative and never deleted or renamed by automation. Track tag provenance (`manual`, `smart-local`, `smart-llm`) in document metadata.
- **Explainability**: Store compact, application-level classification reasons (e.g., `"Primary subject based on high TF-IDF term density and matching TOC headings"`) visible in the tag inspector.
- **Command Palette & UI Actions**: Provide `Tag this document`, `Retag this document`, `Tag untagged documents`, and `Suggest tag merges` in the Command Palette and Documents UI.
- **Safe Migration Policy**: Upgrade existing user databases without destructively rewriting historical tags; offer an explicit user-initiated command to clean up legacy `"auto-tagged"` markers and reanalyze bad assignments.

## Capabilities

### New Capabilities
- `smart-tagging-core`: Two-tier classification engine (Tier 1 statistical baseline + Tier 2 LLM refinement) with tokenized keyword extraction, TF-IDF/BM25 scoring, candidate tag retrieval, strict confidence thresholds, and false-positive prevention.
- `tag-taxonomy-management`: Existing taxonomy preference, semantic duplicate detection, canonicalization, provenance tracking (`manual`, `smart-local`, `smart-llm`), explainability storage, and non-destructive user tag authority.
- `smart-tagging-integration`: Background asynchronous post-ingestion tagging across all media formats (PDF, EPUB, Web, X, YouTube, Audio), Command Palette commands, Settings UI controls, and safe library maintenance/retag workflows.

### Modified Capabilities
- `contextual-palette-actions`: Add document-level and library-level Smart Tagging actions (`Retag this document`, `Tag untagged documents`) to the contextual command palette registry.

## Impact

- **Backend (Rust)**:
  - Remove `suggest_auto_tags` from `src-tauri/src/commands/document.rs`.
  - Add native Tier 1 statistical keyword extraction and candidate scoring module in `src-tauri/src/ai/smart_tagging/`.
  - Add Tauri commands: `smart_tag_document`, `retag_document`, `get_tag_candidates`, `batch_tag_untagged_documents`.
  - Add migration `102_add_smart_tag_provenance` (or update `documents.metadata` schema) to store tag provenance and explainability reasons.
- **Frontend (TypeScript/React)**:
  - Remove `suggestAutoTags` from `src/lib/browser-backend.ts`.
  - Implement Tier 1 TS fallback in `src/lib/smartTagging/` for web/PWA mode.
  - Implement `SmartTaggingTask` in `src/lib/ai/tasks/definitions/smartTaggingTask.ts` using `AITaskDefinition`, strict Zod schema validation, JSON repair salvage, and prompt injection containment `<untrusted_source>`.
  - Update `src/stores/documentStore.ts` to trigger asynchronous Smart Tagging after document creation/update.
  - Add Smart Tagging settings in `src/types/settings.ts`, `src/stores/settingsStore.ts`, and `src/components/settings/DocumentsSettings.tsx`.
  - Update `src/components/common/CommandPalette.tsx` and `src/commandPalette/contextualActions.ts` with Smart Tagging actions.
  - Add tag provenance badge/popover in `src/lib/tagEditing/` and `src/components/documents/`.
- **Dependencies**: No heavyweight ML dependencies introduced. Reuses existing tokenizers, SQLite indexing, and Plethora AI provider abstractions.
