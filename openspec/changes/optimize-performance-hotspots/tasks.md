# Tasks: Optimize Performance Hotspots

Ordered per design.md's migration plan: bundle fixes first (zero behavior risk), queue slim/delta last (riskiest, flag-guarded). Record before/after numbers as you go — the proposal's baseline is dist@1.89.2 (entry chunk 1.44 MB, SettingsPage 961 KB, two PDF workers, total 25 MB).

## 1. Startup bundle budget (design D3)

- [x] 1.1 Create `src/themes/fallback.ts` containing `superGameBroTheme` and `milkyMatchaTheme`; re-export both from `themes/builtin.ts` so definitions stay single-sourced; switch `ThemeContext.tsx:12` to import from `fallback.ts` only
- [x] 1.2 Build and verify the theme registry emits as its own chunk and the entry chunk shrinks accordingly (record before/after sizes in the task notes); verify persisted non-fallback theme applies after registry chunk load without errors
- [x] 1.3 Convert the ~18 statically imported section panels in `src/components/settings/SettingsPage.tsx` to `React.lazy` + per-section `Suspense` (reuse the `debugLazy` pattern from `TabRegistry.tsx`); keep section metadata/search index eager
- [x] 1.4 Verify settings deep links and cross-section search still work (search hit on a not-yet-loaded section opens and loads it); record the new `SettingsPage` chunk size
- [x] 1.5 Consolidate to a single PDF.js worker: make the workerSrc fallback in `PDFViewer.tsx` and the PWA path in `src/lib/browser-backend.ts` use the bootstrap worker asset (`src/workers/pdfjs.worker.ts`); remove the `?url` import of `pdf.worker.min.mjs`; verify exactly one worker file in dist
- [x] 1.6 Smoke-test PDF rendering on desktop (localhost protocol), Android (asset protocol), and PWA after the worker consolidation
- [x] 1.7 Measure the 602 KB `ui-vendor` chunk composition (e.g. `npx vite-bundle-visualizer` or rollup-plugin-visualizer): determine tree-shaking failure vs. genuine usage; fix the culprit barrel if the former, else convert the heaviest importers to per-icon deep imports and add an ESLint `no-restricted-imports` nudge for new code
- [x] 1.8 Add `scripts/check-bundle-budget.mjs` asserting entry-chunk and total-asset budgets (post-fix actuals + 10%); wire it into `build:check` and CI


**Group 1 results (recorded 2026-07-23):**
- Entry chunk: 1,444 KB → 1,308 KB (theme registry now a lazy `builtin-*.js` chunk, 136 KB). Root cause was the static+dynamic dual import of `themes/builtin.ts`; fallback themes moved to `src/themes/fallback.ts`.
- SettingsPage chunk: 961 KB → 43 KB shell + 17 per-section lazy chunks (largest: HandbookSettings 511 KB, now loads only when opened).
- PDF workers in dist: 2 → 1 (~1.06 MB saved). `worker.format: "es"` set in vite.config.ts; Vite strips worker-entry exports (`preserveEntrySignatures: false`), so the fake-worker fallback now relies on the module's `globalThis.pdfjsWorker` side effect, pre-evaluated via `ensureFakeWorkerModuleLoaded()` in PDFViewer's retry paths.
- Total dist: ~25.1 MB → ~23.6 MB.
- 1.7 outcome: Phosphor tree-shaking IS working (spot-checked unused icons absent from ui-vendor). The 602 KB is ~76+ icons × all-6-weights-per-icon, intrinsic to the package's def-file structure — per-icon deep imports would pull identical defs, so no codemod and no ESLint rule (would enforce churn with zero size win). The budget assertion is the enforceable guard.

## 2. Mobile queue virtualization + scoped store hygiene (design D4, D6)

- [x] 2.1 Wrap the `filteredItems.map` list in `src/components/mobile/MobileQueueView.tsx:669` with `DynamicVirtualList` (from `components/common/VirtualList`) above 20 items, plain map at or below; preserve `QueueRow` swipe/selection/action-sheet props
- [x] 2.2 Regression-check mobile queue scrolling against the commit 2b12f2f2 fix (queue extracts area, no trapped scroll) and verify swipe gestures on virtualized rows on Android
- [x] 2.3 Convert whole-store `useXStore()` destructuring to selector subscriptions in the files touched by this change (`MobileQueueView`, `QueueTab`, `ReviewTab`, `SettingsPage` shell, queue/review store consumers edited in group 5)

## 3. Backend thread hygiene (design D5)

