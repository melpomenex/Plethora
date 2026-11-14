# Optimize Command Palette Search Latency and Completeness

## Why

Opening and typing in the Command Palette (`Ctrl/Cmd+K`, `CommandCenter.tsx` / `GlobalSearch.tsx`) exhibits severe sluggishness, jank, and incomplete search coverage on medium and large libraries:

1. **Per-keystroke full-registry lowercasing & rebuilding**: `CommandCenter.tsx` invokes `buildCommandRegistry` on search rather than memoizing stable descriptors, and `registry.tsx::matchCommands` repeatedly lowercases `label`, `aliases[]`, `keywords[]`, and `description` + runs Levenshtein `fuzzyMatch` per token (~41 ms per search in `registry-match-full-registry` baseline).
2. **Hard scan caps cause silent blind spots**: Prior freeze mitigations introduced `maxDocsToScan = 500` and `maxExtractsToScan = 500` in `CommandCenter.tsx`, causing documents and extracts beyond the first 500 items to be silently invisible to full-text search.
3. **Expensive main-thread work during search**:
   - `CommandCenter.tsx` awaits up to 3 `fetchYouTubeTranscript` Tauri IPC calls inline *before* scanning documents.
   - `getHtmlText(doc)` calls `new DOMParser().parseFromString(...)` synchronously on the main thread during keystroke handling.
   - Secondary search hits (pages, chapters, timestamps) are computed inside JavaScript loops rather than indexed in SQLite.
4. **Unused SQLite FTS5 backend & missing transcript FTS coverage**: `commands/search.rs::fts_search` already exists on Rust SQLite (`document_search`, `extract_search`, `rss_articles_fts`) but is never invoked by `CommandCenter.tsx`; meanwhile, transcripts stored in `youtube_transcripts`, `video_transcripts`, `podcast_transcript_segments`, and `transcript_segments` are only searchable in FTS5 when mirrored in `documents.content`.

Notice: This change **supersedes and consolidates** the incomplete/invalid legacy drafts `openspec/changes/command-palette-perf` and `openspec/changes/fix-command-palette-freeze-linux` into an FTS5-backed, completeness-preserving two-stage search architecture.

## What Changes

- **Two-stage search architecture**:
  - **Stage A (Immediate / <16ms local)**: Memoized + pre-indexed `CommandRegistry` (`prepareCommandIndex`), URL/X-thread detection, scope `#` help, contextual actions, and fast local title/recent matching render immediately on open and keystroke with zero waiting for backend IPC.
  - **Stage B (Indexed SQLite FTS5 backend)**: New unified Tauri command `palette_search` searching the **entire library** via SQLite FTS5 (`document_search`, `extract_search`, `transcript_search_fts`, `semantic_chunks_fts`, `rss_articles_fts`, and learning cards) in a single round-trip with BM25 ranking, snippets, category/tag/type/filter support, and exact anchors (`pdf` page, `epub` CFI, `youtube`/`video`/`audio` millisecond timestamps, `html`/`markdown` text quotes).
- **Cancel/supersede stale searches**: Monotonic generation tokens and single-flight coalescing ensure superseded keystrokes, scope changes, or closing the palette drop stale responses cleanly.
- **Keep HTML/transcript parsing off the JS keystroke path**: Maintain plain-text stripping/FTS indexing (`transcript_search_fts` + HTML strip on ingest/sync in Rust, lightweight fallback only in web-demo mode) and remove inline `fetchYouTubeTranscript` and `DOMParser` loops from `handleSearch`.
- **Responsive UI & bounded DOM**: Immediate input focus on palette open, incremental/bounded result list rendering preserving keyboard navigation, secondary hit selection, View All, scope pills, advanced filters, Ask Plethora handoff, and `#` help.

## Capabilities

### Modified Capabilities

- `command-palette-navigation`: Two-stage palette search with immediate focus, keystroke superseding/cancellation, full-library completeness without scan caps, and preserved contextual actions/secondary hits.
- `command-registry`: Pre-indexed prepared command matching eliminating per-keystroke allocations and rebuilds while preserving exact/alias/prefix/keyword/fuzzy/description tiers.
- `full-text-search`: Unified `palette_search` SQLite FTS5 backend covering all library documents, extracts, flashcards, RSS articles, transcripts, and `semantic_chunks_fts` with no 500-item scan cutoff.
- `transcript-search-integration`: Dedicated `transcript_search_fts` triggers/backfill over `youtube_transcripts`, `video_transcripts`, `podcast_transcript_segments`, and `transcript_segments` returning timestamped snippets without live network fetches.

## Impact

- **Database / Rust**: Additive Migration `151_palette_transcript_fts` in `src-tauri/src/database/migrations.rs`, unified `palette_search` in `src-tauri/src/commands/search.rs` (+ `lib.rs` registration).
- **Frontend / TypeScript**: `src/commandPalette/registry.tsx` (prepared index), `src/components/search/CommandCenter.tsx`, `src/components/search/GlobalSearch.tsx`, `src/components/search/palette/PaletteResults.tsx`, `src/api/search.ts` (typed wrapper).
- **Superseded drafts**: `command-palette-perf` and `fix-command-palette-freeze-linux` (workarounds such as `maxDocsToScan = 500` are replaced cleanly).
