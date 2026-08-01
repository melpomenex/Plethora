## 1. Documents view — selection semantics

- [x] 1.1 Add a checkbox-specific selection path in `src/components/documents/documentSelection.ts` that always applies toggle semantics regardless of modifier keys, leaving `selectDocumentsByClick` unchanged for row-body clicks
- [x] 1.2 Route the row checkbox in `src/components/documents/DocumentsView.tsx` (list view ~line 1374, and the grid/compact equivalents) through the new path instead of `handleSelectRow`
- [x] 1.3 Unit-test the selection module: clicking a checked checkbox clears it; checkbox clicks accumulate without a modifier; row-body plain click still replaces; row-body click on an already-selected document does not clear it; Shift range selection is unaffected
- [x] 1.4 Verify the bulk action bar dismisses when the last document is deselected

## 2. Documents view — bulk actions

- [x] 2.1 Confirm whether a backend command exists to reassign a document's collection; if not, add one in `src-tauri/src/commands/` with a frontend API wrapper
- [x] 2.2 Implement `handleBulkMoveCollection` to persist `collection_id` for every selected document, replacing the `TODO` at `DocumentsView.tsx:851`; create the collection first when the target does not exist
- [x] 2.3 Replace the `window.prompt()` input in `handleBulkTag`, `handleBulkReprioritize`, and `handleBulkMoveCollection` with in-app dialogs using existing dialog components; dismissing a dialog must leave the selection intact
- [x] 2.4 Before landing 2.3, determine empirically whether `window.prompt()` returns in this WebView build — if it does, Tag's reported failure has another cause that must be found and fixed rather than masked (design open question 2)
- [x] 2.5 Give every bulk action a uniform result path: succeeded/failed counts, per-item failure reasons available to the user, and selection cleared on completion
- [x] 2.6 Test bulk move (existing and new collection, partial failure), bulk tag, and bulk reprioritize end-to-end including persistence across a reload
- [x] 2.7 Replace the four `window.confirm()` call sites that silently decline in the desktop WebView (`NotificationSettings.tsx:178` reset, `SettingsPage.tsx:424` discard changes, `SettingsPage.tsx:459` reset all settings, `ReviewSession.tsx:111` discard arena session) with the in-app confirm dialog
- [x] 2.8 Add a lint rule or test asserting no application source calls `window.alert`, `window.confirm`, or `window.prompt`, so this class of dead control cannot return

## 3. Documents view — extract counts and priority controls

- [x] 3.1 Patch `extractCount` on the document record in `src/stores/documentStore.ts` when an extract is created or deleted, driven from the shared extract API path, without a full document reload
- [x] 3.2 Verify the updated count renders in list, grid, and compact views
- [x] 3.3 Add inline priority editing to the compact and grid views, persisting through the existing document update path
- [x] 3.4 Register a priority-adjustment keyboard shortcut in `src/stores/keyboardShortcutsStore.ts` so it appears in shortcut settings and is rebindable; wire it to the active document in the Documents view
- [x] 3.5 Investigate the document viewer's priority control not rendering: determine whether it depends on load-order or measurement timing, and make it render deterministically from document state
- [x] 3.6 Test: create an extract and confirm the count updates without reload; adjust priority by mouse and by shortcut and confirm persistence

## 4. Queue — bulk operations