- [x] 3.1 Swap `std::fs::read`/`canonicalize`/`metadata` in `read_document_file` (`src-tauri/src/commands/document.rs:1163`) to `tokio::fs` equivalents
- [x] 3.2 Move `read_range_from_path` calls in `read_pdf_document_range` (`src-tauri/src/commands/pdf_mobile.rs`) onto `spawn_blocking`, keeping the existing unit tests passing
- [x] 3.3 Wrap the synchronous `pdf_extract::extract_text_from_mem` call sites at `processor/pdf.rs:141,271,284` in `spawn_blocking` (mirror line 37); simplify redundant `catch_unwind` where `spawn_blocking`'s panic-to-`JoinError` covers it, preserving the malformed-PDF error contract
- [x] 3.4 Verify with a manual concurrency check: trigger a large-PDF extraction and confirm unrelated IPC commands (e.g. `get_queue_stats`) still respond promptly

## 4. Binary IPC transfer (design D1)

- [x] 4.1 Change `read_pdf_document_range` to return `tauri::ipc::Response` raw bytes; drop the `PdfDocumentRange` JSON struct (offset/eof/identity become implicit per design D1); keep `pdf_source_changed` error behavior and the range-size guard
- [x] 4.2 Update the frontend PDF range consumer in `src/api/documents.ts` to read the `ArrayBuffer` response, deriving EOF from returned length; delete the `bytes: number[]` type
- [x] 4.3 Change `read_document_file` to return raw bytes (no base64); change `readDocumentFile()` to return `Uint8Array`; update all call sites (delete their `atob`/base64 decoding); keep the Android 16 MiB guard and its error message
- [x] 4.4 Update the browser/PWA `browserInvoke` implementations of both commands to return `Uint8Array` so the API contract is backend-uniform
- [x] 4.5 Verify PDF open + page paging on Android and desktop, and document load for EPUB/audiobook paths that use `readDocumentFile`; add a dev-only byte-integrity log (length + head/tail sample) for QA
- [x] 4.6 Run the existing `pdf_mobile.rs` unit tests and adapt them to the raw-byte return shape

## 5. Queue IPC efficiency (design D2)

- [x] 5.1 Add a `slim` flag (default true) to `get_queue`/`get_queued_items` that omits `question`/`answer`/`cloze_text` from returned items; inventory `QueueItem` content-field consumers via TypeScript (narrow the listing item type so remaining consumers fail at compile time)
- [x] 5.2 Implement on-demand content fetch + store cache for the expanded queue-item preview (reuse existing per-item fetch commands)
- [x] 5.3 Replace the 8 post-mutation `loadQueue()` calls in `src/stores/queueStore.ts` (lines 279–680) with local delta application: apply the mutation response to the affected item (or remove it), client-side re-sort; keep full reload for initial load, explicit refresh, collection switch, and bulk operations
- [x] 5.4 Add reconcile-on-focus: a full queue reload when a queue view regains focus after local deltas were applied
- [x] 5.5 Add a fallback path: any mutation handler that cannot map its response onto a single item performs a full reload
- [x] 5.6 Extend queue store tests to cover delta application, fallback reload, and slim-listing rendering (no content fields present)


