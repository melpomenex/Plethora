## Context

See `proposal.md` — Why for the observed numbers and the code-level candidates. The constraints that shape this design:

- **One window, one WebView, React-level tabs.** `TabContent.tsx` keeps every activated tab mounted and merely CSS-hides the inactive ones; the only unmount mechanism is `tabsStore`'s resident cap (`evictedTabIds`, default 8, `tabsStore.ts:328`). At four tabs nothing is ever unmounted, so "four tabs" means four fully live readers.
- **Two large processes to account for separately.** `incrementum-tauri` (Rust + GTK) and `WebKitWebProcess` are separate address spaces; pdf.js additionally runs in a worker inside the web process. A single aggregate number cannot tell us which side retains.
- **The existing gate cannot host this.** `scripts/check-perf-budget.mjs` normalizes throughput by an in-process noise anchor (`cost = anchorHz / benchHz`) because wall-clock is machine-dependent. Memory has no equivalent anchor — a slower machine does not use proportionally more memory — and the measurement requires a real GUI process tree, which the Node-only CI benchmark job explicitly avoids (`ci-regression.yml` installs no Rust toolchain or system packages). So memory needs its own producer, its own baseline shape, and its own venue, while reusing the gate's conventions: committed baselines, per-metric tolerances, an aligned report table, a pure comparator function that is unit-testable without shelling out, and non-zero exits.
- **Streaming precedent already exists.** EPUB streams over the loopback `epub_server`; mobile PDF already uses `PDFDataRangeTransport` over `get_pdf_document_source_info` / `read_pdf_document_range` (`nativePdfRangeTransport.ts`). Desktop PDF is the outlier that still reads whole files.
- **The production CSP already permits `connect-src http://127.0.0.1:*`**, so an in-app driver channel over loopback needs no security-config change.

## Goals / Non-Goals

**Goals:**

- Produce evidence, per process, that explains where the ~2.2 GiB lives before any fix is written, and keep that evidence in the repository.
- Make tab close and tab eviction actually release what they own, and prove it by measurement rather than by code reading.
- Remove whole-file document duplication across the IPC boundary on desktop, reusing the authorization model that already exists for ranges.
- Give the repository a memory number that a maintainer can reproduce, a threshold that fails on a doubling, and a ratchet check that fails on a slow leak.
- Reuse the existing gate's idioms so a contributor who has read `check-perf-budget.mjs` can read the memory gate without new concepts.

**Non-Goals:**

- Automating Heaptrack or WebKit heap snapshots. Both are one-off investigative procedures; they are documented and reproducible, not part of the gate.
- Gating memory on shared CI runners.
- A cross-platform memory baseline. Only Linux gets a collector in this change; macOS and Windows get a clean extension point and nothing else.
- Rewriting the tab system. The residency change layers on the existing `evictedTabIds` machinery.
- Reducing memory for content types the investigation does not implicate.

## Decisions

### D1 — Investigation gates the fixes, and its output is a committed artifact

Phase 1–4 produce `docs/memory-profile.md`: the data-flow map for an opened document, the Heaptrack findings for the native process, the heap-snapshot comparison (A idle / B tabs open / C tabs closed / D after cycles) for the web process, and an explicit count of simultaneous copies for a representative PDF. Every subsequent fix task cites the finding that justifies it.

This is not ceremony. The symptom — memory that *rises* after closing tabs — is consistent with at least four different mechanisms (live retention, worker-side retention, allocator high-water, engine caches), and the remedy differs for each. Committing the evidence also makes the eventual baseline defensible: a reviewer can see why 4-tab memory is what it is.

*Alternative rejected:* fix the obvious candidates first and measure after. It would very likely improve the numbers, and would leave us unable to say whether the remaining footprint is inherent or another bug — which is exactly the position we are in today.

### D2 — The scenario runs *inside* the app, driven over a loopback control channel

The driver process (`scripts/memory-bench/`) launches the app with `INCREMENTUM_MEMORY_SCENARIO=1` and `INCREMENTUM_MEMORY_CONTROL=http://127.0.0.1:<port>`. A build-flagged frontend module, mounted only when those variables are present, long-polls the driver for the next step (`open <corpusId>`, `closeTab <id>`, `closeAll`, `settle`, `quit`), performs it through the same store actions the UI uses, and reports completion plus its own quiescence signal. The driver stays outside the app and owns all `/proc` sampling, timing, and result writing.

