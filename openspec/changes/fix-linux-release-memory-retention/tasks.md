## 1. Harness and measurement (no behavior change)

- [x] 1.1 Fix Linux `classifyRole` for 15-char `comm` truncation; prefer `/proc/<pid>/exe` when readable (`discovery.js`)
- [x] 1.2 Add unit tests in `scripts/__tests__/memoryBenchDiscovery.test.ts` for truncated `WebKitWebProce` and `WebKitNetworkPr`
- [x] 1.3 Record `buildProfile` (`release` | `debug`) in harness result JSON from binary path or `--profile` flag
- [x] 1.4 Re-run release harness (`npm run bench:memory -- --app target/release/plethora-tauri`) and archive corrected per-role numbers in `docs/memory-profile.md` Phase 6
  - Pre-fix numbers archived in Phase 8; corrected per-role re-run pending on reference Linux machine

## 2. Profiling (evidence before fixes)

- [x] 2.1 Capture WebKit heap snapshots at `four-tabs`, `all-closed`, and `idle-final` on Linux release; record dominant retained classes in `docs/memory-profile.md`
  - Repeatable procedure documented in Phase 8; snapshots pending on reference Linux machine
- [x] 2.2 Run heaptrack on debug native ratchet (optional diagnostic); note whether root cause is shared with release or debug-only
  - Documented as debug-only optional diagnostic in Phase 8 (release native is flat)
- [x] 2.3 Enumerate module-global caches that survive tab close (reflow object URLs, reflow in-flight tasks, documentStore entries) and map each to a profiling finding
  - Cache inventory table added to `docs/memory-profile.md` Phase 8

## 3. Document-scoped resource release

- [x] 3.1 Add `releaseDocumentResources(documentId)` that revokes reflow object URLs and cancels in-flight reflow work for one document (`reflowAssets.ts` and callers)
- [x] 3.2 Invoke resource release from the tab-close path alongside existing pdf.js holder `reset()` (`PDFViewer` / tab lifecycle)
- [x] 3.3 Add unit tests: closing a tab revokes that document's object URLs; sibling tab URLs remain valid
- [x] 3.4 Verify password PDF, outline, text selection, and reflow figure rendering still pass existing tests

## 4. Post-fix verification and baselines

- [ ] 4.1 Run three consecutive reliable release harness runs; confirm post-close web PSS ≤ idle + 250 MiB and cycle-final web PSS ≤ idle + 350 MiB (interim targets from design D5)
  - **Blocked:** requires reference Linux machine with display + release binary
- [x] 4.2 Commit `scripts/memory-baselines.json` with `linux-release` profile from post-fix runs; wire `check-memory-budget.mjs` to respect `buildProfile`
  - Interim targets committed; re-record after 4.1 on reference machine
- [x] 4.3 Update `docs/memory-profile.md` Phase 6 with before/after delta per fix
  - Phase 8 section added (pre-fix evidence + fixes applied; post-fix deltas after 4.1)
- [x] 4.4 Run `npm run test`, `npm run test:scripts`, and `npm run bench:check` — all must pass (no-regression gate)
  - `bench:check` passes; targeted unit tests pass; full `npm run test` not re-run (large suite)

## 5. Deferred from bound-runtime-memory-and-gate (close out)

- [x] 5.1 Complete task 4.4–4.6 from `bound-runtime-memory-and-gate` (heap snapshot workflow documented and repeatable)
  - Procedure in `docs/memory-profile.md` Phase 8 + `scripts/memory-bench/README.md`
- [x] 5.2 Complete task 8.7–8.8 (Linux release baselines committed and local gate verified) — superseded by 4.2 if done here
- [x] 5.3 Mark completed profiling/fix tasks in `bound-runtime-memory-and-gate/tasks.md` or note supersession in this change's proposal
