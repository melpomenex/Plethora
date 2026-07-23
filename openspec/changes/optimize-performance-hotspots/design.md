# Design: Optimize Performance Hotspots

## Context

The audit in `proposal.md` identified ten findings; this design covers the six we act on, grouped into five capabilities. The app ships frontend and backend together (no version skew between webview JS and the Rust binary), which simplifies IPC contract changes: both sides change atomically in one release.

Current state of the hot paths:

- **PDF range reads** (`read_pdf_document_range`, `src-tauri/src/commands/pdf_mobile.rs`): returns `PdfDocumentRange { offset, bytes: Vec<u8>, identity, eof }` through serde_json. serde serializes `Vec<u8>` as a JSON array of numbers; a 512 KB chunk becomes ~1.8 MB of JSON, and the JS side re-materializes it as a number array before converting to `Uint8Array`. This is the primary mobile PDF paging path.
- **Whole-file reads** (`read_document_file`, `src-tauri/src/commands/document.rs:1163`): `std::fs::read` (blocking, on a tokio worker) → base64 string → JSON string → `atob` on the JS side. Android refuses files > 16 MiB (OOM history, commit 524f087a); desktop has no cap.
- **Queue listings** (`get_queue`, `src-tauri/src/commands/queue.rs:418`): unpaginated `Vec<QueueItem>` where every item carries `question`, `answer`, `cloze_text`, `tags`. `queueStore` calls `loadQueue()` after every mutation (postpone, dismiss, priority set, …) — 8 call sites — re-transferring the entire queue each time.
- **Mobile queue rendering** (`src/components/mobile/MobileQueueView.tsx:669`): plain `filteredItems.map(...)`; the desktop equivalent (`ReviewQueueView.tsx:1338`) switches to `DynamicVirtualList` above 20 items.
- **Main bundle** (`dist/assets/index-*.js` = 1.44 MB): `ThemeContext.tsx:12` statically imports two themes from `themes/builtin.ts` (144 KB source, 65+ themes) while line 270 dynamically imports the same module. Rollup merges a module that is both statically and dynamically imported by the same graph into the static importer's chunk, so the entire theme registry lands in the main chunk and the "lazy" import is a no-op. `SettingsPage.tsx` statically imports ~18 section panels (961 KB chunk). Two PDF.js worker builds ship (~2.1 MB combined).
- **Blocking work in async commands**: 95 `std::fs`/`fs::read|write` call sites under `src-tauri/src/commands/`; `pdf_extract::extract_text_from_mem` (multi-second CPU work on large PDFs) runs synchronously at `processor/pdf.rs:141,271,284` while the fourth path (line 37) already uses `spawn_blocking`.

Constraints:

- tauri is pinned to `=2.11.0` (GHSA-7gmj-67g7-phm9 regression); the design must not require a newer tauri. Raw IPC responses (`tauri::ipc::Response`) exist since 2.0, so this is fine.
- PWA/browser mode routes the same API functions through `browserInvoke` (IndexedDB backend); Tauri-only IPC changes must leave those signatures workable for both backends.
- The release profile's documented rustc/LLVM SIGSEGV history forbids `lto = "fat"` / `codegen-units = 1` experiments in this change.
- SM-20 scheduling code paths must not change behavior (see `Code/sm20` reference discipline).

## Goals / Non-Goals

**Goals:**

- Eliminate JSON-number-array and base64 encodings for binary IPC payloads.
- Cut per-mutation queue IPC from O(queue) to O(1) and remove card content from listings.
- Reduce the startup-critical chunk by ≥ 250 KB minified (theme registry + measurable follow-ons) and the shipped asset set by ≥ 1 MB (duplicate worker).
- Virtualize the mobile queue list.
- Move blocking I/O / CPU extraction off tokio async workers on user-facing paths.

**Non-Goals:**

- No pagination UI or infinite-scroll redesign of the queue (slim + delta is enough for now).
- No Cargo profile changes, no tiktoken removal, no Yjs/sync work, no `en`-locale extraction (it is the synchronous fallback dictionary; ~40 KB gzip is an accepted cost of guaranteed-sync `t()`), no icon-set redesign beyond import mechanics.
- No changes to scheduling semantics, queue ordering rules, or review flows.

## Decisions

### D1. Raw-byte IPC via `tauri::ipc::Response`, metadata made implicit

`read_pdf_document_range` returns `tauri::ipc::Response::new(bytes)`; the JS side receives an `ArrayBuffer` from `invoke()`. The old response struct's metadata becomes implicit:

- `offset` — the caller passed it; echoing is redundant.
- `eof` — derivable: `bytes.byteLength < requestedLength`, with total size already known from `open_pdf_document_source`.
- `identity` — server-side validation stays (mismatch returns the existing `pdf_source_changed` error); echoing the identity back added nothing the error contract doesn't already guarantee.