Rationale: the operations we need are application-level ("open this document", "close this tab"), not pixel-level. Driving them through store actions makes runs deterministic regardless of window size, theme, animation, or scroll position, and gives the driver a trustworthy "this step is done" signal instead of a sleep. The outbound direction matters: the app connects *out* to the driver, so no new inbound listener is added to the application, and the existing CSP already allows it.

*Alternatives rejected:* (a) the WebKitGTK remote inspector protocol — available (`devtools: true`, Cargo `devtools` feature) but the protocol is WebKit-specific, version-sensitive, and would make the harness depend on an inspector wire format we do not control; we still document it for the manual heap-snapshot work, where it is the right tool. (b) WebDriver/`tauri-driver` — adds a toolchain, and still drives at the widget level. (c) Synthetic input events — non-deterministic and fragile.

*Safety:* the module is compiled out of, or inert in, release builds, and is gated on both environment variables being present. A test asserts that a production-configured build exposes no scenario surface.

### D3 — Process discovery is by launch marker, verified per candidate

The driver launches the app in its own process group (`setsid`-equivalent) with a unique marker variable, e.g. `INCREMENTUM_MEMORY_RUN_ID=<uuid>`. Discovery walks `/proc`, keeps candidates whose process group or ancestor chain reaches the launched PID, and then **verifies** each by reading `/proc/<pid>/environ` for the run id. Only marked processes are counted.

Rationale: parentage alone is not sufficient — WebKitGTK's auxiliary processes can be reparented, and a bare name match on `WebKitWebProcess` would silently absorb another application's browser. The marker is inherited by every descendant at exec time, so it is both necessary and sufficient, and it is trivially testable with a fake `/proc` tree.

Discovery re-runs at every sample, so processes that appear or exit mid-scenario are handled; an exited process is recorded as absent rather than failing the run.

### D4 — PSS is the headline number; every field is kept

