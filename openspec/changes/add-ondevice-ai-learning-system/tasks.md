## 1. Phase 0 — Foundation: provider/task architecture

- [x] 1.1 Create `src/lib/ai/providers/types.ts` with `AIProvider`, `AIModelCapabilities`,
  `AIRequest`, `AIResponse`, `AIUsageMetadata` per design D1–D2; implement
  `OnDeviceProvider` wrapping `onDeviceAI.ts` and `CloudProvider` wrapping `src/api/llm` +
  `src/api/ai.ts`; unit-test capability mapping from `OnDeviceCapabilitySnapshot`.
- [x] 1.2 Create `src/lib/ai/errors.ts` with the unified `AIError` taxonomy (design D6),
  mapping functions from `OnDeviceAiError` codes and cloud/LLM failures; unit tests for every
  category and the cancelled-never-falls-back rule.
- [x] 1.3 Create `src/lib/ai/tasks/` infrastructure: `AITaskDefinition` type, `runTask()`
  with provider resolution, capability gate, token budgeting (reuse `chunkTextByTokens` +
  `budgetNativePromptRequest`), streaming, validation hook, diagnostics emission, and
  in-flight coalescing keyed by `taskId+targetId` (design D4, D7).
- [x] 1.4 Implement the task router with `modelClass` fast/full/reasoning and
  `reasoningFallback` resolution (design D3); unit tests for each routing branch.
- [x] 1.5 Create `src/lib/ai/schemas/` with canonical structured types + hand-written
  validators (cardValidator.ts style): `LearningMaterialProposal`, `AnswerAssessment`,
  `RecallQuestionProposal`, `OcclusionLabelSelection`, `PrerequisiteAnalysis`,
  `PassageClassification`, `TutorTurn`; unit tests including adversarial/malformed payloads.
- [x] 1.6 Implement the strict-JSON fallback mode in `runTask`: JSON prompt mode → parse →
  validate → single repair retry with validation error appended → else
  `InvalidStructuredOutput` (design D5); tests for repair-success and fail-closed paths.
- [x] 1.7 Add untrusted-content containment helpers (`wrapUntrustedBlock`, delimiter
  constants) and require their use in task inputs; add the containment clause to all static
  system instructions (design D9); tests asserting document text cannot appear outside
  untrusted blocks in built prompts.
- [x] 1.8 Refactor `passageAI.ts`, `extractAI.ts`, `flashcardStudioAI.ts`, `imageAI.ts` to
  task definitions behind their existing exported function signatures; keep
  `runAiAction`-based cloud fallback behavior; all existing tests in `src/lib/ai/__tests__/`
  stay green.
- [x] 1.9 Use static `systemInstruction`/`promptPrefix` for every task (KV-cache reuse per
  `optimize-ondevice-gemini-nano` findings); verify `warmUpOnDevicePrompt` still fires on
  selection-sheet open.
- [x] 1.10 Kotlin: define `@Schema`-annotated data classes for the D5 envelopes in
  `AndroidGenAiPlugin.kt` (or a schemas file), wire `outputMode`-mapped structured requests
  through `genai-schema-compiler`, and serialize returned objects into
  `NativePromptResponse.structured`; extend `PromptContractTest.kt` for the schema path and
  the graceful `feature_not_compiled` fallback.
- [x] 1.11 Rust/Kotlin/TS: keep the error-code contract in sync for any new codes; update
  `mapGenAiErrorCode` and `OnDeviceAiError` if needed; contract tests on both sides.
- [x] 1.12 Add cloud stream cancellation: `llm_cancel_stream` command + request registry in
  `commands/llm.rs` (model on `StreamRequestRegistry`); wire `CloudProvider.cancel`; test
  that cancelled streams emit no further chunks.
- [x] 1.13 Extend `diagnostics.ts` with task id, modelClass, capability hash, retrieval
  count/chunk ids, validation outcome, fallback path fields (design D8); keep the
  no-user-content rule; update diagnostics tests; add the settings debug panel entry point.
