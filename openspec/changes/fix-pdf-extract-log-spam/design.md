# Design: fix-pdf-extract-log-spam

## Context

Text extraction for PDFs runs through `pdf-extract` 0.7.12
(`src-tauri/Cargo.toml`), called from four sites, all on user-facing paths:

- `processor::pdf::extract_pdf_content` — document open/import
  (`processor/mod.rs:33`)
- `processor::pdf::extract_pdf_pages_text` — semantic indexer
  (`ai_learning/indexer.rs:459`)
- `processor::pdf::extract_pdf_page` — per-page reads
- `processor::pdf::convert_pdf_to_html` / `save_pdf_as_html` — HTML export

Every call goes through `pdf_extract::extract_text_from_mem{,_by_pages}`
inside `tokio::task::spawn_blocking` with a 10s timeout. The 0.7.x crate
contains ~13 unconditional `println!` calls in its glyph-decoding hot path;
the one observed in the wild (`Unicode mismatch true f_f_i "ffi" Ok("ﬃ")
[64257]`, `lib.rs:461` in the crate) fires per glyph whose encoding
`Differences` name disagrees with the ToUnicode CMap — constant for ligature
fonts — and even after an `nfkc` comparison shows the mismatch is benign.
Per-character `accum`/`flush` prints (`lib.rs:1874/1905/1908`) exist on other
paths. Result: millions of synchronous, stdout-locked console writes per
document; the terminal freezes (macOS repro) and Windows conhost saturates a
core and lags the whole PC (issue #45; the release build is
`windows_subsystem = "windows"`, so this hits whenever a console is attached,
e.g. launched from cmd/PowerShell, and in dev builds).

Upstream state (verified against `jrmuizel/pdf-extract` tags): 0.8.2 still
prints; **0.9.0+ converts every hot-path print to `log` macros**; 0.10.0 and
0.12.0 keep both APIs we call. Our app already runs `tauri-plugin-log` with
per-module filters for chatty dependencies (`lib.rs:644-651`:
hyper/rustls/sqlx → Warn).

## Goals / Non-Goals

**Goals:**

- Opening/indexing any PDF produces no per-glyph or unbounded stdout/log
  output on any platform (fixes the terminal flood and issue #45).
- Keep the extracted-text contract stable for all four call sites.
- Make a regression back to a printing pdf-extract version impossible to
  merge silently.

**Non-Goals:**

- Deduplicating lopdf (pdf-extract 0.10 uses lopdf 0.38; our direct dep stays
  0.34). Harmless coexistence; a separate change can unify.
- Switching extractor libraries (pdfium/poppler), per-page streaming APIs, or
  any change to extraction *quality* beyond what the 0.7 → 0.10 upgrade
  carries.
- Touching PDF.js rendering (the viewer itself is unaffected; the spam comes
  from the Rust text-extraction side).

## Decisions

### D1: Upgrade `pdf-extract` to 0.10.0 instead of vendoring a patched 0.7.12

Alternatives considered:

1. **Upgrade (chosen).** Upstream already made exactly this fix; 0.10.0 is the
   newest release without 0.12's forced `lopdf.features = ["wasm_js"]`
   quirk (0.9/0.10 use `default-features = false`, cleaner for native and
   Android). Our API surface is two functions with compatible signatures; the
   error type is only ever `Display`ed. Keeps us on a maintained line with a
   `log`-based contract we can filter.
2. **Vendor patched 0.7.12 into `vendor/`** (the repo already does this for
   `burn-ndarray` and `macerator`). Zero extraction-output risk, but forks
   ~5k lines for a fix upstream shipped six releases ago, and re-introduces
   the merge burden on every future security/bug fix pull. Chosen only as
   fallback (see Risks R2).
3. **stdout gag around extraction** (dup2/SetStdHandle to null during the
   blocking call). Rejected: unsafe platform-specific global state, races
   between concurrent extractions (needs a global mutex), and it would also
   swallow our own diagnostics; it hides the symptom rather than fixing it.

### D2: Silence the module via `.level_for("pdf_extract", log::LevelFilter::Error)`

`tauri-plugin-log`'s global logger is initialized at `Info`, so without a
filter the upgraded crate's per-glyph `warn!` records would *still* flood
Stdout/LogDir/Logcat — the upgrade alone is necessary but not sufficient.
`error` (not `off`) keeps the encrypted-document guidance records visible for
diagnosing "empty text" reports. This extends the existing "silence chatty
dependency modules" block in `lib.rs` — same mechanism, same place.

### D3: Guard the dependency floor with a script test, not a Rust test

A `scripts/__tests__/*.test.ts` check (runs under `npm run test:scripts`)
parses `src-tauri/Cargo.lock` and asserts `pdf-extract >= 0.10.0`. A Rust
unit test can't reliably observe raw `println!` from another crate (no handle
interception without the same unsafe-gag machinery rejected in D1), and the
lockfile is the actual regression vector (`cargo update` or a loose `"0.7"`
spec). The test message names this change so a failure explains itself.

