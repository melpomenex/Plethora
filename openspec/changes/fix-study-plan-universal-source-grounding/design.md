# Design: Universal Source Grounding & YouTube/Transcript Integrity

## 1. Root-Cause Summary & Invariants

Six compounding defects caused `study_generation.error.unverified_evidence` on YouTube/media sources and left non-`documents` sources unsupported:

1. **Retrieval skips `"transcript"` chunks**: `chunker.rs::chunk_transcript` writes `source_type = "transcript"` in `semantic_chunks`, while `retrieval.rs::lexical_results` checked only `"session"` and `"document"`, falling back to unindexed `fts-<doc_id>` hits.
2. **Indexer blind to transcript-backed documents**: `indexer.rs::list_indexable_documents` filtered exclusively on `COALESCE(content, '') != ''`, skipping documents whose canonical text sits in `youtube_transcripts`, `video_transcripts`, `transcripts` + `transcript_segments` (`recording_sessions` or book chapters), `podcast_transcript_segments`, `extracts`, or `annotations`.
3. **Silent enqueue/hash omissions**: `youtube.rs::persist_canonical_youtube_transcript` skipped indexing when `app` was `None` (cached/internal calls), did not populate `documents.content_hash`, and `commands/video.rs::set_video_transcript` / `commands/podcast.rs::save_podcast_transcript_segments` never enqueued AI indexing.
4. **False `source_changed` / stale index from reading progress**: `position.rs::save_position` and `audio_playback.rs::commit_checkpoint_under_authority` mutate `documents.date_modified`, which `study_source_repository.rs` and `study-sources.ts` used as live revision whenever `content_hash` was null, and which `verify_chunk_ref` compared against `ai_index_state.updated_at`.
5. **Transcript formatting normalization mismatch**: `chunk_transcript` prefixes chunks with `[mm:ss]`, whereas `youtube_transcripts.transcript` stores raw text alongside `segments_json`. Substring matching during `verify_chunk_ref` / `resolve_study_source_refs` must match canonical normalized transcript text cleanly in both formatted and raw forms.
6. **Dropped locator kinds & missing viewer jump wiring**: `evidence.ts::mapLocationToJump` ignored `"transcript"`, `"youtube"`, `"video"`, `"session"`, `"html"`, and `"markdown"`. `LocalVideoPlayer` did not receive `initialJump` from `DocumentViewer.tsx`.

### Non-Negotiable Invariants
- Never bypass excerpt verification, SHA-256 verification, or scope filtering (`documentIds` strictly enforced).
- Never allow reading/playback checkpoint saves to invalidate content revision or index freshness.
- Preserve all existing saved `study_plans`, `study_plan_versions`, and historical `study_source_refs` (including legacy `revision_kind = 'modified-at'` refs when content itself has not changed).
- Never auto-run transcription, OCR, or remote LLM/embedding calls without user initiation/consent; enforce `is_ai_excluded` and `is_local_only` across every source adapter.

## 2. Content Revision Architecture (`Migration 150`)

Add column `content_updated_at TEXT` to `documents` (NULL on legacy rows until backfilled or updated; fallback logic uses `COALESCE(content_updated_at, date_added)` when `content_hash` is absent so `position.rs` / `audio_playback.rs` updates to `date_modified` never perturb content revision).