- [x] 1.14 Add feature flags to `FeatureFlags` in `settingsStore.ts` for every phase
  (`aiLearnThis`, `aiOcclusionAssist`, `aiOcclusionFreeform` (default false),
  `aiSemanticIndex`, `aiLibraryRag`, `aiActiveRecall`, `aiAnswerAssessment`,
  `aiAutoGradeSuggest` (default false), `aiPrerequisites`, `aiConceptLinks`,
  `aiExtractWorthiness`, `aiSocraticTutor`, `aiAgent` — all default false except where a
  phase says otherwise); unit tests for defaults.
- [x] 1.15 Regression gate: port the `optimize-ondevice-gemini-nano` spec scenarios into
  `src/lib/ai/__tests__/` assertions (adaptive context, streaming summarize, output caps,
  warmup) and run `npm run test:run`, `npm run bench:check`, `cargo test --lib`, and the
  Android plugin unit tests (`./gradlew :android-genai:test` or repo equivalent).

## 2. Phase 1 — Learn this: structured learning material

- [x] 2.1 Implement `LearnThisTask` (full model class, structured output) producing
  `LearningMaterialProposal` with knowledge-type classification and typed card candidates per
  the spec's mapping table; include validation caps (≤ 8 cards, ≤ 2 per concept) in
  `schemas/` validators.
- [x] 2.2 Implement candidate validation pipeline: verbatim cloze check
  (`extractClozeDeletion`), answer grounding (`checkAnswerGrounding`), self-dedup
  (`deduplicateOnDeviceCards`), existing-item duplicate check via
  `check_semantic_duplicate_candidates`.
- [x] 2.3 Add the "Learn this" action to `SelectionActionsSheet` (mobile) and desktop context
  menus in `DocumentViewer.tsx`/viewer context menus, capability-gated via
  `useAiAvailability`.
- [x] 2.4 Build the proposal preview UI (sheet/modal reusing Flashcard Studio card-editing
  patterns): per-candidate accept/reject, edit fields, card-type switcher, regenerate,
  importance/concepts/rationale display, provenance summary.
- [x] 2.5 Wire acceptance to existing domain services: `create_learning_item(s)_batch`,
  `create_cloze_from_extract` (extract created first when the selection has no extract), and
  occlusion hand-off to Phase 2's composer; verify `document_id`/`extract_id` linkage.
- [x] 2.6 Rust: add migration (next id in `src-tauri/src/database/migrations.rs`
  `MIGRATIONS`) creating `ai_provenance`; record provenance (source location via
  `selection_context` payload, provider/model/model_class, timestamp, input fingerprint) on
  acceptance; add `get_ai_provenance(target_kind, target_id)` command + TS wrapper; Rust
  tests for the migration and round-trip.
- [x] 2.7 i18n: add keys for all Learn-this strings in `src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts`;
  update locale type checks/tests.
- [x] 2.8 Evaluation fixtures: `src/lib/ai/__fixtures__/eval/learn-this/` with labeled cases
  (definition/enumeration/process/comparison/formula/cause-effect/diagram passages) replayed
  through a `FakeAIProvider`; assert structural semantics (card types, grounding verdicts,
  caps), not prose.
- [x] 2.9 Enable `aiLearnThis` flag path end-to-end on Android (dogfood), verify latency
  budget (≤ 20 s) in diagnostics, and run full test/bench gates.

## 3. Phase 2 — AI image occlusion (OCR-backed)

- [x] 3.1 Kotlin: implement the native image input path in `buildPromptRequest`
  (`ImagePart` + `TextPart`, MIME check, ≤ 5 MB) gated on `imagePrompt` capability; extend
  `PromptContractTest.kt` for image payloads (bitmap fixture) and `invalid_image` errors.
