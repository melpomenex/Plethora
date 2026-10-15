## Why

Incrementum's on-device AI today is a set of per-feature prompt adapters (explain, summarize,
simplify, Q&A, flashcard line-parsing) bolted onto the Gemini Nano bridge. It reacts when the
user asks; it never notices learning opportunities, never produces durable, validated learning
material, cannot answer from the whole library, and cannot assess understanding. The guiding
principle for this change: **Incrementum should notice learning opportunities and convert them
into durable knowledge with as little friction as possible** — while staying privacy-preserving,
offline-first, and on-device by default.

## What Changes

Delivered as one coherent AI Learning System built on shared infrastructure, sequenced in eight
phases so no phase is a "big bang":

- **Phase 0 — Task architecture.** Consolidate the scattered prompt adapters behind an
  `AITask`/`AIProvider` architecture in `src/lib/ai/`: capability-aware provider registry
  (on-device Gemini Nano primary; cloud providers explicit fallback), task router
  (fast/full/reasoning model classes), structured-output validation layer (wire the already
  declared ML Kit `genai-schema-compiler` for Kotlin-annotation schemas; strongly validated
  JSON fallback), unified `AIError` taxonomy, cancellation, dedupe, and extended diagnostics.
  Existing summarize/explain/Q&A features migrate onto it unchanged in behavior.
- **Phase 1 — Structured learning material ("Learn this").** Selection/section action that
  classifies knowledge type and proposes multi-type card candidates (Q/A, cloze, definition,
  comparison, enumeration, process, cause/effect, formula, example; occlusion where an image is
  involved) with preview/edit/accept/reject/regenerate and full provenance.
- **Phase 2 — AI image occlusion.** OCR-backed label detection (Android ML Kit Text Recognition
  v2 with bounding boxes; existing Rust OCR providers extended to expose `TextLine` boxes) +
  Gemini Nano semantic selection of educationally useful labels mapped back to deterministic
  geometry. Vision input is wired natively (currently the Kotlin gate rejects images).
  Free-form vision-only occlusion is explicitly experimental/flagged off by default.
- **Phase 3 — Semantic memory.** Local embedding provider abstraction with an on-device
  EmbeddingGemma 300M backend via LiteRT (cloud/Ollama providers remain for desktop);
  semantic chunking with full source-location metadata (EPUB CFI, PDF page, offsets, heading
  path); incremental background indexing into an extend version of the existing
  `document_chunk_embeddings` store; retrieval API with reranking; grounded library RAG
  ("Ask library") with source references that navigate back into documents.
- **Phase 4 — Active learning.** Optional active-recall prompts while reading (Off/Low/Adaptive/
  Intensive) with interruption budgets, question fingerprints to avoid repeats, and
  free-response answer assessment (correctness/completeness/misconception/missing concepts) —
  the scheduler stays authoritative; assessment is signal + UI only.
- **Phase 5 — Knowledge relationships.** Prerequisite detection with evidence-based coverage
  estimates ("cards cover 3 of 4 prerequisites"), typed concept links with confidence +
  provenance (users can inspect/remove), and passage extract-worthiness scoring surfaced
  unobtrusively.
- **Phase 6 — Socratic tutoring.** Guided-question tutoring sessions grounded in current
  material and retrieved prerequisites, progressive hints, "just explain it" escape hatch,
  reasoning-model routing when available, and conversion of tutoring outcomes into cards.
- **Phase 7 — Constrained learning agent.** Read-only tools first, then proposal tools, then
  user-confirmed writes. Strict tool schemas, bounded iterations/calls/proposals,
  prompt-injection containment (document text is untrusted data), execution tracing.

Cross-cutting: feature flags (`aiTaskArchitecture`, `aiLearnThis`, `aiOcclusionAssist`,
`aiSemanticIndex`, `aiLibraryRag`, `aiActiveRecall`, `aiAnswerAssessment`, `aiPrerequisites`,
`aiConceptLinks`, `aiExtractWorthiness`, `aiSocraticTutor`, `aiAgent` — exact ids per project
`FeatureFlags` convention), privacy indicators (on-device/offline/download/cloud badges),
domain-level AI errors with graceful degradation, benchmark + budget gates, and evaluation
fixtures for every AI task.

## Capabilities

### New Capabilities
- `ai-task-architecture`: Provider/task abstraction, capability detection, model-class routing,
  structured-output validation, error taxonomy, cancellation, prompt registry, diagnostics,
  prompt-injection containment rules shared by all AI features.
- `ai-learning-material-generation`: "Learn this" analysis, knowledge-type classification,
  multi-type card candidate generation, preview/edit/accept flow, provenance.
- `ai-image-occlusion`: OCR label detection with geometry, AI educational-label selection,
  occlusion card generation from images, coordinate normalization rules.
- `ai-semantic-index`: Chunking, embedding providers (incl. on-device EmbeddingGemma), metadata
  persistence, incremental indexing/invalidation/reindexing, vector retrieval API, index state.
- `ai-library-rag`: Library-wide grounded Q&A, retrieval-grounded answer generation, source
  references with navigation, decisions about what is durably indexed.
- `ai-active-recall`: Reading-mode recall question generation, adaptive interruption policy,
  question fingerprints/dedup, promote-question-to-card.
- `ai-answer-assessment`: Free-response grading signals, misconception detection, review-flow
  integration boundary (scheduler authority preserved), calibration fixtures.
- `ai-knowledge-relationships`: Prerequisite inference, coverage estimation language and
  evidence model, typed concept links with provenance, extract-worthiness scoring.
- `ai-socratic-tutoring`: Tutoring sessions, progressive hints, stuck detection, grounding,
  task-policy routing, output-to-card conversion.
- `ai-learning-agent`: Constrained tool layer, tool schemas and validation, execution bounds,
  injection defenses, proposal/approval workflow, execution tracing.

### Modified Capabilities
- `flashcard-review-session`: Optionally accepts a free-response answer before grading and may
  display AI-derived assessment feedback; scheduling semantics and grade buttons unchanged.

## Impact

- **Kotlin plugin** `src-tauri/plugins/android-genai/`: wire native image input, ML Kit
  structured-output schemas, embedding backend plugin (new `android-embeddings` plugin or a
  module of android-genai), ML Kit Text Recognition dependency.
- **Rust** `src-tauri/`: new ai-learning module (task contracts, validation, provenance),
  semantic-index commands (extend `commands/rag.rs`/`vector_store.rs`), OCR bbox surface
  (`commands/ocr.rs`), migrations added to the in-code `MIGRATIONS` registry (chunks metadata,
  concept links, provenance, recall history, index state), background indexing workers
  (tokio, following transcription job-queue patterns), agent tool registry.
- **Frontend** `src/lib/ai/`: task/provider architecture refactor (existing adapters become
  tasks), new feature UI (Learn This sheet, occlusion assist, recall prompts, assessment panel,
  tutor view, library ask), settings + feature flags, i18n keys in all six locales.
- **Existing behavior preserved**: current passage/extract/studio AI actions keep working
  through the new task layer; Gemini Nano remains the default Android generative backend;
  desktop keeps platform-unsupported stubs plus optional cloud/Ollama paths.
- **Dependencies**: ML Kit text-recognition (new), LiteRT + EmbeddingGemma 300M model artifact
  (downloaded/bundled per size), no removals.
- **Performance gates**: every phase adds `*.bench.ts` suites and/or budget entries per the
  `scripts/perf-baselines.json` protocol; indexing/embedding/OCR/inference latency tracked in
  `diagnostics.ts`.