Also create `semantic_chunks_fts`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS semantic_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    source_type UNINDEXED,
    text,
    tokenize = 'porter unicode61'
);
```
with INSERT/UPDATE/DELETE triggers on `semantic_chunks` and one-time backfill from existing `semantic_chunks`.

### Revision Resolution Rules
- **Authoritative live revision**:
  1. `documents.content_hash` (if non-empty)
  2. Otherwise computed deterministic SHA-256 of live canonical text/transcript/HTML/extracts (populated whenever content or transcript is written, and backfilled/computed cleanly in Rust)
  3. Only if a document genuinely has no extractable text (`needs-ocr` / `needs-transcript` / media-only) does it fall back to `COALESCE(content_updated_at, date_added)` with `RevisionKind::ModifiedAt`.
- **`verify_chunk_ref` freshness rule**:
  - `index_current` checks `(i.document_id IS NOT NULL AND datetime(i.updated_at) >= datetime(COALESCE(NULLIF(d.content_updated_at, ''), d.date_added)))` rather than comparing against reading-position-mutated `d.date_modified` — AND also treats `i.state IN ('indexed', 'lexical_only')` or valid live `chunk.content_hash == computed_hash(chunk.text)` when no subsequent content edit occurred as current!
- **Legacy `modified-at` citation compatibility**:
  - When verifying an existing `StudySourceRefV1` with `revision_kind == ModifiedAt`: if `d.content_updated_at` is NULL or `<= ref.revision`, OR normalized excerpt matches the live source verbatim without a newer content edit timestamp, it resolves as `Current` rather than spuriously flipping stale when the user opens and scrolls the document.

## 3. Transcript Persistence, Chunk Indexing & Retrieval

- Introduce a repository-level / `AiLearningState` dirty-queue integration (plus explicit `AppHandle` forwarding in `get_youtube_transcript`, `get_youtube_transcript_internal`, `fetch_youtube_transcript_on_device`, `extract_document_text`, `set_video_transcript`, `generate_video_transcript`, `save_podcast_transcript_segments`, `import_session_transcript`, `commit_session_unit`, `ocr_*`).
- Add Tauri command `ensure_study_sources_indexed(document_ids: Vec<String>) -> EnsureIndexedResult`:
  - Respects `is_ai_excluded` (skips AI chunking/embedding if excluded — never leaks excluded content into semantic chunks).
  - For eligible selected docs whose `ai_index_state` is missing/stale or has `0` `semantic_chunks` despite having available text/transcript/extracts/annotations, synchronously builds/refreshes local lexical `semantic_chunks` (+ `semantic_chunks_fts`) cleanly via `index_document_chunks_only` (no network/remote embedding required!), and schedules background embedding if a local/consented embedding provider is active.
  - Because <= 24 docs are allowed in a Study Plan scope, local chunking completes rapidly and guarantees `semantic_chunks` + `semantic_chunks_fts` exist before retrieval begins!
- Update `retrieval.rs`:
  - Add `SOURCE_TYPE_TRANSCRIPT = "transcript"` in `ai_learning/models.rs`.
  - Search `semantic_chunks_fts` directly in `lexical_results` (filtered by `document_id IN (...)` and `source_type IN (...)`) so `"transcript"`, `"session"`, `"extract"`, `"annotation"`, `"card"`, and `"document"` chunks all rank and return real verified `chunk_id` + `location_json`.
  - Keep `document_search` fallback ONLY if a document has zero chunks (never when `semantic_chunks` exist for that document and source type).
- Update `evidence.ts`:
  - Coverage-aware retrieval: when generating for `foundational`/`deep`/`survey` and a long document/transcript has multiple chunks across distant ordinal ranges, fetch bounded stratified sample chunks across early/middle/late sections when search hits cluster narrowly, keeping within `MAX_GLOBAL_HITS = 96` and `MAX_CHARS_PER_BATCH = 18000`.
  - Record structured, privacy-safe diagnostics (`rejectionCountsByReason` + `unverifiedReasons` + `ephemeralFtsHitsCount`) instead of collapsing every verification problem into an opaque message.

## 4. Universal Source Adapter & Navigation Contracts

See [SOURCE_CAPABILITY_MATRIX.md](./SOURCE_CAPABILITY_MATRIX.md) for the complete per-type matrix.

- Extend `ExactSearchHitLocation` (`src/types/searchHit.ts`, `sourceValidation.ts`, `study_source_repository.rs`, `openStudySource.ts`, `DocumentViewer.tsx`):
  - Add `"video"` variant (`{ kind: "video"; timeSeconds: number; segmentId?: string; textQuote?: string }`) and `"text"` / `"image"` (`textQuote?`, `scrollPercent?`, `region?` optional) OR normalize cleanly with existing viewer props.
  - Specifically wire `LocalVideoPlayer` (`initialSeekTime`, `initialTranscriptSegmentId`, `initialTranscriptHighlightQuery`) and `LearningStudio` (`audio` or `video` jumps), plus support `annotation` / `extract` / `markdown` / `html` `textQuote` navigation.
- Non-`documents` promotion helpers:
  - Reuse `ensureRssArticleDocument` (and corresponding Rust/API `ensure_podcast_episode_document`) when user selects an RSS article or Podcast episode in `SourceScopePicker`, syncing content/transcript hash idempotently and keeping existing library items deduplicated.
- `SourceScopePicker` enhancements:
  - Tabbed/grouped source browser across Documents (all types), RSS Articles, Podcast Episodes, Recording Sessions, Collections, and Tags.
  - Clear readiness pills (`Ready`, `Needs transcript`, `Needs OCR`, `AI excluded`, `Local only`, `Indexing...`) and inline user-triggered preparation buttons (`Fetch captions`, `Transcribe`, `Run OCR`, `Index now`).
