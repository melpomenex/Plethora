# Tasks: fix-pdf-extract-log-spam

## 1. Baseline & dependency upgrade

- [x] 1.1 Capture pre-upgrade extraction baseline: run
       `extract_text_from_mem` and `extract_text_from_mem_by_pages` on the
       fixture PDFs (including a ligature-heavy one, e.g. a LaTeX-produced
       document) via a scratch `cargo test` or example binary, and save the
       normalized outputs (trimmed, form-feed split) for the parity check in
       task 3.2.
- [x] 1.2 In `src-tauri/Cargo.toml`, change `pdf-extract = "0.7"` to
       `"0.10"`; run `cargo update -p pdf-extract` and confirm
       `Cargo.lock` resolves `pdf-extract 0.10.x` (and note the new lopdf
       0.38 + `postscript`/`euclid`/`type1-encoding-parser` entries).
- [x] 1.3 `cargo check -p incrementum` — fix any compile fallout in
       `src-tauri/src/processor/pdf.rs` (the two called APIs are unchanged in
       0.10; expected fallout is none or type-name-only in error arms).

## 2. Log-filter and guard

- [x] 2.1 In `src-tauri/src/lib.rs`, extend the tauri-plugin-log "silence
       chatty dependency modules" block with
       `.level_for("pdf_extract", log::LevelFilter::Error)` (design D2).
- [x] 2.2 Add `scripts/__tests__/pdf-extract-floor.test.ts` (runs under
       `npm run test:scripts`): parse `src-tauri/Cargo.lock`, find the
       `pdf-extract` package, assert version >= 0.10.0, and fail with a
       message referencing openspec change `fix-pdf-extract-log-spam`
       (design D3). Include fixture cases for a 0.7.x lock (must fail) and a
       0.10+ lock (must pass).
- [x] 2.3 Run `npm run test:scripts` and confirm the new test passes against
       the upgraded lockfile and fails when pointed at a synthetic 0.7.x
       entry.

## 3. Verification

- [x] 3.1 `cargo test -p incrementum` — existing `processor::pdf` unit tests
       (normalization, form-feed splitting, usable-text heuristics) must
       pass unchanged.
- [x] 3.2 Output-parity check (design D4): compare post-upgrade extraction
       against the task 1.1 baseline per fixture — same usable-text status,
       same page count, ≥99% similarity after normalization. If drift is
       material, STOP and take the design R2 fallback (vendor 0.7.12 with
       prints stripped per the `vendor/` convention) instead of proceeding.
- [ ] 3.3 Manual smoke (spec scenarios): launch the app from a terminal with
       stdout attached, open the ligature-heavy repro PDF, verify zero
       `Unicode mismatch` lines on stdout, UI stays responsive, and word
       count / reading time still populate. Also confirm an encrypted PDF
       still surfaces its `error`-level record in the log file.
       (Partially verified programmatically: stdout of the extraction path is
       clean on all three fixtures — 482 lines on 0.7.12 vs 0 on 0.10.0 for
       ligature-mismatch.pdf — and new unit tests
       `test_extract_pdf_content_populates_text_and_metadata` /
       `test_extract_pdf_content_decodes_ligature_words` cover the metadata
       and ligature scenarios. Remaining manual step: GUI launch from a
       terminal with the user's original repro PDF.)
- [x] 3.4 Android build check: run the android-build pipeline (or at minimum
       `cargo check --target aarch64-linux-android`) to confirm the new
       transitive deps compile for mobile.
- [x] 3.5 Close the loop: comment the root cause and fix on GitHub issue
       #45 (println! flood → conhost saturation; fixed by pdf-extract 0.10 +
       module log filter) so the reporter can retest on the next release.
