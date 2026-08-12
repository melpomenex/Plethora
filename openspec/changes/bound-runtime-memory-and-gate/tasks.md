## 1. Map the memory and data lifecycle (Phase 1)

- [x] 1.1 Document the tab model in `docs/memory-profile.md`: single window / single WebView, React-level tabs in `TabContent.tsx`, CSS-hidden inactive tabs, the `evictedTabIds` resident cap in `tabsStore.ts` and its default of 8, and exactly what mounts, stays mounted, and unmounts on activate / deactivate / close.
- [x] 1.2 Trace and document the byte path for a PDF on desktop end to end: `DocumentViewer.loadDocumentData` → `documentsApi.readDocumentFile` → `read_document_file` (`tokio::fs::read`) → binary IPC → `new Uint8Array(buffer)` → `new Uint8Array(rawBytes)` → `clonePdfData` → `pdfjsLib.getDocument` → worker transfer, naming every simultaneous copy and where each lives (native heap, web-process heap, worker heap).
- [x] 1.3 Trace and document the byte path for EPUB (loopback `epub_server`), and for each other content type with its own loading path (image registry, audio/audiobook via `media_server`, local video, transcripts). Record which of them can hold a whole file in memory.
- [x] 1.4 Inventory frontend retention: which reader objects are stored in React state or refs and never disposed (start from `setPdf(pdfDoc)` in `PDFViewer.tsx` having no matching `destroy()`), which stores hold document-sized values, and which listeners / observers / timers / subscriptions / promises can keep a reader instance reachable after its tab closes.
- [x] 1.5 Inventory native retention: process-global state (`EMBEDDING_STORE`, `EMBEDDING_CACHE`, OCR runtime `OnceLock`s, loopback server state, scheduler and sync managers), any per-document cache, and any unbounded map / vec / channel / task-owned buffer. Record which are reachable during a plain reading session.
- [x] 1.6 Write the Phase 1 section of `docs/memory-profile.md` and confirm the architecture claims in `proposal.md` and `design.md` against it, correcting either document if the code says otherwise.

## 2. Memory collection for Linux (Phase 2, collector half)

