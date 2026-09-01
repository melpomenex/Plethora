## Context

`bound-runtime-memory-and-gate` delivered pdf.js destroy-on-unmount, desktop PDF range transport, `readerTabCap`, TTS cache hardening, and the Linux memory harness. Release profiling on Kubuntu (Ryzen 5900X, 24 GiB, WebKitGTK) shows:

| Stage | Native PSS | Web/other PSS | Total PSS |
|-------|-----------|---------------|-----------|
| idle-fresh | ~900 MiB | ~986 MiB | ~1.9 GiB |
| four-tabs | ~902 MiB | ~2,298 MiB | ~3.2 GiB |
| all-closed | ~903 MiB | ~2,039 MiB | ~3.0 GiB |
| idle-final (after cycles) | ~903 MiB | ~2,184 MiB | ~3.1 GiB |

Native memory is flat across the scenario (no release leak). The user-facing problem is **renderer retention**: ~1 GiB web PSS remains after closing all tabs, with a slow ratchet across cycles. Debug builds additionally show a ~2.2 GiB native ratchet that never releases — a dev-quality issue, not production.

Code review confirms tab close is a true React unmount, but module-global caches survive close:

- `reflowAssets.ts` — `objectUrlCache` is global; `clearAssetUrlCache()` exists but is test-only.
- PDF reflow disk cache (Rust) — per-document entries may persist after close.
- `documentStore` thread cache — TTL-bounded, not per-tab.
- Inactive tabs stay mounted (by design); this change does not alter that.

The harness misclassifies WebKitGTK processes on Linux because `/proc/<pid>/comm` is truncated to 15 characters (`WebKitWebProce` ≠ `webkitwebprocess`), inflating the `other` bucket and hiding web-content trends.

## Goals / Non-Goals

**Goals:**

- Reduce release post-close web PSS to within a measured tolerance of pre-open idle.
- Bound the web ratchet across repeated open/close cycles.
- Evict document-scoped renderer caches (object URLs, in-flight reflow work) on tab close.
- Fix harness role classification and record `buildProfile` so release numbers are trustworthy.
- Commit release-profile baselines and wire them into `bench:memory:check`.
- Complete deferred profiling (WebKit heap snapshots) to validate each fix.

**Non-Goals:**

- Unmounting inactive tabs or changing `readerTabCap` default (2).
- Replacing WebKitGTK or changing Tauri/wry version.
- macOS-specific fixes (separate change track).
- Forcing `malloc_trim` or other allocator hacks as the primary fix.
- Fixing debug-only native ratchet unless profiling shows a shared root cause.

## Decisions

### D1 — Profile before patching: WebKit heap snapshots drive the fix list

**Choice:** Run WebKit heap snapshots at `four-tabs`, `all-closed`, and `idle-final` before landing renderer fixes. Each fix task cites the retained object class it targets.

**Alternatives:** Patch `objectUrlCache` immediately based on code review alone.

**Rationale:** Post-close retention may include WebKit backing stores and JIT caches we cannot see from JS module globals alone. Profiling prevents fixing the wrong layer and documents the delta per fix in `docs/memory-profile.md`.

### D2 — Document-scoped cache eviction on tab close, not global cache flush

**Choice:** Introduce a `releaseDocumentResources(documentId)` hook invoked from the tab-close path (alongside existing pdf.js `reset()`). It revokes object URLs and cancels in-flight reflow work for that document only. Other open tabs are untouched.

**Alternatives:** Call `clearAssetUrlCache()` globally on any close; periodic full GC nudges.

**Rationale:** Global flush would break sibling tabs sharing no resources but could still race with warm inactive tabs. Per-document scoping matches the existing `assetCacheKey(documentId, blockId)` pattern and satisfies the sibling-tab scenario in `reader-memory-lifecycle`.

### D3 — Prefix-match WebKit role classification on Linux

**Choice:** Extend `classifyRole` to treat truncated `comm` values via prefix rules (`webkitwebpro`, `webkitnetworkp`) and prefer `/proc/<pid>/exe` or `cmdline` when available for full executable name.

**Alternatives:** Require a native helper binary on Linux (macOS pattern).

**Rationale:** Minimal change, testable with synthetic `/proc` trees; restores correct web-content aggregation without new dependencies.

### D4 — Release-only hard gates; debug as diagnostic

**Choice:** `scripts/memory-baselines.json` records a `linux-release` profile. Hard gates apply to release builds only. Debug native ratchet is a diagnostic row until a fix is proven.

**Alternatives:** Gate both profiles equally.

**Rationale:** Production truth is release. Debug allocator behavior differs; gating debug would create false CI failures without helping users.

### D5 — Thresholds derived from post-fix measurement, with interim headroom

**Choice:** Land fixes first on the reference machine, then record baselines from three consecutive reliable runs. Interim acceptance during development: post-close web PSS ≤ idle web PSS + 250 MiB; cycle-final web PSS ≤ idle web PSS + 350 MiB.

**Alternatives:** Copy pre-fix numbers as baselines (would encode the bug as acceptable).

**Rationale:** Baselines must reflect corrected behavior per `performance-benchmark-gate` spec.

### D6 — No-regression contract enforced by existing suites

**Choice:** Every phase ends with `npm run test`, targeted PDF/EPUB tests, and `npm run bench:check`. Memory gate runs locally before merge; not added to GitHub Actions per repo policy.

**Rationale:** User requirement is explicit: fix retention without breaking reader behavior.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Evicting reflow assets breaks re-open performance | Keep Rust disk cache; only revoke in-memory object URLs. Re-open fetches from disk cache, not re-render. |
| WebKit retains memory regardless of JS cleanup | Heap snapshots quantify irreducible WebKit pool; document residual as known high-water in `memory-profile.md` rather than chasing unreachable memory. |
| Baselines machine-specific | Gate compares profile fields; mismatch reports skip verdict, same as CPU bench gate. |
| Inactive mounted tabs hold memory by design | Out of scope; `readerTabCap` already bounds resident readers. |
| Fix improves release but not debug native ratchet | Track as diagnostic; separate heaptrack task if no shared cause. |

## Migration Plan

1. **Phase 0 — Measurement:** Harness fixes + record pre-fix release numbers in `docs/memory-profile.md` Phase 6.
2. **Phase 1 — Profile:** WebKit heap snapshots at key stages; enumerate retained JS object classes.
3. **Phase 2 — Targeted fixes:** Per-document eviction, cancel in-flight reflow, verify pdf.js worker teardown; one fix per commit where possible.
4. **Phase 3 — Verify:** Three reliable release harness runs; commit `scripts/memory-baselines.json`; run full regression suite.
5. **Rollback:** Revert individual fix commits; baselines diff is reviewable in git.

## Open Questions

- What fraction of post-close retention is WebKit pool vs revocable JS caches? (Resolved in Phase 1 profiling.)
- Should Rust-side `pdfReflow` asset entries be LRU-bounded globally? (Decide after measuring disk + mmap contribution.)
- Is the first-document open spike (+1.1 GiB web for a tiny PDF) amortized JIT or corpus-specific? (Record in Phase 6; may be a separate optimization if post-close target is met.)
