## 1. Documentation Schema & Validation Tooling

- [x] 1.1 Create `docs/product/schema.json` and TypeScript/Zod metadata schema defining required frontmatter (`id`, `title`, `domain`, `status`, `platforms`, `summary`, `how_to`, `why`, `aliases`, `settings`, `actions`, `related`).
- [x] 1.2 Implement `scripts/docs-validate.mjs` to validate YAML frontmatter, check required markdown sections, detect duplicate feature IDs, verify cross-reference links, and validate allowlisted action IDs against code.
- [x] 1.3 Implement `scripts/docs-coverage.mjs` to statically inspect Tauri commands (`src-tauri/src/commands/`), Zustand stores (`src/stores/`), routes (`src/routes/`), and palette actions against documented feature IDs.
- [x] 1.4 Add `npm run docs:validate` and `npm run docs:coverage` scripts to `package.json` and wire them into `npm run build:check`.
- [x] 1.5 Write unit tests in `scripts/__tests__/docsValidation.test.mjs` verifying schema enforcement, broken link detection, and action validation.

## 2. Canonical Product Knowledge Base Authoring (Code-Verified)

- [x] 2.1 Author and code-verify **Reading & Document Viewers** domain (`docs/product/features/reading/`): PDF Page/Scroll modes, PDF reflow, EPUB CFI tracking, HTML reader, Markdown reader, Video transcript sync, Vim navigation, and Selection action bar.
- [x] 2.2 Author and code-verify **Document Management & Ingestion** domain (`docs/product/features/imports/`): Local file import, URL scraping, ArXiv paper import, Kindle clippings, Anki `.apkg` import, SuperMemo ZIP import, Browser extension Axum bridge, and Collections archive.
- [x] 2.3 Author and code-verify **Queue & Incremental Reading** domain (`docs/product/features/queue/`): Composed scroll queue, Composition sliders, 0-100 priority scoring, Extract chain inheritance, Extract lifecycle (Keep/Dismiss/Done), Neural queue clustering, and Reappearance calculation.
- [x] 2.4 Author and code-verify **Scheduling & Spaced Repetition Algorithms** domain (`docs/product/features/scheduling/`): FSRS-6 scheduler & retention parameters, SuperMemo 18 engine (3D SInc matrix), SM-20 Algorithm Arena & Postpone engine, classic SM-2/5/8/15, Scoped parameter overrides, and Load balancing.
- [x] 2.5 Author and code-verify **Review & Learning Items** domain (`docs/product/features/review/`): Flashcard Studio (Q/A, Cloze, Multi-Choice, Matching), OCR Image Occlusion editor, Hands-Free Audio Review, Zen Mode, Review card source provenance, and Rating undo.
- [x] 2.6 Author and code-verify **Language Learning System** domain (`docs/product/features/language/`): Language profiles, Lexical coverage highlighting, Dictionary Peek, Sentence mining, and Shadowing mode.
- [x] 2.7 Author and code-verify **Media, Audio & Neural TTS** domain (`docs/product/features/tts/`): Pocket TTS, Sherpa-ONNX, Fal.ai voice cloning, Word highlighting, Auto-scrolling, Position persistence, Souvlaki OS media keys / SMTC / MPRIS, and Hands-free study mode.
- [x] 2.8 Author and code-verify **AI Learning System & Tools** domain (`docs/product/features/ai/`): Task router, "Learn This" generation, Grounded Ask-Library RAG, Socratic tutoring, Active Recall reading interruptions, and NotebookLM Py AppImage integration.
- [x] 2.9 Author and code-verify **RSS & Podcasts** domain (`docs/product/features/media/`): Full-text RSS feed reader, NewsBlur sync, Reading queue RSS integration, Semantic preference learning, and Podcast search with Whisper transcription.
- [x] 2.10 Author and code-verify **Platform Specifics & Display Modes** domain (`docs/product/features/platform/`): True E-ink monochrome mode, Android SAF / GenAI / TTS integration, Desktop native window/tray, and Battery/thermal throttling.
- [x] 2.11 Author and code-verify **Search, Navigation & Command Palette** domain (`docs/product/features/search/`): Global CommandCenter, Per-view contextual actions, and 3D Knowledge Sphere.
- [x] 2.12 Author and code-verify **Settings, Appearance, Sync & Security** domain (`docs/product/features/settings/`): 100+ themes & fonts, Yjs encrypted sync, Delta log protocol, and Paid billing safety consent gates.
- [x] 2.13 Author foundational concept documents in `docs/product/concepts/` and common troubleshooting recovery recipes in `docs/product/troubleshooting/`.
- [x] 2.14 Run `npm run docs:validate` and `npm run docs:coverage` to verify 100% corpus compliance and zero validation errors.

## 3. Build Indexer & Pre-Indexed Static Knowledge Bundle

- [x] 3.1 Implement `scripts/build-help-index.mjs` to parse `docs/product/`, generate structured search chunks with metadata, compute corpus content SHA-256 hash, and output `.help/index.json`.
- [x] 3.2 Add build hook in `vite.config.ts` or `package.json` to generate the pre-indexed help bundle during production build.
- [x] 3.3 Create Rust backend helper in `src-tauri/src/commands/help.rs` for querying embedded SQLite FTS5 table or serving bundled help assets offline.

## 4. Local Hybrid Help Retrieval Engine

