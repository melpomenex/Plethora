# Fix Study Plans Grounding and Universal Source Support

## Why

Study Plans curriculum generation currently fails on valid YouTube transcripts and leaves most non-prose or non-`documents` library sources unusable:

1. **YouTube and transcript grounding failure (`study_generation.error.unverified_evidence`)**:
   - `retrieval.rs::lexical_results` queries `semantic_chunks` only for `"session"` and `"document"` source types, ignoring `"transcript"` chunks created by `chunk_transcript`, and falls back to ephemeral `fts-<doc_id>` results that fail strict chunk/document verification.
   - `indexer.rs::list_indexable_documents` filters solely on `COALESCE(content, '') != ''`, skipping documents whose text lives in `youtube_transcripts`, `video_transcripts`, `transcript_segments`, `podcast_transcript_segments`, or child extracts/annotations.
   - `youtube.rs::persist_canonical_youtube_transcript` skips background AI index enqueueing when `AppHandle` is absent (internal/cache paths) and never updates `documents.content_hash`.
   - `position.rs::save_position` and `audio_playback.rs::commit_checkpoint_under_authority` update `documents.date_modified` on routine reading/playback checkpoints. Because `study_source_repository.rs`, `study-sources.ts`, and `curriculumPreflight.ts` fall back to `date_modified` whenever `content_hash` is absent (and `verify_chunk_ref` checks `ai_index_state.updated_at >= documents.date_modified`), reading/watching a document triggers false `source_changed` / stale-index verification failures.
   - `evidence.ts::mapLocationToJump` only maps `pdf`, `epub`, and `audio`, silently dropping `youtube`, `video`, `transcript`, `session`, `html`, and `markdown` jumps, and `study_source_repository.rs` only recognizes a narrow subset of source types and jump formats.

2. **Limited source coverage**:
   - `SourceScopePicker` only lists raw `documents` rows via `getDocuments()`, without readiness indicators, preparation actions (user-authorized captions/transcription/OCR/indexing), or access to RSS articles, podcast episodes, recording sessions, extracts, annotations/notes, collections, and tags.
   - Local video (`LocalVideoPlayer`), recording sessions (`LearningStudio`), plain-text/markdown, image OCR, podcast transcripts, and scanned PDFs lack end-to-end ingestion/adapter parity with PDFs and EPUBs.

## What Changes

- **Decouple content revision from reading/playback activity**: Add additive SQLite migration (`150_content_revision_and_chunk_fts`) introducing `documents.content_updated_at` (never mutated by reading/playback position checkpoints), canonical `content_hash` population across document/transcript/OCR writers, and `semantic_chunks_fts` (FTS5 over `semantic_chunks` kept in sync by SQLite triggers).
- **Fix transcript persistence, indexing, and retrieval grounding**:
  - Pass/use enqueue hooks whenever transcripts or captions are persisted (and provide deterministic idempotent index assurance during Study Plans preflight for selected scope sources).
  - Include transcript, session, extract, annotation, and podcast-backed docs in `indexer.rs::list_indexable_documents`.
  - Support `"transcript"`, `"session"`, `"extract"`, `"annotation"`, `"card"`, and `"document"` chunks in `retrieval.rs` using `semantic_chunks_fts` and strict source filters so valid indexed chunks resolve directly rather than synthesizing unverifiable `fts-*` stubs.
  - Ensure transcript segment timestamp formatting (`[mm:ss]`) reconciles cleanly during `verify_chunk_ref` and `resolve_study_source_refs`.
- **Universal `StudySourceAdapter` and readiness pipeline**:
  - Support every applicable Plethora source type (PDF + OCR, EPUB, HTML/Web/X thread, Markdown, Plain text, YouTube, Local video, Audio/Audiobooks, Recording sessions, Podcasts, RSS articles, Extracts, Annotations/Notes, Images with OCR, Collections, and Tags) with explicit readiness states (`ready`, `indexing`, `needs-transcript`, `needs-ocr`, `ai-excluded`, `unavailable`) and user-authorized preparation actions.
  - Extend exact citation locators (`ExactSearchHitLocation` + Rust verification + `DocumentViewer` / `LocalVideoPlayer` / `LearningStudio`) for `youtube`, `video`, `audio`, `pdf`, `epub`, `html`, `markdown`, `text`, `image`, and `extract` with honest `exact` vs `coarse` navigation degradation.
  - Add coverage-aware stratified evidence planning for long lectures/videos/books and actionable privacy-safe rejection diagnostics.

## Capabilities

### Modified Capabilities

- `adaptive-learning-paths`: Universal source-type selection/readiness, decoupled content revision verification, coverage-aware evidence hydration, diagnostic rejection details, and exact timestamp/locator navigation across all supported source types.
- `ai-semantic-index`: Include transcript/media/annotation/extract-backed documents in `list_indexable_documents`, add `semantic_chunks_fts`, register `SOURCE_TYPE_TRANSCRIPT`, and query all indexed chunk types in `retrieval.rs`.
- `youtube-canonical-transcript-intelligence`: Update `documents.content_hash` + `content_updated_at` on canonical transcript writes, reliably enqueue/ensure semantic indexing across all write paths, and guarantee clickable timestamp citation navigation in Study Plans.

## Impact

- **Database / Rust**: Additive Migration `150` in `src-tauri/src/database/migrations.rs`, updates across `ai_learning/{models,indexer,chunker,retrieval}.rs`, `database/study_source_repository.rs`, `youtube.rs`, `services/{position,audio_playback}.rs`, `commands/{document,video,podcast,recording_sessions,study_sources}.rs`.
- **Frontend / TypeScript**: `src/types/{searchHit,studySource}.ts`, `src/lib/study-plans/{sourceValidation,openStudySource,universalSourceAdapter}.ts`, `src/lib/study-plans/generation/{evidence,coordinator,curriculumPreflight}.ts`, `src/components/study-plans/{SourceScopePicker,CurriculumGenerator,PlanSourceList}.tsx`, `src/components/viewer/{DocumentViewer,LocalVideoPlayer}.tsx`.
- **Privacy & Source Integrity**: Strictly preserves `is_ai_excluded`, `is_local_only`, user consent before transcription/OCR or cloud AI, fail-closed excerpt/SHA-256 verification, and backward compatibility for existing saved Study Plans and historical citations.