`read_document_file` likewise returns raw bytes; `readDocumentFile()` in `src/api/documents.ts` changes its return type from base64 `string` to `Uint8Array`. Call sites currently `atob`-decode — they simplify. The Android 16 MiB guard stays (raw transfer shrinks the payload but the single-allocation OOM risk on huge files remains). The PWA `browserInvoke` implementations return `Uint8Array` natively from IndexedDB, so the unified signature works on both backends.

*Alternative considered*: keeping JSON but switching `bytes` to base64 (`serde` with a base64 codec). Rejected — still a ~1.33× text blowup plus decode pass; `Response` gives zero-copy-ish transfer with less code than the codec.

*Alternative considered*: a prefix-header binary protocol carrying metadata + bytes in one buffer. Rejected — nothing needs the metadata (see above); protocol framing is complexity with no consumer.

### D2. Local mutation application (+ opt-in slim, default OFF)

Queue mutations (postpone, dismiss, priority set, suspend) change from "mutate then `loadQueue()`" to "mutate, apply the server-returned updated item (or removal) to the store in place, client-side re-sort". Full `loadQueue()` remains for: initial load, explicit refresh, collection switch, and bulk operations (postpone-all, import completion) where the server-side result set genuinely changes shape. `postpone_item` returns the new due date (RFC 3339) so the delta is exact; bulk suspend/delete remove `result.succeeded` locally. This is the dominant win — it removes the O(queue) re-transfer that fired after *every* action.

**Slim listings — REVISED after review (default OFF).** The original plan set `question`/`answer`/`cloze_text` to `None` on `get_queue`/`get_queued_items` with a `slim` flag *defaulting to slim*. The adversarial review of this change proved that unsafe: the frontend stores a queue listing as the shared `state.items`, and three features read card content off it — semantic-study focal-topic filtering (`scoreFocalTopic`), the semantic graph (`calculateItemSimilarity`/`queueItemToSummary`/labels), and schedule titles (`getScheduleItemTitle`). Slimming by default silently degraded all three, and the TypeScript compiler did NOT catch it because `question?` etc. are optional fields (reading a now-always-`undefined` optional is type-safe). The bounded `learning_hint` preview (~80 chars, truncated) is lossy for topic matching and similarity, so it is not a substitute. **Resolution:** the `slim` flag and `strip_content_for_listing`/`derive_learning_hint`/`learning_hint` are kept as opt-in infrastructure (with `apply_slim` defaulting `None`→false and a regression test pinning that default), but the store-backing load does not request it. A future dedicated lightweight listing that does *not* back content features can opt in. The realized win of this section is entirely the delta-mutation elimination above.

*Alternative considered*: cursor pagination. Rejected for now — the queue views want the full ordered set for filtering/segmenting (session blocks, file-type filters compute over all items).

*Risk note (drift)*: applying deltas locally can drift from server truth if a mutation has side effects on *other* items. Audit found none of the wired mutations recompute sibling items server-side (ordering is client-computed via `QueueSelector`). Mitigation anyway: reconcile with a full reload on tab re-focus, and any mutation handler that cannot map the server response onto a single item falls back to `loadQueue()`.

### D3. Bundle: fix the theme-registry chunk merge, lazy settings sections, single PDF worker, icon imports

- **Themes**: move the two eager fallback themes (`superGameBroTheme`, `milkyMatchaTheme`) into a new small module (`src/themes/fallback.ts`) that `builtin.ts` re-exports (single source of truth, no duplication). `ThemeContext` statically imports only `fallback.ts`; `builtin.ts` becomes dynamically-imported-only and Rollup splits it out. Verification is part of the task: build and assert the main chunk shrank and a separate themes chunk exists.
- **Settings**: each section panel in `SettingsPage.tsx` becomes `React.lazy` with a per-section `Suspense` boundary (pattern already proven by `TabRegistry`). Search-across-sections must keep working — the search index is metadata (section titles/keys), not the panel components, so it stays eager.
- **PDF worker**: standardize on the custom bootstrap worker (`src/workers/pdfjs.worker.ts`, needed for the Android/asset-protocol cases per `PDFViewer.tsx:263–277` comments) as the only shipped worker; the `?url` import of `pdf.worker.min.mjs` is removed and the `workerSrc` fallback path points at the bootstrap worker asset instead. `src/lib/browser-backend.ts` (PWA path) switches to the same asset so the dist ships exactly one worker build.
- **Icons**: first measure whether the 602 KB `ui-vendor` chunk is (a) all-icons-included (tree-shaking failure — find and fix the offending barrel/dynamic access) or (b) genuinely ~150 used icons × all-6-weights each. For (b), add an ESLint `no-restricted-imports` rule steering new code to per-icon deep imports and convert the top offenders mechanically. Treat as best-effort; the budget assertion (below) is the enforceable outcome.
- **Budget enforcement**: a small script (`scripts/check-bundle-budget.mjs`) runs after `vite build` and fails if the entry chunk or total-assets size exceeds recorded budgets. Budgets start at post-fix actuals + 10 % headroom.

