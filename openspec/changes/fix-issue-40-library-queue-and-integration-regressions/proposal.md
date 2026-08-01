## Why

[Issue #40](https://github.com/melpomenex/Incrementum/issues/40) is now three rounds deep. Rounds 1 and 2 shipped as v1.91.0 and v1.92.0. The July 31 follow-up reports twelve further defects plus three feature requests, and the reporter's framing matters as much as the list:

> "Not really sure sometimes it works sometimes it doesn't." — *"was working earlier today"*, *"used to work earlier"*, *"it did earlier"*, *"Worked before than not"*, *"Have to restart a few times before its working normally."*

Reading the code behind each report, the twelve split into two very different groups.

**Eight are deterministic defects that have never worked** — the reporter perceives them as flaky only because they had not exercised those paths before. Each has a confirmed root cause:

- Clicking a selected document's checkbox re-selects it instead of clearing it, because the row click and the checkbox share one Finder-style handler that always replaces the selection (`documentSelection.ts:74`).
- **Move** in the Documents bulk bar creates a collection, discards it, and clears the selection — the write is an unimplemented `TODO` (`DocumentsView.tsx:843`).
- **Suspend** on a queue selection resolves ids only against `get_all_learning_items()`, so documents and extracts can never match and always report `Item not found` (`queue_bulk.rs:163`). The reporter's screenshot shows the guaranteed result: `Bulk update: 0 succeeded, 2 failed`.
- `bulkDelete` clears the selection; `bulkSuspend` and `bulkUnsuspend` do not, so the action bar survives its own action (`queueStore.ts:692–745`).
- **Settings ▸ Default View** is a decorative `<select>`: no value binding, no store field, and zero readers anywhere in `src/` (`SettingsPage.tsx:821`). Six sibling controls share the pattern.
- NotebookLM reports Connected while unauthenticated because `auth check` is trusted on **process exit status without reading its JSON body**, and any unrecognized error is treated as authenticated via `!is_auth_error(msg)` (`notebooklm.rs:3488`). Disconnect is then immediately undone by an auto-reconnect fired from a mount effect (`NotebookLMPage.tsx:140`).
- Image occlusion gates the robust native-ingest + screenshot-capture path behind `isPublicRemoteImageUrl(src)`; every other source falls to a WebView `fetch()` whose failure surfaces as WebKit's literal `"Load failed"` — the exact toast in the report (`ImageSaveOverlay.tsx:109`).
- `extractCount` is hydrated from the backend column at load and never patched when an extract is created, so the Documents grid shows a stale count until a full reload.

**Four are state-degradation symptoms** — slow and wedged startup, a vanishing priority slider, an incomplete Reading Queue, erratic Wikipedia imports. These share one signature: they work, then stop, and only a restart fixes them. The boot chain already tolerates failure silently (`getYjsSync()` falls into "degraded mode" after 4s with nothing but a `console.warn`), and `ensureStartup` then caches whatever snapshot that degraded boot produced for the rest of the session (`startupStore.ts:57`). Patching the four symptoms individually would leave that mechanism in place. This change treats *silent, unrecoverable degradation* as the defect.

The three feature requests (keyboard priority adjustment, priority editing in the document view, renaming Image Registry assets) are small and land in surfaces this change already touches.

## What Changes

### Documents library — selection and bulk actions

- Give the row checkbox **toggle** semantics independent of the row body's Finder-style range/replace semantics, so clicking a checked box clears that document.
- Implement **Move to collection**: persist `collection_id` for every selected document through the backend, replacing the `TODO`.
- Replace the `window.prompt()`-driven **Tag**, **Move**, and **Reprioritize** flows with in-app dialogs, matching the rest of the app and removing the dependency on WebView native dialogs.
- Report bulk outcomes uniformly: every bulk action states how many items succeeded and failed, and clears the selection when it completes.
- Recompute `extractCount` locally when an extract is created or deleted so the Documents grid stays accurate without a reload.

### Queue — bulk operations

- Make `bulk_suspend_items` / `bulk_unsuspend_items` / `bulk_delete_items` resolve each id across **all queue item types** (learning items, documents, extracts) and apply the type-appropriate suspend/delete, instead of assuming every id is a flashcard.
- Fix the N+1 read: resolve the full id set once per call instead of re-reading every learning item inside the per-id loop.
- Clear the selection after suspend and unsuspend, matching delete.
- Surface `BulkOperationResult.errors` in the UI instead of only the succeeded/failed counts, so a partial failure is actionable.

### Browser extension — import transport

**Update from investigation:** the 413 turns out very likely already fixed, not open. The reporter's own round-2 comment says so — *"I have updated the browser extension so I don't get anymore 413 error"* — and neither round 2 nor round 3 mentions it recurring. Tracing every caller of the one candidate that could plausibly bypass the fitter (`/ai/process`, `data.content`, uncapped — `background.js:1237`) found it is either dead code (`case 'generateAISummary'` has no sender anywhere in the current source) or bounded by a user's manual text selection (`processSelectionWithAI`, from the AI context-menu items) — neither can produce a 10 MB request. No other path was found that reaches the server unfitted: `html_content` is capped at 5 MB with a compact-serialization path for Wikipedia-style pages, `text` at 250 KB, and images are collected as URLs, never base64.

So this section ships as **hardening a fix that already worked**, not a targeted repair of a live leak:

- Route **every** extension→desktop POST through `fitPayloadToBudget`, on principle — including `/ai/process`, which bypasses it today even though its current callers are bounded.
- Make the 413 retry **unconditional**. It is currently gated on `html_content || extracted_images` still being present, so a payload that overflows any other way gets no second chance.
- Return a **JSON body on body-limit rejection** — received size, configured limit, endpoint — so a bare `Server error: 413`, if it ever recurs, becomes a diagnosable message instead of a dead end.
- Derive the extension budget, the server limit, and the image-occlusion limit (8 MB / 10 MB / 7 MB today) from one shared, documented constant set instead of three independent numbers.
- **Tell the user what was shed.** Today the fitter drops HTML, then images, then truncates text, and reports it only to `console.warn` — which is very likely the mechanism behind the round-2 reports of "no readable content" and "images omitted" (both from *before* the 413 fix landed). A save that degraded must say so.

### NotebookLM — connection integrity

- Treat authentication as valid **only on explicit success**: parse `auth check --json` and require an affirmative authenticated field. An unparseable body, a non-zero exit, a timeout, or a missing CLI is **not authenticated**. Remove the `!is_auth_error(msg)` fail-open branch.
- Stop auto-reconnecting from a mount effect. After an explicit Disconnect the connection stays down until the user reconnects.
- Never render Connected while the notebook list is empty *and* unverified — distinguish "connected, no notebooks yet" from "we could not verify this session."

### Image capture, occlusion, and the registry

- Make the native-ingest and rendered-pixel-capture fallbacks available to **every** image source, not only public remote URLs, so in-app and document-local images stop failing with `"Load failed"`.
- Replace raw WebKit fetch errors with actionable messages naming the image and what to try.
- **Rename Image Registry assets** (feature request), replacing generated `saved-image-<timestamp>` names.

### Priority controls

- **Keyboard shortcut to adjust priority** (feature request), registered through the existing shortcuts store so it is discoverable and rebindable.
- **Edit priority directly in the Documents compact/grid view** (feature request), without opening the document.
- Make the document viewer's priority control render deterministically from document state rather than depending on load-order timing — the likely mechanism behind "priority slider doesn't appear even though was working earlier today."

### Startup — degradation must be visible and recoverable

- When the boot chain enters degraded mode, record it in observable app state instead of a `console.warn`, and surface a non-blocking indicator with a **Retry** affordance.
- Do not let `ensureStartup` serve a snapshot captured during a degraded boot as if it were authoritative for the remainder of the session; a degraded snapshot must be refetchable without restarting the app.
- Add startup-phase timing to the existing sync telemetry so the reporter's "have to restart a few times" is measurable rather than anecdotal, and so the Reading Queue completeness complaint can be attributed rather than guessed at.

## Capabilities

### New Capabilities

- `document-library-management`: Selection semantics and bulk operations in the Documents view — checkbox toggling, tag/move/reprioritize applied through in-app dialogs and persisted, uniform result reporting, and live extract counts.
- `queue-bulk-operations`: Bulk suspend/unsuspend/delete that resolves every queue item type, reports per-item errors, and manages selection lifecycle consistently.
- `browser-import-transport`: Payload budgeting, size-limit diagnostics, and user-visible degradation reporting for every browser-extension → desktop request.
- `notebooklm-connection-integrity`: Fail-closed authentication verification and connection state that reflects verified reality, including a Disconnect that stays disconnected.
- `image-capture-and-registry`: Image acquisition for the registry and occlusion cards across all source types, with actionable failures and user-controlled asset naming.
- `startup-preferences-and-recovery`: A functional default-view preference, plus observable and recoverable degraded startup.

### Modified Capabilities

<!-- No existing spec-level requirements are changed. Every capability above is new; existing specs (postpone-*, queue-strategy-persistence, smart-queue-cleanup, document-rating) remain as written. -->

## Impact

**Frontend**
- `src/components/documents/documentSelection.ts`, `src/components/documents/DocumentsView.tsx` — checkbox toggle semantics, dialog-based tag/move/reprioritize, bulk result reporting, in-grid priority editing
- `src/stores/queueStore.ts` — selection lifecycle after suspend/unsuspend; surface `errors`
- `src/components/review/ReviewQueueView.tsx` — render per-item bulk errors
- `src/stores/documentStore.ts`, `src/stores/extractStore.ts` — local `extractCount` maintenance
- `src/components/settings/SettingsPage.tsx` — bind Default View to the settings store; audit the six sibling controls sharing the unbound pattern
- `src/stores/settingsStore.ts`, `src/stores/startupStore.ts` — persist and consume the default-view preference; degraded-snapshot handling
- `src/pages/NotebookLMPage.tsx`, `src/components/notebooklm/NotebookLMLoginPanel.tsx` — remove mount-effect auto-connect; honest connection rendering
- `src/components/viewer/ImageSaveOverlay.tsx` — unify the ingest/capture fallback across all `src` schemes
- `src/components/viewer/DocumentViewer.tsx` — deterministic priority control rendering
- `src/stores/keyboardShortcutsStore.ts` — priority adjustment shortcut
- Image Registry UI — asset rename
- `src/lib/startSyncSubsystems.ts`, `src/lib/sync/syncTelemetry.ts` — degraded-mode state and startup phase timing

**Rust**
- `src-tauri/src/commands/queue_bulk.rs` — multi-type id resolution; remove the per-id full-table read
- `src-tauri/src/notebooklm.rs` — fail-closed `auth_valid`; parse `auth check --json`
- `src-tauri/src/browser_sync_server.rs` — JSON body on body-limit rejection; shared limit constants
- Document collection reassignment command for bulk Move (verify whether one already exists before adding)

**Browser extension**
- `browser_extension/background.js` — route `/ai/process` through the fitter; unconditional 413 retry
- `browser_extension/shared.js` — shared limit constants; report shed content to callers
- `browser_extension/content.js`, `popup.js` — surface degradation and real server messages

**Risk and sequencing**
- The queue bulk-operation change touches suspend/delete semantics for documents and extracts; it needs test coverage per item type before it ships.
- The 413 work is **hardening for a fix that already appears to have worked** (see the browser-extension section above), not a repair of a live leak. No further diagnosis is being requested from the reporter for this item.
- The startup items are investigation-led: the diagnostic work in group 8 gates whether the priority-slider, Reading Queue, and slowness items need further work beyond the recovery mechanism.
- No breaking changes; no schema migrations.