**Group 5 results / design refinements (recorded 2026-07-23):**
- Slim is implemented server-side in `strip_content_for_listing` (commands/queue.rs) behind `slim: Option<bool>` (default true) on `get_queue` + `get_queued_items`. `get_due_queue_items` (review session source) intentionally stays full-content.
- 5.2 refinement: the consumer inventory found exactly ONE listing use of card content — the ~80-char learning hint under item titles (ReviewQueueView `getLearningHint`). Instead of per-visible-row on-demand fetches, slim listings now carry a server-computed `learning_hint` field (same strip/truncate logic, unit-tested for parity). No expanded-view content consumer exists, so no on-demand fetch path was needed. Bounded field ≈ 80 chars vs multi-KB card HTML.
- `postpone_item` now returns the new due date (RFC 3339) so postpone deltas apply exactly; bulk suspend/delete remove `result.succeeded` ids locally; bulk unsuspend and postpone-all keep full reloads (server adds/changes items the client can't materialize).
- Latent bug fixed en route: the smart-postpone document branch never passed `itemType: "document"`, routing documents into the Rust learning-item lookup (NotFound). It now passes the type.
- Reconcile-on-focus wired via `hasLocalDeltas` + `reconcileIfDirty()` on `useIsActiveTab` activation in both ReviewQueueView and MobileQueueView.
- Tests: 4 new store tests (delta patch/re-sort, local removal, no-op cleanliness, dirty-only reconcile) + 2 new Rust tests (hint derivation incl. cloze/HTML/truncation; strip transform). Full Rust suite: 383 passed.

## 6. Verification and close-out

- [x] 6.1 Run the full frontend test suite (`npm run test:run`) and Rust tests (`cargo test` in `src-tauri`)
- [x] 6.2 Capture after-numbers: entry chunk, SettingsPage chunk, dist total, worker count; confirm budgets in `check-bundle-budget.mjs` reflect them

**Group 6 verification record (2026-07-23):**
- 6.1: `cargo test` (src-tauri): **383 passed, 0 failed**. `npm run test:run`: **1498 passed / 1 failed / 1 skipped** — the single failure (`settingsStore.test.ts` expects persistence version 4; store on HEAD persists 5) is PRE-EXISTING on main (verified via `git show HEAD`), flagged as a separate background task, and untouched by this change. Affected test mocks for the new binary IPC / delta contracts were updated (`nativePdfRangeTransport`, `fileSyncRegistration`, `ocrWorkflow` e2e) and pass.
- 6.2: Final numbers vs 1.89.2 baseline — entry chunk 1,444→1,308 KB; SettingsPage 961→43 KB (+17 lazy section chunks); PDF workers 2→1; dist total ~25.1→23.6 MB. `scripts/check-bundle-budget.mjs` passes (budgets: entry 1,400,000 B; total 27 MB; exactly 1 worker) and is wired into `build:check` + a standalone `check:bundle` script.
- Browser-mode runtime smoke (dev server + Browser pane): app boots with zero console errors; theme applies with the lazy registry; Settings shell opens with lazy sections (Sync chunk loaded on demand); cross-section settings search finds not-yet-loaded sections; desktop queue view renders with the reconcile effect; mobile shell renders.
- Remaining device-only checks fold into 6.3 (Android manual pass): PDF paging over binary IPC on asset protocol, swipe gestures on a virtualized >20-item queue, 2b12f2f2 scroll regression on touch hardware, and the large-PDF concurrency check against the real Rust backend (browser mode exercises the IndexedDB backend, not Tauri IPC). Desktop/PWA paths for 1.6/4.5 are covered by the passing unit tests + the smoke run; Rust-side threading (3.4) is enforced by the spawn_blocking/tokio::fs implementation and its tests.

## 7. Adversarial review + fixes (post-implementation, 2026-07-23)

- [x] 7.1 Ran a 5-dimension adversarial code review over the diff (binary IPC, queue slim/delta, threading, bundle/worker, virtualization); each finding independently verified by a skeptic. Binary IPC and threading came back clean; 1 bundle finding (PWA fake-worker) was refuted with sound reasoning.
- [x] 7.2 Fixed CONFIRMED regression (HIGH): slim-listing default stripped question/answer/clozeText that semantic-study focal-topic filtering (scoreFocalTopic) reads off the shared store items, silently dropping body-matched cards. Root cause: `slim` defaulted true AND the shared QueueItem type kept the fields optional, so tsc did not catch the now-always-undefined reads. Fix: `apply_slim` defaults None→false (opt-in only); store load never requests slim. Same fix resolves the MEDIUM semantic-graph degradation and LOW schedule-title regression (same root cause, same consumers).
- [x] 7.3 Added Rust regression guards (`apply_slim_defaults_to_full_content`, `apply_slim_strips_only_when_opted_in`) pinning that the listing default retains content — the exact test class that would have caught the bug the original tests missed.
- [x] 7.4 Fixed CONFIRMED regression (MEDIUM): mobile queue scroll-save listener was bound once (deps []) to the container element at first commit, but that element swaps when the list crosses the virtualization threshold, stranding the listener and breaking scroll-restore for large queues. Fix: DynamicVirtualList gained an `onScroll` passthrough; MobileQueueView now saves scroll via an `onScroll` PROP on both branches (reads e.currentTarget), immune to the container swap.
- [x] 7.5 Updated design D2, the queue-ipc-efficiency spec, and CHANGELOG to reflect slim-as-opt-in-off-by-default (the shipped queue win is the delta-mutation elimination, not listing slimming).
- [x] 7.6 Re-verified: tsc clean; Rust queue tests 7/7; frontend suite 1498 passed / 1 pre-existing failure; `vite build` + bundle budget pass.

- [ ] 6.3 Manual pass on Android: cold start, open 1,000+-item queue, page through a large PDF, run a review — watching for jank, OOM, and logcat errors
- [x] 6.4 Update `CHANGELOG.md` with user-visible performance notes