### D4: Output-parity check instead of golden-file locking

0.7 → 0.10 rewrites extractor internals (adds `postscript`, `euclid`,
`type1-encoding-parser`), so whitespace/line-breaking of extracted text may
shift. Consumers normalize aggressively (`normalize_extracted_text`,
`split_text_across_pages`, `has_usable_text`), so the parity gate is: for
each fixture PDF, pre-upgrade and post-upgrade extraction must agree on
(non-empty, usable-text status, page count, and ≥99% similarity after
normalization). Byte-identical golden files would over-constrain us against
upstream bug fixes.

## Risks / Trade-offs

- **R1: Extraction output shifts subtly (word counts, indexer chunks).** →
  D4 parity check on fixture PDFs (including a ligature-heavy one, e.g. a
  LaTeX-produced PDF) plus the existing `processor/pdf.rs` unit tests for the
  normalization/splitting chain. If drift is material, evaluate before merge;
  fallback is R2's vendor patch.
- **R2: 0.10.0 has an unknown regression for our PDF corpus.** → Fallback
  decision point in tasks.md: vendor 0.7.12 + strip prints (Option B) —
  bounded blast radius, existing `vendor/` convention.
- **R3: New transitive deps widen the build** (second lopdf, `postscript`,
  `euclid`). → Compile-time/binary-size cost only, no runtime behavior;
  Android build verified via the android-build skill pipeline. Note:
  `postscript`/`euclid` are pure Rust; no new FFI.
- **R4: `level_for` typo would silently disable the filter.** → Filter is
  covered by the spec scenario (warn records filtered, error records pass);
  implementation task includes a manual smoke: open the repro PDF with stdout
  attached and confirm zero `Unicode mismatch` lines.
- **R5: Windows-specific lag had a second contributor** (e.g. extraction CPU
  on huge PDFs). → Out of scope if confirmed: the 10s timeout already bounds
  CPU; issue #45's symptom matches console-write saturation, and removing the
  writes removes the saturation. Revisit the issue after release if reports
  persist.

## Migration Plan

1. Bump `Cargo.toml` (`pdf-extract = "0.10"`), update `Cargo.lock`, add the
   `.level_for` line.
2. Run parity checks + `cargo test -p incrementum` + `npm run test:scripts`.
3. Manual smoke: launch from terminal, open the ligature-heavy repro PDF,
   verify no spam and responsive UI; note results in the issue #45 thread.
4. Rollback: single revert commit; no data migrations, no persisted-state
   changes (extraction output is not persisted beyond derived word counts,
   which recompute on re-import).

## Open Questions

- None blocking. (Considered: 0.12.0 instead of 0.10.0 — deferred until it
  drops the forced `wasm_js` lopdf feature or we unify lopdf; upgrading again
  later is a one-line change plus the same parity gate.)
