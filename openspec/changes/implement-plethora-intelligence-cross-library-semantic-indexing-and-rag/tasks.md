# Implementation Tasks

## 1. Contracts first (unblocks 8/9/12/13)
- [x] 1.1 `RagHit`/`RagCitation`/`source_kind` types + `rag_query` command signature doc
- [x] 1.2 Locator normalization helpers per format (pdf anchor, CFI, timestamp, extract id)

## 2. Index layer
- [x] 2.1 Migration: `semantic_chunks` source_kind/source_id/locator columns + indexes (next free number; re-anchor rule)
- [x] 2.2 Chunker extension for extract/note/annotation sources; change-driven enqueue hooks (debounced, bounded) at creation/edit sites
- [x] 2.3 "Exclude from AI/cloud" document flag: schema, settings UI, enforcement in cloud path
- [x] 2.4 Backfill task for existing extracts/notes into the index (battery-gated, resumable)

## 3. Retrieval
- [x] 3.1 RRF fusion of FTS5 + vector candidates in `retrieval.rs`
- [x] 3.2 Reranker provider abstraction (hosted via capability + local hook) behind `mode`
- [x] 3.3 `rag_query` command + filters + telemetry fields; golden-set retrieval tests (seeded fixtures)
- [x] 3.4 Retrieval/indexing benchmarks with baselines recorded (AGENTS.md protocol)

## 4. Citations & answers
- [x] 4.1 `CitationChips` component + deep-link navigation (tabsStore) + hover previews
- [x] 4.2 Upgrade `libraryTask` (`ask-library`): rag_query context assembly, marker validation, not-found handling, provenance records
- [x] 4.3 AssistantPanel: citation rendering wired to chips; index-status awareness (coverage notes while indexing)

## 5. Cloud tier
- [x] 5.1 `embed_batch` job kind (proposal-5 registry): batching, quota (tokens), no-persistence guarantees
- [x] 5.2 Settings: backend picker (Nano/Ollama/BYO/Plethora-cloud), privacy disclosure copy, index management panel evolution

## 6. Validation
- [x] 6.1 Coverage/cascade/exclusion tests; locator round-trip tests per format; citation-marker validation tests
- [x] 6.2 Full gates: vitest, cargo test, bench:check, build:check; i18n 6 locales for all new strings

