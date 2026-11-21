# PDF platform verification

## Implementation checks

| Check | Observed result |
|---|---|
| `openspec validate <change> --strict` | All five changes passed. |
| Focused Vitest run across PDF viewer, localization, Assistant context and Queue Scroll | 198 tests passed in 29 files. The viewer regression covers stale canonical data after a PDF switch and preserves native text when only a neighboring canonical page is ready. |
| `cargo test --offline --locked --lib -- ai_learning::indexer::tests ai_learning::chunker::tests study_trail::tests pdf:: pdf_mobile::tests --test-threads 4` | 186 passed. The scope includes physical pages, same-ordinal stored locator repair, sparse Reading Trail reconstruction, range-source identity, and the isolated rotation writer. |
| `npm run test:visual -- pdf-native-annotations.visual.spec.ts` | All three cases passed on Linux with a local Playwright configuration using system Chromium. Pointer and keyboard navigated to physical page 3. A sticky note opened, HTTPS attributes were checked without any external navigation, and AcroForm text and checkbox values survived remount. |
| `npm run build:check` | Documentation validation, TypeScript, production Vite build and bundle budgets passed. The build measured 30.4 MB of assets and one PDF worker. |
| Targeted ESLint with `--quiet` | Changed frontend, tests and browser harness passed. |
| `git diff --check` | Passed. |

QPDF accepted the synthetic blank, annotation and form fixtures. Poppler showed that physical page 2 was blank and text after it stayed on page 3. Independent inspection of the rotated copy confirmed page rotations of 0°, 90° and 0°, a working PDF destination to physical page 3, and an identical original SHA-256. The writer refused an encrypted input and an output alias of the original. Both sources retained their bytes.

The wider frontend run had three pre-existing viewer suite failures and seven Assistant section-suite failures, reproduced on clean HEAD `190ecc9a`. The Assistant tests use a mock that the streaming transport bypasses. The clean-HEAD rerun was network-isolated. Repository-wide ESLint reported errors outside the changed files, primarily in a generated Pocket TTS runtime and existing recording components.

The full Rust library run was stopped after more than six minutes. It had reported a failure in the unchanged DAQE scheduler latency test before termination. The exact latency test passed in isolation. The separate 186-test run covered the affected Rust modules to completion.

## Performance

The pre-change `npm run bench:check` passed the 83 repository benchmarks and bundle budgets. Both post-change runs kept all four PDF benchmark costs inside their limits. The first run exceeded the `reader-speech-index/build` and `kp-timeline/build` budgets during native compilation. The idle retry passed the speech-index item and exceeded three budgets in the unchanged startup timeline and the tab-switch benchmark, which uses placeholder tab content. No baseline values were changed.

A focused rerun of the three remaining cases alongside the noise anchor reproduced all three overages on clean HEAD. The normalized clean HEAD and working-tree costs were respectively 0.02003 and 0.02016 for timeline construction, 0.28038 and 0.28841 for its desktop sweep, and 0.63312 and 0.66817 for the tab switch.

| PDF benchmark | Before | Post-change retry | Budget with tolerance |
|---|---:|---:|---:|
| Point transform round trip | 0.07265 | 0.07020 | 0.1261 |
| Rectangle transform round trip | 0.04538 | 0.04447 | 0.060625 |
| Anchor by word ID | 0.14950 | 0.14380 | 0.3055 |
| Anchor by quote fallback | 0.07073 | 0.06807 | 0.12436 |

Costs are dimensionless `noise-anchor Hz / benchmark Hz`. The tolerance is defined by the repository baseline.

An independent local probe used the installed Rust `pdf-extract` build with 704 synthetic text pages and 11 timed repetitions. Median whole-document extraction took 792 ms and extraction of physical page 47 took 310 ms. Each timed path parsed the same in-memory bytes. These figures describe native extraction work on this fixture.

A single Linux Chromium dev-server probe on the same 704-page PDF measured 3.98 seconds for the first visible canvas on a warm-server reload. Five page jumps took 55–164 ms from Enter to a visible target canvas. A DOM observer recorded at most seven mounted canvases. These are indicative browser measurements on one synthetic text fixture. Native startup timing, scroll memory and scan-heavy PDFs still need separate measurements.

## Runtime qualification

The Chromium harness uses the production React PDF reader and PDF.js worker. Native Save As interaction, iOS, Android, macOS and Windows smoke tests remain unverified. ADB reported no attached device. Follow the [manual verification walkthrough](manual-verification.md) for native and mobile runs and for the OCR, reflow, Extract, cloze, Assistant and Study Plan round trips still on the program ledger.
