# Design: Two-Stage Command Palette & Unified FTS5 Search

## 1. Latency & Completeness Architecture

### Why `maxDocsToScan = 500` Is Replaced
Cutting off scan loops at `500` documents breaks completeness: a document imported early in a 3,000+ item library becomes completely unfindable via content search unless it falls in the first 500 items or matches title. Moving content search to SQLite FTS5 scans an inverted index over **100% of items** in O(postings), typically **2–15 ms at 10,000+ documents**, eliminating both the main-thread freeze and the 500-item blind spot.

### Two-Stage Pipeline (`CommandCenter.tsx` + `GlobalSearch.tsx`)

1. **Palette Open Path (< 50ms open to focused input)**:
   - Focus input immediately on mount/open (`autoFocus` + microtask/rAF focus safeguard).
   - Do **not** call `loadExtracts()` globally or run `extractDocumentText()` loops on open.
   - Memoize command registry output cleanly by reactive configuration primitives (theme, feature flags, view destination/active pane) instead of reconstructing 200+ JSX nodes inside every keystroke callback.
   - Derive home state (`selectResumeCandidate`, `selectRecentCandidate`) smoothly without blocking input listeners.

2. **Stage A — Synchronous / Immediate Frame (< 16ms per keystroke)**:
   - Run **without waiting** for any Tauri IPC debounce timer:
     - URL / X-status quick-import command synthesis
     - `#` help mode or `>` / filter parsing
     - `matchCommands(preparedRegistry, query)` (pre-normalized `PreparedCommandIndex` stored in `WeakMap<Command[], PreparedCommandEntry[]>`)
     - Active view contextual actions (`contextualActions`)
     - Fast in-memory title prefix/substring hits over loaded documents (for instant feedback while Stage B is in flight, merged & replaced seamlessly when Stage B settles so final ranking reflects BM25 + tiers cleanly).

3. **Stage B — Indexed SQLite FTS5 Search (`palette_search`)**:
   - Single trailing debounce / single-flight coalescer (~30ms on native Tauri so rapid keystrokes coalesce without adding perceptible lag, ~100ms in browser fallback).
   - Generation token (`generation = ++searchGenerationRef.current`):
     - Before mutating React state on completion (or if palette closed / query emptied), check `generation === searchGenerationRef.current && commandPaletteOpen`.
     - If a newer Stage B request is issued while one is active, the superseded response is ignored and the queued latest query executes immediately when the active slot yields (single-flight max 1 active backend search at a time, zero IPC pileup!).
   - Query `palette_search` across **five indexed sources in SQLite**:
     1. **Documents** (`document_search` FTS5 + `documents` filters: `is_archived`, `category`, `collection_id`, `tags`, `file_type`, rating, extracts filter, date range).
     2. **Semantic Chunks** (`semantic_chunks_fts` from Change 1 — returns exact `pageNumber`, `cfiRange`, `timestampMs`, `textQuote` without JS regex/DOM parsing!).
     3. **Transcripts** (`transcript_search_fts` FTS5 over `youtube_transcripts`, `video_transcripts`, `podcast_transcript_segments`, `transcript_segments` — returns exact millisecond `start_ms`, `segment_id`/`ordinal`, highlighted snippet).
     4. **Extracts** (`extract_search` FTS5 joined with `extracts` + parent `documents.title`).
     5. **RSS Articles & Flashcards** (`rss_articles_fts` + indexed `learning_items` / `concepts` lookup when in `all`/`library`/`cards` scope).

## 2. FTS5 Schema & HTML Stripping (`Migration 151`)

Add `transcript_search_fts` in `src-tauri/src/database/migrations.rs`:
- Indexes normalized transcript text alongside `source_kind` (`youtube` | `video` | `podcast` | `session`), `document_id`, `source_id` (episode_id / video_id / session_id), `segment_key`, `start_ms` (`UNINDEXED`).
- Kept synchronized via triggers on `youtube_transcripts`, `video_transcripts`, `podcast_transcript_segments`, and `transcript_segments` (plus one-time migration backfill).
- Add safe FTS5 query sanitizer (`sanitize_fts_query`):
  - Tokenize user words/quoted phrases safely so punctuation (`C++`, `foo:bar`, unmatched quotes, `(`, `)`, `-`, `*`, OR/AND/NOT keywords in prose) never throws a SQLite `fts5: syntax error`!
  - Use prefix match `"token"*` for partial typing (`3+` chars) alongside exact/stem matching (`porter unicode61`).
- Strip HTML tags on the Rust side when producing snippets from `html` documents (`strip_html_snippet`) instead of calling `DOMParser` in JavaScript.
- **No live network / IPC side effects**: Never call `get_youtube_transcript`, `fetchYouTubeTranscript`, or `extractDocumentText` inside `handleSearch`.

## 3. Command Registry Pre-Indexing (`src/commandPalette/registry.tsx`)

Currently `tokenTier` allocates lowercase arrays and runs Levenshtein distance on every keystroke (`~41 ms` in `palette.bench.ts`).
Optimize cleanly inside `registry.tsx` (preserving 100% identical scoring semantics, tie-breaking, and test assertions):
- Cache `PreparedCommand` per `Command[]` reference via `WeakMap` (and per `Command` object via `WeakMap` so object reuse is O(1)):
  - Precompute lowercase `label`, `aliases[]`, `keywords[]`, `description`, plus word-set / single-token flag (`!candidate.includes(" ")`).
  - Only invoke `fuzzyMatch` if exact/prefix/keyword tiers do not already reject/beat or after fast length-difference pruning (`Math.abs(candidate.length - token.length) <= 2` or bounded prefix/subsequence bound consistent with `fuzzyMatch(candidate, token, 2)` — verifying 100% equivalence on all existing `registry.test.tsx` tests!).

## 4. UI Rendering, Focus & Feature Parity

- Preserve all scopes: `all`, `actions`, `documents`, `library`, `cards`, `settings`.
- Preserve URL / X-thread detection, `#` syntax help, contextual actions, Ask Plethora handoff, secondary content hits preview/activation, saved searches, and advanced filters.
- Render up to a bounded DOM window per batch (`INITIAL_RENDER_LIMIT = 50` with keyboard-reachable `"Load more matches"` / progressive reveal when Stage B reports additional matches) so WebKitGTK/WKWebView never lays out thousands of DOM rows at once while allowing full result exploration.

See [BENCHMARK_PLAN.md](./BENCHMARK_PLAN.md) for benchmark harnesses and acceptance metrics.
