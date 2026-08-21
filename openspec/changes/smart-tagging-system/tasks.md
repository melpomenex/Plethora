## 1. Remove Legacy Faulty Auto-Taggers

- [x] 1.1 Remove `suggest_auto_tags` from `src-tauri/src/commands/document.rs` and eliminate unconditional `"auto-tagged"` tag appending
- [x] 1.2 Remove `suggestAutoTags` from `src/lib/browser-backend.ts` and eliminate unconditional `"auto-tagged"` tag appending
- [x] 1.3 Clean up any test fixtures and mocks that relied on the legacy 5-line static substring heuristic

## 2. Core Baseline Smart Tagging Engine (Tier 1 Local / Zero-LLM)

- [ ] 2.1 Implement tokenizer, unicode word-boundary splitter, and multilingual stopword filter in `src-tauri/src/ai/smart_tagging/tokenizer.rs`
- [ ] 2.2 Implement TF-IDF / BM25 term salience and keyphrase extractor in `src-tauri/src/ai/smart_tagging/salience.rs` with positional weighting (title 5x, headings/TOC 3x, body 1x)
- [ ] 2.3 Implement composite multi-term domain signatures in `src-tauri/src/ai/smart_tagging/domain_signatures.rs` requiring co-occurrence evidence thresholds for broad domains (Math, Biology, History, Computer Science, Economics, Physics, Philosophy)
- [ ] 2.4 Implement candidate existing-tag retrieval in `src-tauri/src/ai/smart_tagging/candidate_retrieval.rs` to rank and fetch the top 30 relevant user tags from the SQLite database
- [ ] 2.5 Implement canonicalization and duplicate prevention in `src-tauri/src/ai/smart_tagging/normalization.rs` (case-insensitive, singular/plural, hyphenation, whitespace)
- [ ] 2.6 Implement confidence scoring and acceptance policy in `src-tauri/src/ai/smart_tagging/policy.rs` (minimum confidence threshold 0.70, cap of 3-8 tags, 0 tags assigned if evidence is weak)
- [ ] 2.7 Implement Tier 1 TypeScript fallback in `src/lib/smartTagging/baseline.ts` for browser/PWA mode

## 3. LLM-Enhanced Smart Tagging Task (Tier 2 Refinement)

- [ ] 3.1 Define the strict JSON schema in `src/lib/ai/schemas/smartTagging.ts` for existing tag selection and new tag proposals with confidence and explainability reasons
- [ ] 3.2 Implement representative context builder in `src/lib/ai/tasks/definitions/smartTaggingContext.ts` (title, author, headings/TOC, intro/conclusion excerpts, top keywords, capped at 3,000 tokens)
- [ ] 3.3 Implement `SmartTaggingTask` in `src/lib/ai/tasks/definitions/smartTaggingTask.ts` using `AITaskDefinition`, `UNTRUSTED_CONTAINMENT_CLAUSE`, and `<untrusted_source>` blocks
- [ ] 3.4 Wire `SmartTaggingTask` to use `jsonRepair.ts` for truncation salvage and Zod validation for strict fail-closed output verification
- [ ] 3.5 Implement provider error and offline fallback in `src/lib/ai/tasks/definitions/smartTaggingTask.ts` to seamlessly revert to Tier 1 baseline tags

## 4. Ingestion Pipeline & Background Execution

- [ ] 4.1 Create background tagging dispatcher and bounded concurrency worker (max 2 concurrent tagging jobs) in `src/stores/smartTaggingQueueStore.ts`
- [ ] 4.2 Hook asynchronous Smart Tagging into file import pipeline (`import_document`, `import_documents`, `import_document_from_bytes`) in `src-tauri/src/commands/document.rs`
- [ ] 4.3 Hook asynchronous Smart Tagging into web article, YouTube, Twitter/X thread, Podcast, Kindle, and Markdown import pipelines in `src/stores/documentStore.ts`
- [ ] 4.4 Ensure document creation and UI display complete immediately before background tagging starts
- [ ] 4.5 Dispatch `ITEM_TAGS_UPDATED_EVENT` upon completion to update UI tag chips reactively without full page reloads