- [x] 2.1 Create `scripts/memory-bench/` and implement a `smaps_rollup` parser that reads `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, `Swap` from labelled lines with units, reporting unknown or absent fields as absent rather than zero.
- [x] 2.2 Unit-test the parser against fixture rollup files: a normal file, a file missing optional fields, a file with an unexpected unit, and a malformed file. Assert absent fields are absent and malformed input produces an attributed error.
- [x] 2.3 Implement process discovery: walk `/proc`, keep candidates reachable from the launched PID by process group or ancestor chain, and verify each by reading the run-id marker from `/proc/<pid>/environ`. Classify each process by role (native, web content, network, other).
- [x] 2.4 Unit-test discovery against a synthetic `/proc` fixture tree covering: an unrelated application's web-content process with the same executable name (excluded), a reparented marked child (included), a process appearing only in later samples (included), and a process that exits between discovery and sampling (recorded absent).
- [x] 2.5 Implement the sample aggregator: per-process entries plus a tree total summed from proportional fields, never from `Rss`. Unit-test that the total is a PSS sum and that an absent process does not fail the sample.
- [x] 2.6 Implement the platform gate: on a non-Linux platform, or where `smaps_rollup` is unavailable, report an unsupported environment and produce no result file.

## 3. Scenario driver and in-app instrumentation (Phase 2, driver half)

- [x] 3.1 Add the build-flagged frontend scenario module, mounted only when both `INCREMENTUM_MEMORY_SCENARIO` and `INCREMENTUM_MEMORY_CONTROL` are present, that long-polls the driver for steps and executes them through the same store actions the UI uses (`open <corpusId>`, `closeTab`, `closeAll`, `settle`, `quit`).
- [x] 3.2 Implement the app-side quiescence signal: no in-flight document load, render, or position-persistence task. Report it to the driver with each step completion.
- [x] 3.3 Add a test asserting the scenario surface is absent (or inert) under a production configuration and when the environment variables are missing.
- [x] 3.4 Implement the driver: launch the app in its own process group with the run-id marker and control URL, serve the step protocol, and terminate the app at the end of the scenario.
- [x] 3.5 Implement the settle protocol: wait for app quiescence plus three consecutive tree-`Pss` reads within the configured fraction at the configured interval; on timeout, still sample but mark the run `reliable: false` with the reason.
- [x] 3.6 Implement the fixed scenario stages in order: fresh idle, one document, two tabs, four tabs, all closed, N single-document open/close cycles, N multi-document open/close cycles, final idle. Make the cycle count configurable with a documented default.
- [x] 3.7 Implement corpus provisioning: `scripts/memory-bench/corpus.json` with per-item source and content hash, population into `.bench/corpus/`, hash verification before every run, and refusal (non-zero exit, both hashes named) on mismatch. Include at least one representative PDF and one representative EPUB.
- [x] 3.8 Implement the result writer: every sample keyed by stage and cycle index, plus the environment block (OS + kernel, WebKitGTK version, app version + build profile, CPU model, total RAM, display server, cycle count, corpus identity, settle parameters) and the `reliable` flag.
- [x] 3.9 Add `npm run bench:memory`, and unit-test the driver's failure paths: a stage whose document fails to open, an application that exits mid-scenario, and a settle timeout — each must exit non-zero or mark the run unreliable rather than emitting a clean-looking result.
- [ ] 3.10 Run the harness twice against the unmodified build and confirm the two runs perform identical operations and agree within measurement variance.

## 4. Reproduce and profile (Phases 2–4)

- [ ] 4.1 Run the full scenario against the current build and archive the result as the "before" evidence in `docs/memory-profile.md`. Confirm it reproduces the reported four-tab and post-close numbers.
- [ ] 4.2 Profile the native process with Heaptrack across launch → idle → open → four tabs → close all → repeated cycles → quit. Record peak consumers, long-lived allocations with call stacks, allocations still live after close, and the largest buffers with their owners.
- [ ] 4.3 From the Heaptrack data, classify the native footprint into live-and-reachable, freed-but-allocator-resident, and cache high-water. Record the classification and the evidence for each bucket.
- [ ] 4.4 Take WebKit Web Inspector heap snapshots at A (fresh idle), B (four tabs open), C (tabs closed), D (after repeated cycles). Compare retained sizes for `ArrayBuffer`, `Uint8Array`, `Blob`, pdf.js objects, epub.js `Book` / `Rendition`, `Document`, detached DOM trees, `HTMLCanvasElement`, `ImageData`, event listeners, reader components, and store objects.
- [ ] 4.5 For every object class still retained at snapshot C, record the retaining path that prevents reclamation.
- [ ] 4.6 Distinguish JS-heap retention from native WebKit backing stores (canvas, decoded images, rendering surfaces) so the web-process number is attributed to the right layer.
- [ ] 4.7 Count the simultaneous copies of a representative large PDF between disk and pixels, per process, and record the total bytes resident per copy.
- [ ] 4.8 Complete `docs/memory-profile.md` Phases 2–4: root causes with evidence, per-process attribution, and the duplication count. Each fix task below must cite a finding from this document; drop or re-scope any fix task the evidence does not support.

## 5. Reader disposal (Phase 5, frontend)

- [x] 5.1 Destroy the pdf.js document and its loading task on `PDFViewer` unmount and on document change, including the case where the load is still in flight (abort the loading task, then destroy).
- [x] 5.2 Release per-page rendering state on unmount: page views, canvases, the rendered-page set, `textCacheRef`, and any decoded-page or reflow cache held by the viewer.
- [x] 5.3 Audit `EPUBViewer` teardown against the snapshot-C retaining paths and close whatever remains: `Rendition` / `Book` destruction ordering, the epub.js task queue, iframe content, and any listener that outlives them.
- [x] 5.4 Revoke every object URL created for a document on disposal, and add a test that no object URL created by a reader survives its unmount.
- [x] 5.5 Disconnect observers, clear timers, remove listeners, and abort in-flight requests owned by a reader on unmount; verify each against the Phase 4 retaining paths.
- [x] 5.6 Add tests that closing one reader tab disposes its resources and leaves sibling tabs rendering and interactive.
- [x] 5.7 Add a test that closing a tab mid-load cancels the pending load, issues no further backend requests, and surfaces no user-visible error.
- [ ] 5.8 Re-run the harness and record the delta attributable to disposal alone.

## 6. Desktop document byte transfer (Phase 4 fix)

- [x] 6.1 Generalize `shouldUseNativeMobilePdfSource` into a platform-agnostic predicate behind a renamed `nativePdfRangeSource` feature flag, defaulting on in the Tauri runtime for desktop and mobile.
- [x] 6.2 Route desktop PDF loading in `DocumentViewer` through the range source instead of `readDocumentFile`, keeping the whole-file path as an explicit fallback.
- [x] 6.3 Record fallback use in `PdfDiagnostics` with the reason, so a silent regression to whole-file loading is observable.
- [x] 6.4 Verify range access preserves the existing authorization scoping: an unauthorized document is refused, and a source whose identity changed fails rather than returning mixed content. Add tests for both.
- [x] 6.5 Add tests that a password-protected document, outline extraction, text-selection capability, OCR, and reflow all behave through the range path as they did through the whole-file path.
- [x] 6.6 Add a test that opening a large PDF transfers less than the file size and that only requested ranges are fetched.
- [x] 6.7 Confirm `clonePdfData`'s defensive copy remains only on the whole-file fallback path.
- [ ] 6.8 Re-run the harness and record the delta attributable to range loading.

## 7. Native-side lifecycle (Phase 5, Rust)

- [x] 7.1 Release per-document backend state when the last tab holding a document closes: cached buffers, handles, background tasks, and channels identified in task 1.5 and confirmed in 4.2.
- [x] 7.2 Bound any cross-document backend cache the evidence implicates, with an explicit configured bound and eviction that cannot break a currently open document. Add tests for the bound and for eviction safety.
- [ ] 7.3 If — and only if — Heaptrack shows freed-but-retained pages rather than live allocations, add the allocator remedy at a natural quiescence point and record the evidence for it in `docs/memory-profile.md`.
- [x] 7.4 Add a Rust test that per-document state is dropped and its background tasks cancelled when the document is released.
- [ ] 7.5 Re-run the harness and record the native-side delta.

## 8. Bounded reader residency (Phase 6)

- [x] 8.1 Add a reader-tab classification and a `general.readerTabCap` setting (default 2: active plus one warm), with its settings UI entry and locale strings.
- [x] 8.2 Apply the reader cap alongside the existing resident cap in `tabsStore`, evicting the least recently used reader beyond it and leaving non-reader tabs governed only by the general cap.
- [x] 8.3 Flush the reader's current position through the existing persistence path on unmount, so eviction between scheduled saves cannot lose progress.
- [x] 8.4 Restore the document, reading position, reader display settings, and outline state when an evicted reader tab is reactivated.
- [x] 8.5 Add tests: opening past the cap evicts the least recently used reader; alternating between two readers within the cap reloads neither; a non-reader tab evicts no reader; an evicted tab stays listed in the workspace.
- [x] 8.6 Add tests: position survives eviction; a position advanced mid-interval survives eviction; a reactivated reader's content, position, and selection-capability state match one that stayed mounted.
- [ ] 8.7 Measure tab-switch latency for a warm reader and for an evicted-and-restored reader, and record both numbers in `docs/memory-profile.md` as the memory/latency trade-off.
- [ ] 8.8 Re-run the harness and record the four-tab delta attributable to the reader cap.

## 9. Repeated-use verification (Phase 7)

- [ ] 9.1 Run the repeated single-document and multi-document cycle stages at the chosen cycle count and confirm memory converges rather than growing per cycle, on both processes.
- [ ] 9.2 Confirm live object counts (reader instances, rendering surfaces, document objects) after the cycles equal the count expected for the tabs actually open, and do not change when the cycle count is doubled.
- [ ] 9.3 Confirm native live allocations after the cycles do not grow linearly with cycles, using a Heaptrack run over the cycle sequence.
- [ ] 9.4 Choose and record the default cycle count: large enough to expose a per-cycle ratchet, small enough to keep a run practical. Resolve the corresponding open question in `design.md`.

## 10. Baseline recording (Phase 8)

- [ ] 10.1 Run the memory benchmark repeatedly against the fixed build (minimum sample count recorded with the results) and collect the samples.
- [ ] 10.2 Compute the observed variance per metric and derive each metric's relative allowance, absolute floor, and absolute ceiling from it.
- [ ] 10.3 Record the machine profile: OS + kernel, WebKitGTK version, CPU model, total RAM, app version and build profile, corpus hash set.
- [ ] 10.4 Write `scripts/memory-baselines.json` with per-metric baseline, allowances, observed variance, sample count, gated/diagnostic classification, ratchet parameters, and the machine profile.
- [ ] 10.5 Sanity-check the thresholds: a synthetic doubling of each gated metric fails, and repeated unchanged runs on the baseline profile pass.

## 11. Memory gate (Phase 9)

- [x] 11.1 Implement `scripts/check-memory-budget.mjs` with a pure exported `compareMemoryResults({ result, baselines })` and a `main()` CLI, mirroring the structure and exit-code conventions of `scripts/check-perf-budget.mjs` (1 on gated failure, 2 on unusable input, `--warn-only`).
- [x] 11.2 Implement the clamped threshold policy: `allowedGrowth = clamp(baseline × relative, absoluteFloor, absoluteCeiling)`, failing when `measured > baseline + allowedGrowth`.
- [x] 11.3 Implement the ratchet criterion over post-warm-up cycles: final-versus-reference growth allowance and an ordinary-least-squares slope allowance, each reported in bytes and bytes-per-cycle.
- [x] 11.4 Implement gated-versus-diagnostic metric classification, with the classification visible in the report and diagnostic metrics never affecting the exit status.
- [x] 11.5 Implement machine-profile matching: refuse to issue a verdict on a mismatch, naming the differing fields, and exit 2.
- [x] 11.6 Implement refusal to issue a verdict from a run the harness marked unreliable.
- [x] 11.7 Implement the report: aligned baseline / current / change / status table in human-readable units, the machine profile it compared against, and — on failure — metric, baseline, measured, absolute delta, percentage delta, and the exceeded threshold.
- [x] 11.8 Implement handling for a metric in the baseline but absent from the result (failure) and a metric in the result with no baseline (warning plus the exact entry to paste).
- [x] 11.9 Write the machine-readable evaluation record alongside the harness result.
- [x] 11.10 Add `npm run bench:memory:check` and unit-test the comparator: ordinary variance passes; a doubling fails; a small metric's percentage jitter passes on the floor; a large metric's absolute regression fails on the ceiling; a per-cycle leak fails the ratchet while every peak metric passes; a bounded high-water mark passes; unreliable and mismatched-profile inputs exit 2.
- [x] 11.11 Assert that running the benchmark or the gate never modifies `scripts/memory-baselines.json`.
- [x] 11.12 Factor the shared table-rendering and number-formatting helpers out of `check-perf-budget.mjs` rather than duplicating them, leaving its behavior unchanged and its existing tests passing.

## 12. Continuous integration (Phase 9)

- [x] 12.1 Add a non-blocking Linux memory job to `.github/workflows/ci-regression.yml` (Rust toolchain, WebKitGTK, `xvfb`) that builds the app, provisions the corpus, runs the scenario, and runs the gate in `--warn-only` mode.
- [x] 12.2 Upload the harness result and the gate's evaluation record as build artifacts.
- [x] 12.3 Confirm the job is `continue-on-error` / not a required check, and that the existing blocking benchmark job is unchanged and does not depend on it.

## 13. Documentation (Deliverable 10)

- [ ] 13.1 Complete `docs/memory-profile.md`: root causes with evidence, the architectural changes made, how to run the memory benchmark, how memory is measured and why PSS, the baseline values with their machine profile, the thresholds and how they were derived, and the tab-switch latency trade-off.
- [x] 13.2 Document the deliberate baseline re-record procedure: the command, the minimum sample count, how tolerances are derived from variance, which machine-profile fields must be updated, and the expectation that the change is justified in the same pull request.
- [x] 13.3 Link `docs/memory-profile.md` from `README.md` and `docs/LINUX_WEBKITGTK.md`, and add a WebKitGTK-specific note there if the investigation implicated engine behavior.

## 14. Verification

- [ ] 14.1 Run the full scenario on the fixed build and record before/after per-process numbers for every stage in `docs/memory-profile.md`.
- [ ] 14.2 Confirm four reader tabs no longer resemble the pre-change multi-gigabyte footprint, and that post-close memory returns to within the post-close tolerance of pre-open idle.
- [ ] 14.3 Run `npm run test:run`, `npm run test:scripts`, the Rust test suite, `npm run lint`, and `npm run bench:check`, and confirm all pass.
- [ ] 14.4 Manually verify reader behavior on Linux: PDF and EPUB rendering, reading position, highlights and extracts, tab switching, session restore, and the fallback path with the range flag disabled.