- [x] 4.1 Settle design open question 1: whether documents and extracts have a suspension concept in the repository layer, or whether suspension must be expressed through scheduling fields — raise scope if absent rather than improvising
- [x] 4.2 Add a single typed id-resolution step in `src-tauri/src/commands/queue_bulk.rs` that maps the full id set to queue entities (learning items, documents, extracts) in one pass
- [x] 4.3 Rewrite `bulk_suspend_items`, `bulk_unsuspend_items`, and `bulk_delete_items` on top of it, dispatching per resolved type and removing the per-id `get_all_learning_items()` call
- [x] 4.4 Report unresolvable ids as failed with a reason, and continue processing the rest of the request
- [x] 4.5 Clear `selectedIds` after `bulkSuspend` and `bulkUnsuspend` in `src/stores/queueStore.ts`, matching `bulkDelete`
- [x] 4.6 Surface `BulkOperationResult.errors` in `src/components/review/ReviewQueueView.tsx`; present an all-failed result as an error rather than a neutral status line
- [x] 4.7 Rust tests: suspend/unsuspend/delete for a document-only, extract-only, flashcard-only, and mixed selection; unresolvable id reported as failed without aborting the request
- [x] 4.8 Verify the full-table read count does not grow with selection size

## 5. Browser extension — transport hardening and diagnostics

- [x] 5.1 Define shared transport limits in `browser_extension/shared.js` and mirror them in `src-tauri/src/browser_sync_server.rs`, replacing the three independent numbers (8 MB fitter / 10 MB server / 7 MB occlusion); assert the extension budget stays strictly below the server limit
- [x] 5.2 Route `requestAIAnalysis` (`background.js:1237`) through `fitPayloadToBudget`; audit every `fetch(` call site in `background.js`, `content.js`, and `popup.js` for unfitted bodies and route them through the shared path
- [x] 5.3 Make the 413 retry in `sendToIncrementum` unconditional rather than gated on `html_content || extracted_images`, shedding content progressively: styling → media references → rich markup → text truncation
- [x] 5.4 Return a structured JSON body on body-limit rejection in `browser_sync_server.rs` (received size, configured limit, endpoint) instead of the empty body that produces the bare `Server error: 413`
- [x] 5.5 Surface the server's message in the extension popup instead of the bare status code
- [x] 5.6 Report shed content to the user: `fitPayloadToBudget` already returns `droppedHtml` / `droppedImages` / `truncatedText` / `compactedHtml` and they currently reach only `console.warn` — turn them into a user-visible notice on the save, and keep an undegraded save a plain success
- [x] 5.7 Extend `browser_extension/tests` for the fitter and retry: unconditional retry, progressive shedding order, shed-content reporting, limit-constant consistency
- [x] 5.8 ~~Ask the reporter for the extension service-worker console output from a failing Wikipedia save~~ — superseded: tracing every caller of `requestAIAnalysis` found no live path that can produce a request near 10 MB, and the reporter's round-2 comment confirms the 413 was already gone after updating. See design open question 3 and D3.

## 6. NotebookLM — connection integrity

- [x] 6.1 Parse the `auth check --json` response body in `src-tauri/src/notebooklm.rs` and require an affirmative authenticated field; treat non-zero exit, unparseable body, timeout, and missing CLI as unauthenticated
- [x] 6.2 Remove the `!is_auth_error(msg)` fail-open branch from `auth_valid` (~line 3488); keep `is_auth_error` only where it classifies retries (`should_retry_generation`)
- [x] 6.3 Audit the remaining login strategies in `notebooklm.rs` for the same fail-open shape and apply the same rule
- [x] 6.4 Remove the auto-connect from `handleCLIAuthChange` in `src/pages/NotebookLMPage.tsx:140`; connection must follow an explicit user action
- [x] 6.5 Stop `NotebookLMLoginPanel` from reporting authentication from a mount effect in a way that triggers connection
- [x] 6.6 Distinguish three states in the NotebookLM view: verified-and-connected (including verified with zero notebooks), unverified, and listing-failed — never render an unverified session as Connected
- [x] 6.7 Rust tests for `auth_valid`: affirmative success, explicit unauthenticated, unparseable body, non-zero exit, timeout, missing CLI
- [ ] 6.8 Manually verify: disconnect stays disconnected across navigation and remount; an unauthenticated CLI never reports Connected
- [x] 6.9 Bundle the target-specific NotebookLM runtime, Playwright Chromium, and sidecar into desktop Tauri artifacts; reject release bundles that omit the runtime
- [x] 6.10 Keep the bundled browser profile in app data and recover storage state from an authenticated persistent profile when the CLI login redirect times out