Each sample reads `/proc/<pid>/smaps_rollup` and keeps `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, `Swap`. The tree total sums the *proportional* fields, never `Rss`, because the native process and the web process share a large amount of mapped library text and summing RSS double-counts it. `Pss_Anon` and `Private_Dirty` are kept alongside because they are the fields that distinguish "we allocated this" from "we mapped a big shared library".

Parsing is strict: each field comes from its labelled line with its unit; an unrecognized or missing field is reported absent, never defaulted to zero. A zero-valued default would read as an improvement, which is the worst possible failure mode for a memory gate.

### D5 — Sampling happens at an explicit settle point, and a settle timeout poisons the run

A stage settles when both hold: (a) the app reports quiescence — no in-flight document load, render, or persistence task; and (b) the tree's `Pss` varies by less than a configured fraction across three consecutive reads spaced a configured interval apart. Both parameters are recorded in the result. If the condition is not met within the timeout, the sample is still taken but the run is marked `reliable: false`, and the gate refuses to issue a verdict from an unreliable run.

Rationale: WebKit and the allocator both release lazily; sampling immediately after an operation measures scheduling luck. Marking rather than retrying keeps the failure visible — a run that never settles is itself a finding.

### D6 — Threshold policy: a clamped growth allowance

For each gated metric:

```
allowedGrowth = clamp(baseline × relativeAllowance, absoluteFloor, absoluteCeiling)
fail when measured > baseline + allowedGrowth
```

The floor stops a small metric from failing on jitter that is large in percentage terms but negligible in bytes. The ceiling stops a large metric from absorbing a big absolute regression behind a small percentage. Both are per-metric with documented defaults, derived from the variance observed across the baseline samples (Phase 8), and the effective threshold is printed with every failure.

*Alternative rejected:* the plain `max(percentage, absolute)` form, which is the common idiom. It satisfies the small-metric case but lets a 15% allowance on a ~1 GiB metric hide 150 MiB of regression — precisely the class of regression this change exists to catch. The plain `min` form has the mirror-image problem for small metrics. The clamp is the only shape that satisfies both spec scenarios.

### D7 — Ratchet criterion: post-warm-up reference, plus a slope

Peak thresholds cannot see a leak that stays under the peak. The repeated-cycle stages therefore get their own check over the post-warm-up cycles (warm-up boundary configurable, default: discard the first two cycles):

- `finalPss − reference > ratchetAllowance` → fail, where `reference` is the median of the first post-warm-up window.
- Ordinary-least-squares slope over the post-warm-up cycles exceeding `slopePerCycleAllowance` → fail.

Both are reported with the failure, in bytes and bytes-per-cycle, so "each cycle retains ~40 MiB" is legible directly from the output. Two criteria rather than one because a leak can present either as a steady climb (slope) or as a step that a short window's median absorbs (final-vs-reference).

### D8 — A separate baselines file and comparator, sharing the existing gate's shape

`scripts/memory-baselines.json` holds the metrics, their gated/diagnostic classification, their allowances, the variance and sample count each allowance came from, and a `machineProfile` block (OS + kernel, WebKitGTK version, CPU model, total RAM, app version + build profile, corpus hash set). `scripts/check-memory-budget.mjs` exports a pure `compareMemoryResults({ result, baselines })` — mirroring `comparePerfResults` — and a `main()` CLI that prints the aligned table and exits 1 on a gated failure, 2 when the input is unusable (missing result, unreliable run, machine-profile mismatch), with `--warn-only` for rollout, exactly as the throughput gate does.

*Alternative rejected:* extending `perf-baselines.json` and `check-perf-budget.mjs` in place. The two share no normalization model (cost ratios vs. bytes), no run venue (Node-only CI job vs. GUI Linux machine), and no failure semantics (a missing benchmark is a hard failure there; an absent auxiliary process is not here). Folding them together would mean one file whose entries obey two different rule sets. Sharing *conventions* rather than *code* keeps both readable; any genuinely common helper (table rendering, number formatting) is factored out rather than duplicated.

### D9 — Local run enforces; CI records

`npm run bench:memory` runs the scenario; `npm run bench:memory:check` runs it and evaluates the gate, exiting non-zero on a gated regression. The gate refuses to compare when the machine profile does not match the baseline's, so a maintainer on different hardware gets an explicit "cannot compare" rather than a false verdict.

CI gains a Linux job (Rust toolchain, WebKitGTK, `xvfb`) that builds the app, runs the scenario, uploads the result JSON, and prints the comparison in `--warn-only` mode. It is `continue-on-error` and is not a required check. The existing blocking benchmark job is untouched and does not depend on it.

Rationale: this is the decision recorded in the proposal. Shared runners differ in kernel, WebKitGTK build, available RAM, and cgroup pressure; gating on them would either flake or need tolerances so wide they would pass a 2× regression. Recording still gives a longitudinal series and catches an order-of-magnitude change.

### D10 — Desktop PDFs move onto the existing native range transport

`shouldUseNativeMobilePdfSource()` generalizes to a platform-agnostic predicate gated on a renamed feature flag (`nativePdfRangeSource`), enabled by default in the Tauri runtime on desktop and mobile alike. `DocumentViewer` stops calling `readDocumentFile()` for PDFs in the Tauri runtime and resolves a range source instead; `PDFViewer` already has the `useNativeRange` branch. The whole-file path stays as a fallback for sources the range path cannot resolve (a document with no imported-source record, or a range-source failure), and taking the fallback is recorded in `PdfDiagnostics` so a silent regression to whole-file loading shows up in diagnostics and in the benchmark.

`clonePdfData()`'s defensive copy is only needed on the whole-file path (it exists for WebView2 buffer detachment) and stays there; the range path never holds a whole-file buffer to clone.

*Risk-driven scope note:* this changes the load path for every desktop PDF. It is guarded by the feature flag, by keeping the fallback, and by tests covering password-protected documents, outline extraction, text-selection capability, OCR, and reflow — the features that read from the loaded document.

### D11 — A second, smaller cap for reader tabs, layered on the existing eviction machinery

`tabsStore` already computes `evictedTabIds` and `TabContent` already unmounts what is in that set. The change adds a *reader* classification and a second cap applied in the same place `applyResidentCap` runs: the general cap continues to govern all tabs, and the reader cap (new `general.readerTabCap` setting, default 2 — active plus one warm) additionally evicts the least recently used reader beyond it. Non-reader tabs are never evicted on account of the reader cap.

Eviction must not lose the user's place. Readers currently persist position on a schedule, so a reader that is unmounted between saves would lose the interval's progress. The reader's unmount path therefore flushes its current position through the existing position-persistence path before tearing down, and the flush is covered by a test that evicts mid-interval and reactivates.

*Alternatives rejected:* only-the-active-reader-mounted (cheapest memory, but makes the common alt-tab-between-two-documents flow pay a full reload every switch); leaving the mount policy alone (four tabs still hold four live documents, so the four-tab metric would stay hostage to per-document size).

### D12 — Corpus is provisioned, not committed

`.bench/corpus/` is populated from a checksummed manifest (`scripts/memory-bench/corpus.json`). The harness verifies every hash before running and refuses to run on a mismatch. Committing multi-megabyte PDFs would inflate the repository and the bundle-size story for no benefit. The manifest records where each item comes from and its hash; the untracked `demo/books/*.epub` files already present locally are candidates for the EPUB entries if they are adopted into the manifest.

### D13 — Ownership fixes first; allocator tuning only where Heaptrack proves it is warranted

If Heaptrack shows allocations that are *live* after tab close, that is a retention bug and is fixed at the source. Only for allocations Heaptrack shows as *freed while the process still holds the pages* is an allocator remedy (an explicit trim at a natural quiescence point, or an arena/threshold adjustment) considered — and then as an additive measure recorded in `docs/memory-profile.md` with the evidence, never as the primary fix. The same discipline applies on the web side: manual GC is a diagnostic tool for confirming reachability in a heap snapshot, not a remedy.

### D14 — Documentation lives in one place

`docs/memory-profile.md` carries the root causes, the architecture changes, how to run the benchmark, how memory is measured, the baseline values with their machine profile, the thresholds and how they were derived, and the deliberate re-record procedure. `README.md` and `docs/LINUX_WEBKITGTK.md` link to it rather than duplicating it.

## Risks / Trade-offs

- **The investigation may find that most of the footprint is engine-inherent, not ours.** → The evidence artifact is still the deliverable; the baseline is then recorded honestly against the improved implementation, and the thresholds still catch a doubling. What the change will not do is quietly re-label the current numbers as acceptable.
- **The desktop PDF source change touches every PDF open.** → Feature flag, retained fallback, diagnostics on fallback, and functional tests for password, outline, selection, OCR, and reflow paths. If range loading proves worse for some class of document, the flag flips without a release.
- **Reader eviction could lose reading position or feel slow.** → Position flush on unmount with a dedicated test; cap defaults to keeping one warm reader; tab-switch latency for evicted-and-restored readers is measured during Phase 6 and recorded, so the trade-off is a number rather than an opinion.
- **The harness could be flaky, and a flaky memory gate trains people to ignore it.** → Settle timeouts poison the run rather than producing a number; corpus hash mismatch refuses to run; machine-profile mismatch refuses to compare; CI never blocks on it. A refusal is always preferred to a plausible-looking wrong number.
- **Baseline rot as the maintainer's machine or distro changes.** → The machine profile is part of the baseline and a mismatch is reported explicitly; the re-record procedure is documented and produces a reviewable diff.
- **Scenario instrumentation could reach a release build.** → Build-flagged, double-gated on environment variables, and covered by a test asserting the surface is absent under a production configuration.
- **`smaps_rollup` requires a kernel that provides it** (4.14+) and permission to read it. → Absence is reported as an unsupported environment, not worked around by summing `smaps`, which would be a different measurement.
- **A bounded reader cap changes behavior users may notice** when they keep many documents open. → It is a setting with a documented default, and evicted tabs stay in the workspace with their state.

## Migration Plan

1. Land the harness and the `/proc` collector first, with no application changes. Run it against the current build to reproduce the reported numbers and confirm the harness sees what manual observation saw. This "before" run is archived as evidence, never as a baseline.
2. Land `docs/memory-profile.md` with the Heaptrack and heap-snapshot findings.
3. Land fixes in dependency order — disposal, then desktop range loading behind its flag, then the reader cap behind its setting — re-running the harness after each so each fix's contribution is attributable.
4. Only once the repeated-cycle scenario is bounded, record the baseline from multiple samples and commit `scripts/memory-baselines.json` with its machine profile and derived tolerances.
5. Enable the gate locally and add the non-blocking CI job.

**Rollback:** each application-side change is independently reversible — the range source and the reader cap are a feature flag and a setting; disposal fixes are additive. The harness, gate, and baselines are new files and scripts that can be removed without touching application code.

## Open Questions

- Which additional content types, if any, need their own scenario stage. Audio/video playback and the image registry each have separate paths, but whether any of them carries a large-memory path worth gating is a Phase 1 finding. Adding a stage later changes the corpus and baseline, not the harness or gate design.
- The exact repeated-cycle count. It must be large enough to expose a per-cycle ratchet and small enough to keep a run practical; the value is chosen from the Phase 7 data and recorded as the documented default.
- Whether `EMBEDDING_STORE` and the OCR runtimes are resident during a plain reading session. If they are not, bounding them is out of scope for this change and becomes a separate follow-up.