- [x] 3.2 Add ML Kit Text Recognition v2 dependency to the android-genai plugin gradle;
  implement `ocrImage(base64, {maxResults})` returning labels with normalized percent boxes
  (pixel bbox / image dims → percent, clamped), confidence, and text; Kotlin unit tests for
  normalization math; capability flag `ocr` in the capability snapshot.
- [x] 3.3 Rust: extend `OCRResponse` in `commands/ocr.rs` and `ocr/providers.rs` with optional
  `lines[] {text, confidence, bboxPercent}` (normalize where provider supplies pixel boxes);
  keep existing consumers compatible; Rust tests for the extended response shape.
- [x] 3.4 Implement source-image extraction paths: PDF figure region/page render via
  `extract_page_images_data_urls` / pdf.js render; EPUB images via media-server stream;
  imported images via image registry (`ingest_image_asset` where needed); shared helper
  producing `{imageAssetId|bitmap, sourceWidth, sourceHeight, sourceKind}`.
- [x] 3.5 Implement `OcclusionLabelSelectionTask` (vision, full class): input = OCR labels
  with ids/normalized boxes + document context (untrusted blocks); output =
  `OcclusionLabelSelection { appropriate, selections[] {labelIds[], question, answer},
    rejected[] {labelId, reason} }`; validate that every `labelId` references a real OCR id
  and that no geometry is accepted from the model.
- [x] 3.6 Build the occlusion assist preview in the occlusion composer flow
  (`OcclusionComposerHost`/composer UI): detected labels list, proposed cards with region
  highlights on the image, per-card accept/edit (drag/resize via existing
  `utils/occlusion.ts`), grouping edits, save through `create_learning_items_batch` with
  `interaction_metadata.imageOcclusionRegions` (percent) + `image_asset_ids`.
- [x] 3.7 Handle edge cases per spec: tiny/dense labels (min size filter), non-educational
  label rejection, OCR failure → `OCRFailed` with manual composer fallback, source-image
  change (sha256 mismatch) → invalidate proposals; tests for each.
- [x] 3.8 Implement `aiOcclusionFreeform` experimental path (off by default, labeled
  low-precision): vision-proposed regions only when OCR yields no labels, marked distinctly
  in the preview; tests assert the flag gate.
- [x] 3.9 Store occlusion provenance (`ai_provenance` with image asset ref) on save; add
  evaluation fixtures for occlusion selection (labeled/dense/non-educational/OCR-failure)
  with a fake vision provider; i18n keys for all occlusion-assist strings.
- [x] 3.10 Verify on Android: end-to-end occlusion generation from a PDF figure and an EPUB
  image, review-time rendering at zoom, and the OCR latency budget (≤ 3 s/figure) in
  diagnostics.

## 4. Phase 3 — Semantic memory: indexing and retrieval

- [x] 4.1 Rust: add migration creating `semantic_chunks`, `semantic_chunk_embeddings`,
  `ai_index_state`, plus defensive `CREATE TABLE IF NOT EXISTS` for `queue_item_embeddings`
  (legacy-DDL fix); one-time data migration folding `document_chunk_embeddings` into the new
  tables then dropping the old table; migration tests.
- [x] 4.2 Implement `src-tauri/src/ai_learning/chunker.rs` (heading-aware recursive
  paragraph→sentence splitter, 700–900 char target, one-sentence overlap, atomic-paragraph
  rule) with location builders per source type: EPUB CFI ranges (reuse selection-context CFI
  machinery), PDF per-page text (extend `processor/pdf.rs` for page-scoped extraction),
  HTML/markdown/text offsets; Rust unit tests for every source type incl. heading paths and
  ordinals.
- [x] 4.3 Implement the indexing worker (`ai_learning/indexer.rs`) on the transcription
  `job_queue.rs` pattern: per-document enqueue on content-hash change, per-chunk commits,
  interruption-safe resume, deletion cascade, `ai_index_state` transitions, error capture;
  pause/resume/cancel commands (`ai_learning_index_pause` etc.); foreground/battery
  constraints with bulk-backfill only while charging option; Rust tests for lifecycle and
  interruption.