## 5. Tag Provenance, Metadata & User Authority

- [ ] 5.1 Extend `DocumentMetadata` type in `src/types/document.ts` to include `smartTagDetails` (tag, provenance `manual` | `smart-local` | `smart-llm`, confidence, reason, timestamp)
- [ ] 5.2 Update `src/lib/tagEditing/mutationAdapter.ts` to mark user-added tags as `manual` and record user-removed tags as `dismissed` to prevent automated re-application
- [ ] 5.3 Update `CompactTagEditor` and `ItemDetailsPopover` in `src/components/documents/` to show provenance indicators and explainability reasons on hover/click

## 6. Settings & Defaults

- [ ] 6.1 Add `smartTagging` configuration interface in `src/types/settings.ts` with default `enabled: true`, `mode: "automatic"`, `maxTagsPerDocument: 6`, `preferExistingTags: true`
- [ ] 6.2 Update `src/stores/settingsStore.ts` with default enabled state and Zustand persist migration for existing users
- [ ] 6.3 Add Smart Tagging controls (toggle, mode selector, max tags slider) in `src/components/settings/DocumentsSettings.tsx`

## 7. Command Palette & Library Maintenance Actions

- [ ] 7.1 Register `Retag this document` and `Suggest tags for this document` in `src/commandPalette/contextualActions.ts` and `src/components/common/CommandPalette.tsx`
- [ ] 7.2 Implement `Tag untagged documents` and `Clean up legacy auto-tags` in `src/components/common/CommandPalette.tsx` for batch library maintenance
- [ ] 7.3 Add "Retag Document" action to document context menu and viewer toolbar

## 8. Testing & Regression Suite

- [ ] 8.1 Create unit tests for Rust baseline tokenizer, TF-IDF salience, and domain signature scoring in `src-tauri/src/ai/smart_tagging/tests/`
- [ ] 8.2 Create unit tests for TypeScript baseline classifier and Zod schema validation in `src/lib/smartTagging/__tests__/` and `src/lib/ai/schemas/__tests__/`
- [ ] 8.3 Implement comprehensive false-positive regression suite with negative domain fixtures:
  - Non-math programming article with words `function`, `table`, `average`, `model` does NOT receive `Math`
  - History article with "average citizen" does NOT receive `Math`
  - Tech article mentioning `software`, `hardware`, `warning`, `forward` does NOT receive `History`
  - Article mentioning `cancellations` or `cellphone` does NOT receive `Biology`
  - Legal/judicial article mentioning `death sentence` does NOT receive `Language`
- [ ] 8.4 Implement positive classification tests:
  - Differential equations text receives `Math`
  - Linux kernel scheduling article receives `Operating Systems` / `Linux` / `CPU Scheduling`
  - Ancient Roman republic article receives `History` / `Rome`
- [ ] 8.5 Test existing taxonomy preference: importing a machine learning article into a library with `Machine Learning` tag reuses that tag and does not create `AI / ML`
- [ ] 8.6 Test provider failure and offline fallback: verify that simulated LLM timeouts and network errors still produce Tier 1 baseline tags and complete import
- [ ] 8.7 Test manual tag protection: verify that user-assigned tags are preserved and manually deleted tags are never auto-reapplied

## 9. Performance, Benchmarks & Documentation

- [ ] 9.1 Add performance benchmark `src/benchmarks/smartTagging.bench.ts` to measure Tier 1 classification speed (< 10ms per document) and verify against bundle/perf gates (`npm run bench:check`)
- [ ] 9.2 Add user documentation for Smart Tagging in `docs/user-guide/smart-tagging.md` explaining automatic tagging, provenance indicators, and retagging commands