## 7. Image capture, occlusion, and registry

- [x] 7.1 Replace the branch in `ingestHoveredImage` (`src/components/viewer/ImageSaveOverlay.tsx:109`) with one acquisition function that tries direct retrieval → native ingest → local file read → rendered-pixel capture for every source scheme; source type selects the starting strategy but never removes fallbacks
- [x] 7.2 Route both Save-to-Registry and Create-Occlusion through that single function
- [x] 7.3 Replace raw WebKit errors with actionable messages that never surface the bare string "Load failed"
- [x] 7.4 Add asset renaming to the Image Registry: persist the name, reflect it everywhere it is displayed, and keep existing extract and card references intact
- [x] 7.5 Test occlusion from: an imported article image, the in-app image viewer, a remote URL, and a local asset
- [x] 7.6 Test that renaming an asset used by an existing extract leaves the extract rendering correctly

## 8. Startup — measurement, then recovery

*Run 8.1–8.3 before assuming the cause of the slowness, missing priority slider, or incomplete Reading Queue.*

- [x] 8.1 Add startup-phase timing and outcome (completed / timed out / failed) to `src/lib/sync/syncTelemetry.ts` for each phase in `src/lib/startSyncSubsystems.ts`, and make the measurements retrievable for diagnosis
- [ ] 8.2 Reproduce a degraded boot deliberately (force `getYjsSync()` past its 4 s timeout) and record which symptoms follow — specifically whether the Reading Queue is incomplete and the priority slider absent
- [ ] 8.3 Ask the reporter design open question 4: when the priority slider is missing, does switching tabs restore it, or only a restart? Tab-switch implicates rendering (task 3.5); restart-only implicates the degraded-boot hypothesis
- [ ] 8.4 Record degraded startup in observable application state rather than a `console.warn` in `startSyncSubsystems.ts`
- [ ] 8.5 Surface a non-blocking degraded-startup indicator with a Retry action that re-runs initialization and clears the state on success, with no restart required
- [ ] 8.6 Mark snapshots captured during a degraded boot in `src/stores/startupStore.ts` and invalidate them on recovery, so `ensureStartup`'s `alreadyReady` path cannot serve partial data for the rest of the session
- [ ] 8.7 Re-test the Reading Queue completeness complaint after 8.6; if it persists under a healthy boot, investigate it separately as a query/filter defect
- [ ] 8.8 Test: a healthy boot shows no indicator; a forced degraded boot shows one and recovers on Retry without a restart

## 9. Settings — bind the dead controls

- [x] 9.1 Add a default-view field to `src/stores/settingsStore.ts` and bind the Settings ▸ Default View control (`SettingsPage.tsx:821`) to it with a controlled `value`, replacing `defaultValue="queue"`
- [x] 9.2 Consume the persisted preference at startup so the application opens the chosen view
- [x] 9.3 Audit the six sibling unbound controls in `SettingsPage.tsx` (~lines 840, 918, 929, 1210, 1296, 1304): bind each, or render it disabled with an explanation — no enabled control may discard input
- [x] 9.4 Test: set Default View to Documents, restart twice, confirm the application opens Documents and the control shows Documents

## 10. Release

- [ ] 10.1 Run the full test suite plus `npm run test:browser-extension`
- [ ] 10.2 Add CHANGELOG entries grouped as Fixed & Improved / Added, calling out that NotebookLM connections which were never verified will now correctly show as disconnected
- [ ] 10.3 Reply on issue #40 mapping each reported item to its outcome, and stating plainly which items were fixed, which were hardened without a confirmed root cause (the 413), and which still need information from the reporter
- [ ] 10.4 Remind the reporter to reload the browser extension after updating