- [x] 4.4 Embedding provider abstraction in Rust: extend the existing `EmbeddingProvider`
  trait usage with a new `EmbeddingBackend` registry (on-device | ollama | cloud-explicit),
  persisted model/version on every vector, and `embedding_version` invalidation/reindex
  logic; tests for versioned reindex marking.
- [x] 4.5 Kotlin: implement the on-device embedding backend — LiteRT + EmbeddingGemma 300M
  (int8 `.litert`, downloaded on explicit action to app-data, sha256-verified, progress
  events) — as `embedTexts(texts)` commands in the android-genai plugin (register in
  `commands` mod, permissions, desktop stubs returning `platform_unsupported`); capability
  + download-state surfaced in `OnDeviceCapabilitySnapshot`; Kotlin tests with a fake
  inference session.
- [x] 4.6 Implement retrieval: `ai_learning_retrieve(query, k, filters)` combining FTS5
  lexical prefilter (top ~200 via `document_search`/`extract_search`) with cosine top-k over
  stored vectors (extend `vector_store.rs` bounded-heap pattern), returning metadata + mode
  indicator (`semantic|lexicalOnly`); chunk-neighborhood dedup; Rust tests incl. 10k-vector
  fixture.
- [x] 4.7 Index additional sources: extracts, notes, annotations, card question sides become
  single chunks with their own location payloads through the same pipeline; deletion sync
  when their rows change.
- [x] 4.8 Indexing UI: settings panel section (per-document + aggregate state, storage usage,
  embedding provider + download state, pause/resume/reset via `ai_learning_reset_index`);
  status events via `tauri::ipc::Channel` or global events following the transcription
  pattern; i18n keys.
- [x] 4.9 Implement `AskLibraryTask` (full class): `retrieve()` → diversity-dedup → cited
  untrusted blocks → grounded answer + `sourceRefs[]`; honest no-evidence/conflicting-source
  behavior per spec; navigation wiring for refs (PDF page/EPUB CFI/extract/card/note) reusing
  existing viewer jump paths.
- [x] 4.10 Build the "Ask library" UI (entry in search page + viewer/selection action +
  assistant surfaces), capability/offline badge (on-device vs cloud indicator), and
  on-device-only enforcement when `settings.ai` requires it.
- [x] 4.11 Benchmarks + budgets: add `src/lib/ai/ai_learning.bench.ts` (or Rust bench
  equivalents) for chunker throughput, cosine search @10k/100k synthetic vectors (seeded
  PRNG per `bench-support.ts`), and register baselines in `scripts/perf-baselines.json`;
  add an index-storage-per-source-MB check to the memory lane; verify retrieval p95 ≤ 300 ms
  @100k gate on the fixture.
- [x] 4.12 Evaluation fixtures for RAG (relevant/irrelevant/answerable/unanswerable/
  multi-doc/conflicting + citation payloads) through the fake provider; run full gates and
  Android dogfood (index a real library, verify offline operation in airplane mode).

## 5. Phase 4 — Active learning: recall and answer assessment

- [x] 5.1 Implement `RecallQuestionTask` (fast class, structured): generate a question from
  designated already-read chunk(s) with `RecallQuestionProposal` (question, expected answer,
  concept keys, chunk refs); validation requires chunk refs to exist.
- [x] 5.2 Rust: add migration creating `recall_prompt_history` (fingerprint, question,
  document/chunk refs, asked_at, outcome; 90-day prune job); commands to record outcomes;
  tests.
- [x] 5.3 Implement the fingerprint/dedup module (normalized question text + concept keys,
  similarity threshold, 30-day window) as a pure TS function with unit tests incl.
  near-duplicate cases.