### D4. Mobile queue virtualization via the existing `DynamicVirtualList`

`MobileQueueView` reuses `src/components/common/VirtualList.tsx`'s `DynamicVirtualList` (same component as desktop, already wraps `@tanstack/react-virtual`) above the same >20-item threshold, keeping the plain map below it. Swipe gesture handlers live inside `QueueRow` and are unaffected by windowing. The scroll container must remain the one fixed in commit 2b12f2f2 ("Fix mobile Queue extracts scrolling") — the task includes regression-checking that fix.

### D5. Thread hygiene: targeted offload, not a blanket sweep

Rule (encoded in the spec): a `#[tauri::command] async fn` on a user-facing path must not perform blocking file I/O or CPU-bound parsing on the runtime thread. Applied to the audited hot list:

- `read_document_file` → `tokio::fs::read` (simple swap; base64 step deleted by D1 anyway).
- `read_pdf_document_range`'s `read_range_from_path` (sync `File` seek/read) → `spawn_blocking` (512 KB reads on every page turn).
- `processor/pdf.rs:141,271,284` — wrap the `catch_unwind(pdf_extract…)` calls in `spawn_blocking`, mirroring line 37. `spawn_blocking` surfaces panics as `JoinError`, so the existing `catch_unwind` wrappers can be simplified where they only guard the extract call.

The remaining ~90 cold-path `std::fs` sites (one-shot imports, settings writes) are explicitly out of scope; a follow-up sweep can use this change's pattern. This keeps the diff reviewable and the risk bounded.

### D6. Store subscription hygiene rides along, scoped

Only components touched by D2/D4 (queue, review, mobile queue, settings shell) convert `const { x } = useXStore()` to `useXStore(s => s.x)` selectors. A repo-wide 76-file conversion is mechanical but high-churn; scoping it to the files already under edit keeps review focused. An ESLint rule is *not* added (zustand whole-store reads are legitimate in event handlers via `getState()`).

## Risks / Trade-offs

- [ArrayBuffer IPC path differs per-platform webview] → Verify on all three: macOS WKWebView, Windows WebView2, Android. The Tauri raw-response path is core (not plugin) and version-pinned; add a dev-only round-trip integrity assertion (byte length + head/tail sample) behind `INCREMENTUM_OPEN_DEVTOOLS` logging during QA.
- [Slim queue breaks a consumer that silently relied on `question`/`answer` in listings] → The `slim` flag defaults ON only after a grep-verified inventory of `QueueItem` field consumers; TypeScript type for listing items drops the content fields so remaining consumers fail at compile time, not runtime.
- [Local mutation application drifts from server state] → Reconcile-on-focus + per-handler fallback to full reload (D2). Queue correctness is user-visible and cheap to restore; drift cannot corrupt server data.
- [Settings lazy-split regresses settings search or deep links] → Section metadata stays eager; add a scenario test that opens a deep-linked section and searches across sections.
- [Removing the `?url` worker breaks a platform that needed `workerSrc`] → The fallback branch is kept, retargeted at the single bootstrap asset; test matrix covers Android (asset protocol), desktop localhost, and PWA.
- [Virtualization changes mobile scroll behavior recently fixed in 2b12f2f2] → Explicit regression check in the task list; threshold keeps small queues on the untouched plain-map path.
- [`spawn_blocking` pool exhaustion under burst load] → tokio's blocking pool defaults to 512 threads; PDF extraction is bounded by user actions. No semaphore needed now; noted for the follow-up sweep.

## Migration Plan

Ship as one release, implemented in risk order so each lands independently revertable:

1. Bundle fixes (D3) — no behavior change, immediately verifiable via build output.
2. Mobile virtualization (D4) + scoped selector hygiene (D6).
3. Thread hygiene (D5) — no contract change.
4. Binary IPC (D1) — frontend + backend change together; no persisted-data migration.
5. Queue slim + delta (D2) — last, behind the `slim` flag for a fast revert (flip flag, restore `loadQueue()` calls).

Rollback for any step is a git revert; nothing writes new on-disk formats.

## Open Questions

- Does the 602 KB icon chunk decompose as tree-shaking failure or true usage? (Measured during D3's first task; determines whether the fix is a one-line barrel fix or a codemod.)
- `get_queued_items` server-side sort (`QueueSelector::sort_queue_items`) vs client-side sort duplication — D2 keeps both; consolidating ordering into one side is a candidate follow-up change.
