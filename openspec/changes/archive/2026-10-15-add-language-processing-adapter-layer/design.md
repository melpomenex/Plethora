## Context

The repository has `Intl.Segmenter`-style selection intent, transcript segment/word timing, EPUB/PDF/text anchors, and local/cloud transcription providers, but no shared linguistic analysis model. Processing must run off the render path and support scripts without whitespace boundaries.

## Dependencies

- Hard dependencies: none for the contract; it may consume profile language tags from #1 when available.
- Downstream hard consumers: #3 lexicon, #5 highlighting, #7 translation, #8 sentence mode, #10 coverage, and #16 reading assist.
- The adapter/capability/span/version contracts must be frozen before those changes implement parallel consumers.

## Goals / Non-Goals

**Goals:**

- Make a deterministic, serializable analysis result the shared input to lexical accounting and reader annotations.
- Declare per-language/provider capabilities instead of inventing missing lemmas or morphology.
- Support large documents incrementally, cache by content/language/provider/version, and recover from provider failure.

**Non-Goals:**

- Shipping a perfect morphological analyzer for every language in the first implementation.
- Embedding provider-specific code in EPUB/PDF/HTML components.
- Replacing transcription, dictionary, or translation providers; this is their common language-analysis contract.

## Decisions

1. **Span-first intermediate representation.** Store UTF-16/Unicode-safe source offsets, sentence IDs, token IDs, and normalized text; downstream models reference spans rather than copying passages.
2. **Capability manifest.** Each adapter declares `detect`, `sentenceSegment`, `tokenize`, `lemma`, `morphology`, `pos`, `phraseCandidates`, `transliteration`, and `script` capabilities plus supported tags. Missing capability yields `unknown`, never a guessed value.
3. **Versioned deterministic fingerprints.** Results are keyed by content hash, language tag, adapter/provider ID, adapter version, and configuration fingerprint. Reprocessing creates a new version and leaves old results addressable until consumers migrate.
4. **Background chunked execution.** Process documents/transcripts in bounded chunks via the existing worker/job patterns, persist checkpoints and errors, and publish only compact summaries to reactive state.
5. **Local-first with explicit cloud fallback.** A local adapter may satisfy core tokenization; cloud/AI processing is opt-in and receives the minimum text required for the requested chunk.

## Risks / Trade-offs

- [Model output may change token boundaries] → Keep source spans and analysis version; invalidate only projections tied to the stale version.
- [CJK/RTL/emoji offsets are error-prone] → Centralize offset utilities and add Unicode/RTL fixtures before reader integration.
- [Large analysis results can bloat SQLite] → Store normalized token tables only where needed, deduplicate strings, compress optional JSON, and page APIs.
- [Provider unavailable] → Exact-form fallback continues reading and manual state management; UI shows capability limitations.

## Migration Plan

1. Ship interfaces, capability registry, fallback processor, and no-op integration.
2. Add cache/job tables and process newly opened content lazily.
3. Backfill on demand; never block document open.
4. Re-run affected projections after adapter-version changes and garbage-collect unreferenced old versions later.

## Open Questions

- Which bundled tokenizer/morphology libraries fit the Tauri desktop and Android size budgets.
- Whether cloud processing should be per-provider or mediated by the existing AI provider registry.
- How much token-level data should be included in user backup versus regenerated.
