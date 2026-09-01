## Why

Linux release memory profiling shows that closing all document tabs leaves roughly 1 GiB of WebKit/renderer memory above the pre-open idle baseline, with a slow web ratchet across repeated open/close cycles. The prior `bound-runtime-memory-and-gate` change fixed native-side leaks and added the harness, but release post-close retention and measurement gaps remain. Users on memory-constrained Linux machines experience sustained footprint long after closing documents.

## What Changes

- Profile and fix renderer-side retention after tab close (global caches, reflow assets, PDF session state, WebKit backing stores) without changing visible reader behavior.
- Tighten post-close and cycle-ratchet success criteria for **release** builds using measured harness thresholds.
- Improve the memory harness: correct WebKit process role classification on Linux (15-char `comm` truncation), record `buildProfile` (`debug` vs `release`) in output JSON, and add release-profile baselines to the gate.
- Complete the profiling tasks deferred from `bound-runtime-memory-and-gate` (WebKit heap snapshots, targeted heaptrack on native debug ratchet) to drive fixes with evidence rather than guesses.
- Document investigation findings and release thresholds in `docs/memory-profile.md`.
- **No regressions**: password prompts, outlines, OCR/reflow, text selection, tab position restore, `readerTabCap` eviction semantics, TTS cache bounds, PDF range transport, existing unit/integration tests, `npm run bench:check`, and functional PDF/EPUB flows must remain intact.

## Capabilities

### New Capabilities

- `linux-release-memory-retention`: Release-profile memory budgets, post-close reclamation targets, and cycle-ratchet bounds for Linux.

### Modified Capabilities

- `reader-memory-lifecycle`: Tighten post-close and cycle-ratchet requirements with release-measured tolerances; add explicit global-cache eviction on tab close.
- `memory-benchmark-harness`: Fix WebKit role detection, record `buildProfile`, and gate on release baselines separately from debug.
- `performance-benchmark-gate`: Add `scripts/memory-baselines.json` release entries and wire `bench:memory:check` into the no-regression gate.

## Impact

- **Frontend**: `PDFViewer`, `pdfDocumentHolder`, `reflowAssets`, `documentStore`, tab lifecycle hooks.
- **Harness**: `scripts/memory-bench/` (role classification, metadata, baseline compare).
- **Docs**: `docs/memory-profile.md`.
- **CI/local gate**: `scripts/memory-baselines.json`, `npm run bench:memory:check`.
- **Out of scope**: Changing `readerTabCap` default, unmounting inactive tabs, or platform changes outside Linux release profiling path.

**Supersedes** deferred `bound-runtime-memory-and-gate` tasks 4.4–4.6 (heap snapshot workflow), 8.7–8.8 (Linux release baselines), with implementation tracked in this change.
