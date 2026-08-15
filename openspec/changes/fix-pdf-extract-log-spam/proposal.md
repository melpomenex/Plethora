# Proposal: fix-pdf-extract-log-spam

## Why

Opening any PDF floods stdout with millions of unconditional `println!` lines
from the `pdf-extract 0.7.12` dependency (e.g. `Unicode mismatch true f_f_i
"ffi" Ok("ﬃ") [64257]`, from `pdf-extract-0.7.12/src/lib.rs:461`). The line
fires for nearly every ligature glyph in a font's encoding-differences array —
and even prints after computing `nfkc` equality proving the mismatch is benign.
Because text extraction runs synchronously on document open
(`processor/mod.rs:33` and `ai_learning/indexer.rs:459`), each log line is a
locked, synchronous stdout write: terminals freeze rendering the output
(reproduced locally on macOS), and on Windows each write goes through conhost,
pegging a core and lagging the entire machine (GitHub issue #45). Upstream
`pdf-extract` already replaced these prints with `log` macros in v0.9.0, so the
fix is an upgrade plus a log-level filter, not a fork.

## What Changes

- Upgrade `pdf-extract` from `0.7` to `0.10.0` (first stable line with all
  hot-path `println!`s converted to `log` macros; v0.10.0 keeps
  `default-features = false` lopdf and both APIs we call).
- Add `.level_for("pdf_extract", log::LevelFilter::Error)` to the
  `tauri-plugin-log` builder in `src-tauri/src/lib.rs` so per-glyph `warn!`
  noise cannot flood the Stdout/LogDir targets; genuine per-document `error!`
  diagnostics stay visible.
- Add a lockfile guard script test asserting `pdf-extract` stays `>= 0.10.0`
  so a cargo update can never silently reintroduce the spam.
- Regression-check extraction output parity (text, per-page splitting) on
  fixture PDFs before/after the upgrade, since 0.7 → 0.10 changes extractor
  internals.

## Capabilities

### New Capabilities

- `pdf-text-extraction`: Quiet, bounded PDF text extraction — opening and
  indexing a PDF must not write per-glyph/unbounded output to stdout or log
  targets, must keep extraction CPU-bounded (existing timeouts), and must keep
  the extracted-text contract (whole-document text, per-page text) stable for
  consumers (word counts, HTML conversion, semantic indexer).

### Modified Capabilities

(none — `pdf-cover-rendering` and other existing specs are unaffected; no
spec-level behavior they cover changes.)

## Impact

- **Dependencies**: `src-tauri/Cargo.toml` `pdf-extract = "0.7"` → `"0.10"`;
  `Cargo.lock` gains `log` usage inside pdf-extract and a second lopdf version
  (pdf-extract 0.10 uses lopdf 0.38; our direct dependency stays 0.34 until a
  separate change dedupes it). New transitive deps: `postscript`, `euclid`,
  `type1-encoding-parser`.
- **Code**: `src-tauri/src/lib.rs` (one `.level_for` line);
  `src-tauri/src/processor/pdf.rs` unchanged (the two APIs we call,
  `extract_text_from_mem` / `extract_text_from_mem_by_pages`, exist in 0.10
  with compatible signatures).
- **Logging**: users running from a terminal see app logs only; Windows users
  (issue #45) no longer experience console-flood lag when opening PDFs.
- **Risk**: extractor output formatting may shift subtly between 0.7 and 0.10;
  mitigated by output-parity checks on fixture PDFs and the existing
  normalization heuristics + test suite.