- [x] 5.4 Implement the interruption policy module (pure TS): modes off/low/adaptive/
  intensive, minimum intervals (low 10 min, adaptive 4–10 by signals, intensive 2 min), max
  3/session, suppression during selection/reflow/playback, "not today" and kill switch;
  signals input contract (progress delta, density, review-grade trend, coverage, time since
  last); exhaustive unit tests for budget boundaries.
- [x] 5.5 Integrate prompt surfacing into the reading experience (viewer-level overlay, not
  modal spam): dismissible prompt card, answer input, immediate feedback via
  `AssessAnswerTask`, then continue reading at the same position; wiring in
  `DocumentViewer`/scroll surfaces behind `aiActiveRecall`.
- [x] 5.6 Implement `AssessAnswerTask` (reasoning class with full fallback) producing
  validated `AnswerAssessment`; misconception/partial/adversarial handling per spec;
  evaluation fixtures for all grading classes with the fake provider.
- [x] 5.7 Rust: add migration creating `answer_assessments` (linked to review results,
  provenance, scores, missing concepts); command `record_answer_assessment` + TS wrapper;
  tests.
- [x] 5.8 Review-session integration behind `aiAnswerAssessment`: optional free-response
  input before reveal (skippable), assessment display beside the revealed answer, grade
  routing untouched (verify `submit_review` path unchanged); implement `aiAutoGradeSuggest`
  highlight-only behavior (default off); update `flashcard-review-session` spec tests.
- [x] 5.9 Add "keep this question" promotion from recall prompts into the Learn-this preview
  flow; settings for active-recall mode; i18n keys; run full gates; verify scheduler
  authority via tests asserting review outcomes are identical with assessments on/off.

## 6. Phase 5 — Knowledge relationships

- [x] 6.1 Rust: add migration creating `concepts` and `concept_links` (typed relations,
  confidence, provenance JSON, created_by, is_dismissed, unique proposal fingerprint);
  commands for CRUD + `dismiss_concept_link` + link queries (backlinks, concept page);
  alignment with `element_tree.concept_link_id`; tests.
- [x] 6.2 Implement `PrerequisiteAnalysisTask` (full class, structured) per spec; coverage
  estimation runner that queries the index + cards + review history per concept and produces
  evidence levels with refs; hedged-language UI strings.
- [x] 6.3 Build the prerequisites UI: selection action "Find prerequisites", coverage summary
  ("cards covering 3 of 4"), missing-gap callout, evidence links that navigate.
- [x] 6.4 Implement concept-link proposal during explicit actions (Learn this, Find related,
  Ask library) with per-analysis caps (≤ 5) and confidence thresholds; proposal inspection UI
  (type, confidence, provenance, accept/dismiss with remembered fingerprints).
- [x] 6.5 Build "Find related" action and concept page/backlinks view over concept links +
  semantic retrieval (single retrieval system); navigation to sources.
- [x] 6.6 Implement `PassageClassificationTask` (fast class) with `passage_scores` cache
  (chunk-hash keyed) and Rust commands; on-demand scoring for read viewport content only.
- [x] 6.7 Build the extract-worthiness margin indicator (threshold ≥ 0.75, one-tap conversion
  into extract/card candidate via existing flows) with global disable and per-document
  suppression; evaluation fixtures for passage types (definition-heavy, narrative, examples,
  bibliography, transitions, formulas).
- [x] 6.8 i18n keys; run full gates; verify no background scoring occurs when the feature is
  off and no indicators appear on bibliography/transition fixtures.

## 7. Phase 6 — Socratic tutoring

- [x] 7.1 Implement `TutorTurn` task (reasoning class with full fallback, structured):
  moves (question/hint/explain/wrap-up), hint level 0–3, stuck detection, optional
  promote-to-card payload; bounded session context builder (last 6 turns + distilled
  summary) with token budget enforcement; tests for context bounding.
