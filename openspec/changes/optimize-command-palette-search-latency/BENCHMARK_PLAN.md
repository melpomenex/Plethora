# Benchmark Plan: Command Palette Search Latency & Completeness

## 1. Existing Vitest Benchmarks (`src/commandPalette/palette.bench.ts`)

Baseline captured on HEAD (`5413c145bae02b0bbdadcbca1f53d711e49ba38d`):
- `commandPalette/resume-selection-3000-docs`: 6,003.55 Hz (mean 0.1666 ms, p99 0.4920 ms)
- `commandPalette/recent-selection-3000-docs`: 7,040.04 Hz (mean 0.1420 ms, p99 0.4372 ms)
- `commandPalette/scope-filter-2000-results`: 6,593.47 Hz (mean 0.1517 ms, p99 0.2600 ms)
- `commandPalette/registry-match-full-registry`: 24.36 Hz (mean 41.0509 ms, p99 45.6071 ms)

### Planned Extensions
1. Keep existing benchmark cases intact in `src/commandPalette/palette.bench.ts` using `seededRandom` from `src/test/bench-support.ts` and validate with `npm run bench:check` (updating `scripts/perf-baselines.json` only if intentional baseline updates are required).
2. Add synthetic Stage A matching + large-library Stage B mock/integration latency measurements at:
   - 100 documents
   - 1,000 documents
   - 10,000 documents + 5,000 extracts + 5,000 transcript segments

## 2. Rust SQLite FTS5 Benchmarks (`palette_search`)

In `src-tauri/src/commands/search.rs` tests / ignored perf helper:
- Populate deterministic synthetic SQLite databases at **100**, **1,000**, and **10,000** documents (+ extracts + `youtube_transcripts` + `podcast_transcript_segments` + `rss_articles`).
- Record p50 and p95 elapsed wall time (ms) across single-word, multi-word, prefix, punctuated (`C++`, `don't`, `foo:bar`), and timestamped transcript queries.
- Assert completeness: match injected specifically at item **#9,950 / 10,000** MUST be returned in top results (proving zero 500-item scan cutoff).

## 3. Target Thresholds

- `matchCommands` (prepared registry): **< 5 ms** p99 (down from 45.6 ms baseline).
- Rust `palette_search` SQLite FTS5 query at 10,000 docs: **< 50 ms** p95.
- Stage A synchronous result production in JS: **< 16 ms** p95 (single frame).
- Linux WebKitGTK / macOS WKWebView: report observed test results and explicitly mark live packaged binary/OS manual profiling as **NOT RUN** in headless CI.