- [x] 4.1 Create `src/features/help/helpTypes.ts` with typed interfaces for `HelpDocChunk`, `HelpSearchResult`, `HelpAppContext`, `DirectLookupResult`, and `HelpCitationRef`.
- [x] 4.2 Implement `src/features/help/helpRetrieval.ts` supporting BM25 / lexical matching, exact alias scoring, metadata tag filtering, and candidate ranking.
- [x] 4.3 Implement contextual app state booster in `helpRetrieval.ts` applying multiplicative relevance boosts for active view, document format, TTS state, algorithm, and platform.
- [x] 4.4 Implement token budgeting & deduplication module enforcing a strict ceiling of ≤1,500 prompt tokens (k ≤ 5 distinct chunks) without mid-sentence truncations.
- [x] 4.5 Implement graceful offline degradation ensuring zero-AI fallback to lexical/alias ranking when offline or when no embedding backend is loaded.
- [x] 4.6 Write unit tests in `src/features/help/__tests__/helpRetrieval.test.ts` verifying BM25 scoring, contextual boosting, and token budgeting.

## 5. Command Palette Intent Routing & Direct Answers

- [x] 5.1 Implement deterministic intent classifier in `src/features/help/helpIntent.ts` categorizing inputs into `NavigationCommand`, `DirectDocumentationLookup`, `ProductHelpQuestion`, or `DocumentContentAI`.
- [x] 5.2 Add support for explicit `? ` and `/help ` prefixes in `CommandCenter.tsx` and `GlobalSearch.tsx` forcing product help mode.
- [x] 5.3 Implement direct canonical lookup resolver in `src/features/help/directLookup.ts` returning instant summaries, how-to instructions, and deep action links for high-confidence matches.
- [x] 5.4 Update `src/components/search/CommandCenter.tsx` to route queries through `helpIntent.ts`, displaying instant navigation and direct lookup results with 0ms LLM latency.
- [x] 5.5 Write unit tests in `src/features/help/__tests__/helpIntent.test.ts` verifying correct classification across 50+ query fixtures.

## 6. Grounded Synthesis AI Task & Multi-Provider Integration

- [x] 6.1 Define `AskPlethoraAnswer` schema and validator in `src/lib/ai/schemas/askPlethoraAnswer.ts` validating verbatim citation quotes and dropping unverified action references.
- [x] 6.2 Implement `askPlethoraTask` in `src/lib/ai/tasks/definitions/askPlethoraTask.ts` following `AITaskDefinition`, wrapping doc chunks in untrusted containment blocks (`<untrusted_source id="...">`).
- [x] 6.3 Register `askPlethoraTask` in `src/lib/ai/tasks/registry.ts` and wire provider routing across OpenAI, Anthropic, OpenRouter, Ollama, and on-device Gemini Nano.
- [x] 6.4 Implement IndexedDB help response cache in `src/lib/ai/helpCache.ts` keyed by `(docCorpusHash, featureIds, normalizedQuery, appState, modelId)` with automatic invalidation on corpus changes.
- [x] 6.5 Write unit tests in `src/lib/ai/tasks/__tests__/askPlethoraTask.test.ts` verifying grounding rules, missing evidence handling (`evidenceLevel: "none"`), citation validation, and cache hits.

## 7. Command Palette UX & Allowlisted Safe Action Dispatch

- [x] 7.1 Create `src/features/help/registeredHelpActions.ts` declaring typed allowlisted actions (`settings.appearance.eink`, `settings.learning.algorithm`, `action.reader.toggle_tts`, etc.) and their navigation handlers.
- [x] 7.2 Create `src/features/help/DirectAnswerCard.tsx` and `src/features/help/HelpCitationPill.tsx` rendering synthesized answers, verified citation badges, and interactive action buttons.
- [x] 7.3 Create `src/features/help/HelpDocViewer.tsx` and `src/features/help/AskPlethoraModal.tsx` for full in-app viewing of canonical feature markdown articles when citation badges are clicked.
- [x] 7.4 Update `src/components/search/GlobalSearch.tsx` and `CommandCenter.tsx` to render Help and Ask Plethora entries inline with progressive loading and keyboard navigation.
- [x] 7.5 Implement E-ink high-contrast styling and ARIA accessibility attributes across help viewers.
- [x] 7.6 Create help retrieval benchmarks and validation suites verifying retrieval performance and citation accuracy.
- [x] 7.7 Write unit tests in `src/features/help/__tests__/registeredHelpActions.test.ts` verifying action button clicks, citation navigation, and event dispatching.

## 8. Contextual Retrieval, Boosting & Intent Router Integration

- [x] 8.1 Create `src/features/help/helpRetrieval.ts` with contextual boosting extracting sanitized application state from tabs, settings, viewer, and TTS stores.
- [x] 8.2 Integrate intent routing directly into Command Palette with automatic prefix detection for `?`, `/help`, and `help:`.
- [x] 8.3 Support 0ms direct lookup resolution for all canonical feature aliases.
- [x] 8.4 Support full grounded RAG generation via `askPlethora` with citation verification.
- [x] 8.5 Provide offline zero-AI fallback returning top lexical chunks and direct answer when offline or no API key is set.
- [x] 8.6 Write integration tests in `src/features/help/__tests__/helpIntegration.test.ts` verifying end-to-end user query resolution.

## 9. Evaluation Benchmark Suite & Documentation Governance

- [x] 9.1 Create comprehensive test suite in `src/features/help/__tests__/helpIntegration.test.ts` and `src/features/help/__tests__/helpRetrieval.test.ts` testing exact, synonym, contextual, and troubleshooting queries.
- [x] 9.2 Add performance benchmark in `src/features/help/helpRetrieval.bench.ts` asserting <50ms retrieval latency and 0 remote LLM calls for deterministic lookups.
- [x] 9.3 Add documentation validation, coverage checks, and help unit tests to CI pipeline (`.github/workflows/ci-regression.yml`).
- [x] 9.4 Run full verification pipeline (`npm run build:check`, `npm run test:scripts`, `npm run bench:check`, `npm run docs:validate`, `npm run docs:coverage`) and verify clean passes across the entire project.