- [x] 7.2 Implement the tutor session state machine (TS): turn loop, stuck counter, max 2
  hints per thread then explain, escape hatch always available, wrap-up with optional card
  promotion into the Learn-this preview flow; grounding via current selection + retrieved
  prerequisites.
- [x] 7.3 Build the tutoring UI (distinct from Q&A surfaces): entry from selection actions
  and concept pages, conversation view with move-appropriate styling, hint escalation
  affordances, "just explain it" button, session summary.
- [x] 7.4 Verify reasoning routing and fallback behavior in tests (fake reasoning provider
  vs none); i18n keys; evaluation fixtures (stuck-learner progression, escape hatch,
  grounding); run full gates.

## 8. Phase 7 — Constrained learning agent

- [x] 8.1 Implement the tool registry (`src/lib/ai/agent/`): typed tool schemas for all
  read-only tools backed by existing APIs (`search_library` via retrieval+FTS,
  `get_current_document/selection`, `get_recent_reading_context`, `get_related_material`,
  `get_existing_cards`, `get_review_history`, `get_due_cards`); argument validation +
  result shaping (ids verified against real records via Rust where authority matters).
- [x] 8.2 Implement the agent loop over `runTask`: tool-call parsing (structured output),
  bounded execution (≤ 8 tool calls, ≤ 20 proposals, ≤ 60 s, ≤ 2 retrieval hops, loop
  detection), untrusted-block wrapping of all tool results, graceful budget-exhaustion
  endings; unit tests for every bound and the recursion guard.
- [x] 8.3 Implement proposal tools (`propose_extract`, `propose_flashcard`, `propose_cloze`,
  `propose_occlusion`, `propose_tag`, `propose_link`) that emit validated candidates into the
  standard preview/approval UIs — no direct writes; mass-creation caps enforced in
  validation regardless of model output.
- [x] 8.4 Injection-resistance tests: source-embedded directives (ignore-instructions,
  destructive tool demands, mass-creation demands) never produce out-of-contract calls;
  hallucinated/unowned IDs rejected; system contract defined independent of source content.
- [x] 8.5 Implement execution tracing in diagnostics (tool, arg digest, duration, outcome
  category; no content by default) + developer debug inspection view.
- [x] 8.6 Build the agent UX: command-palette/assistant entry with example intents
  ("make cards from the three most important things I just read", "find the chapter where…",
  "quiz me on this section", "turn this diagram's labels into occlusion cards"), proposal
  review hand-off, run progress/cancel.
- [x] 8.7 i18n keys; end-to-end tests with the fake provider for the canonical intents;
  verify all bounds; run full gates; Android dogfood.

## 9. Final verification and rollout gates

- [x] 9.1 Full regression: `npm run test:run`, `npm run bench:check`,
  `npm run test:scripts`, `cargo test --lib`, `cargo check`, Android plugin unit tests, and
  `npm run build` bundle-budget check — all green.
- [x] 9.2 Capability-degradation matrix verified manually/automatically: no vision → manual
  occlusion intact; no index → lexical/current-document flows intact; no reasoning → tutor/
  assessment use full class; no Nano on unsupported device → features absent or cloud-explicit
  only; existing summarize/explain/Q&A unchanged.
- [x] 9.3 Privacy audit: on-device/offline/cloud indicators present on all AI surfaces;
  on-device-only mode blocks every cloud path; no sensitive content in diagnostics/logs by
  default; document text never outside untrusted blocks in prompts (spot-check task
  definitions).
- [x] 9.4 Migration/backcompat check: existing DB upgrades cleanly through the new
  migrations (test from a pre-change DB snapshot); reading never blocked by indexing; all new
  flags default-off except behavior-preserving Phase 0; rollback by flags verified.
- [x] 9.5 Update `docs/` (FEATURES_IMPLEMENTED / relevant guides) and the OnDeviceAiPanel /
  settings copy for the new AI surfaces; record benchmark baselines added during the change
  in `scripts/perf-baselines.json` with rationale.
