# Design

## Context

This change answers the third round of [issue #40](https://github.com/melpomenex/Incrementum/issues/40). The defects span six subsystems and three languages, but they are not six unrelated pieces of work — most of them are instances of two failure modes, and the design is organized around those rather than around the reporter's list.

**Failure mode A — a rendered affordance is not wired to anything.** Documents ▸ Move creates a collection and discards it behind a `TODO`. Settings ▸ Default View flips a dirty flag and forgets the value. Queue ▸ Suspend resolves ids against the wrong table, so it can never succeed for the item types the Reading Queue actually shows. In every case the control looks identical to a working one, which is why the reporter experiences them as "the app is broken" rather than "that feature isn't finished."

**Failure mode B — a failure is absorbed and the resulting degraded state is silent and sticky.** `getYjsSync()` times out after 4 s into "degraded mode" with a `console.warn`. `fitPayloadToBudget` silently sheds HTML, then images, then truncates text, reporting only to `console.warn`. NotebookLM's `auth_valid` treats unrecognized errors as authenticated. The payload fitter's shedding is almost certainly the mechanism behind round 2's "page has no readable content" and "images omitted" reports — the app did exactly what it was designed to do and never said so.

The design decisions below follow from taking those two modes seriously rather than patching twelve symptoms.

## Goals / Non-Goals

**Goals**

- Every reported defect either fixed, or converted into a measurement that identifies it on next occurrence.
- The three feature requests delivered.
- Silent degradation replaced with disclosed degradation, everywhere it currently exists.
- No behavior change for users who are not hitting these paths.

**Non-Goals**

- Rewriting the sync/boot architecture. The progressive-lane scheduler, telemetry, and timeouts stay; this change makes their failure states visible and recoverable, nothing more.
- Rewriting the Documents view. Selection semantics and three handlers change; the layout does not.
- Claiming a confirmed root cause for the HTTP 413. See D3.
- Redesigning the browser extension's capture pipeline. The capture heuristics stay; the transport hardens.

## Decisions

### D1. Checkbox and row-body clicks get separate selection semantics

`selectDocumentsByClick` implements correct file-explorer behavior: a plain click replaces the selection. The bug is that the checkbox routes through it with the same modifiers ([DocumentsView.tsx:1374](../../../src/components/documents/DocumentsView.tsx#L1374)), so clicking a checked box re-selects it. A checkbox that cannot uncheck.

**Decision:** keep `selectDocumentsByClick` as the row-body handler, unchanged. Give the checkbox a path that always applies toggle semantics regardless of modifier keys.

**Alternative rejected — make plain click toggle everywhere.** That breaks Shift-range selection (the anchor becomes meaningless) and diverges from every file browser users know. The reporter's complaint is specifically about the checkbox; a checkbox toggles, a row does not, and both behaviors are correct in their own context.

**Alternative rejected — remove the checkboxes.** They are the discoverable affordance for multi-select. The row modifiers are not discoverable at all.

### D2. Bulk queue operations resolve ids through one typed lookup

`bulk_suspend_items` searches only `get_all_learning_items()` ([queue_bulk.rs:163](../../../src-tauri/src/commands/queue_bulk.rs#L163)), so any document or extract id fails with `Item not found`. It also calls that full-table read **inside** the per-id loop.

**Decision:** introduce a single resolution step that maps the whole id set to typed queue entities in one pass, then dispatch per resolved type. This fixes correctness and the N+1 together, and gives suspend, unsuspend, and delete one shared shape.

**Alternative rejected — try each table in sequence per id.** Correct but preserves the N+1 and triples it.

**Resolved during implementation — no schema change needed.** `is_suspended` exists only on `learning_items`. Documents and extracts have no such column, but both carry a reversible `is_dismissed` flag that the queue already filters on (`queue.rs:303` for documents; `repository.rs:2024`/`2082` for extracts), with existing setters `update_document_dismiss(id, bool)` and `update_extract_dismissed(id, bool)`. Suspension maps onto that flag, which produces exactly the behavior the spec requires — the item leaves the queue and returns when the flag is cleared — without a migration.

**Also found:** `bulk_delete_items` deleted only from `learning_items`, and a DELETE matching zero rows returns `Ok`, so deleting a document or extract from the queue reported success and removed nothing. That silent no-op was worse than the suspend failure, which at least reported an error.

### D3. The 413 is treated as an uncertainty to be engineered around, not diagnosed by guesswork

What is known: the reporter saw the literal string `Server error: 413`. `sendToIncrementum` emits that string only when the response body is **empty** ([background.js:790](../../../browser_extension/background.js#L790)) — which is what `tower-http`'s `RequestBodyLimitLayer` produces. Handler-level 413s in this codebase carry a message body. So the global 10 MB limit rejected the request before application code ran.

**Correction made during implementation.** The original hypothesis here named `/ai/process` (`data.content`, uncapped, unfitted — [background.js:1237](../../../browser_extension/background.js#L1237)) as the likely overflow path. Tracing every caller shows that is wrong:

- `case 'generateAISummary'` ([background.js:584](../../../browser_extension/background.js#L584)) reads `message.data.content` from a `chrome.runtime.sendMessage` action — but nothing in the current codebase sends that action. `grep -rn "generateAISummary"` across `browser_extension/` returns only the handler itself. It is dead code, unreachable from any button, context-menu item, or content-script message today.
- The only live caller of `requestAIAnalysis` is `processSelectionWithAI` ([background.js:1070](../../../browser_extension/background.js#L1070)), invoked from the two AI context-menu items ([background.js:342](../../../browser_extension/background.js#L342), 346) with `content = info.selectionText.trim()` — bounded by whatever text the user selected by hand. Not a plausible 10 MB source.

So no path in the *current* source can be shown to produce an unfitted request anywhere near the 10 MB limit: `html_content` is capped at 5 MB at capture and Wikipedia-style pages route through `captureCompactArticleHtml`, which strips styles/scripts/data-attributes rather than inlining computed styles per node; `text` is capped at 250 KB; `extractArticleImages` collects at most 24 image **URLs**, never base64.

**This also means the 413 may already be fixed.** The reporter's own round-2 comment says so directly: *"I have updated the browser extension so I don't get anymore 413 error."* Neither round 2 nor round 3 mentions a 413 recurring. The safeguards that likely fixed it (the 5 MB HTML cap, URL-only image capture, and the removed second preview-metadata fetch) shipped in v1.91.0, which is the version the reporter was praising when they said the error was gone.

**Decision, revised:** ship the hardening anyway, but describe it accurately. This is not closing a live bug — it is defense in depth for a fix that already appears to have worked, covering paths the current audit did not find a way to overflow. The value is in the diagnostics: if a 413 does recur (a page shape not yet seen, a future capture path that skips the fitter), the response will name the size, limit, and endpoint instead of an empty body, and the extension's retry will no longer depend on `html_content`/`extracted_images` still being present. Routing `/ai/process` through the fitter is now correctness/consistency work (every POST should be fitted, on principle) rather than a targeted fix for a live leak.

**Alternative rejected — raise the server limit.** It converts a fast rejection into a slow one and does not explain anything, and there is no evidence the limit itself is the problem.

**Scope boundary found during the fetch-call-site audit (task 5.2):** one direct POST is not routed through the shared fitter — the YouTube fallback in `content.js` (~line 2597, `Method 3` of a connectivity-fallback chain). This is architectural, not an oversight: `manifest.json`'s `content_scripts` array loads only `content.js`, not `shared.js` (which is background-service-worker-only), so `globalThis.IncrementumExtensionShared` is not reachable from that file without adding `shared.js` to every page's content-script injection. The payload there is `{url, title, content: '', ...}` — `content` is always empty (and is also the wrong field name; the server's `ExtensionRequest` struct reads `text`, so this field is silently ignored either way, a pre-existing latent naming mismatch with no observable effect since it's empty regardless). Not a plausible overflow path and not worth the manifest footprint to close for zero practical benefit; left as-is and noted rather than silently skipped. The image-occlusion request (`background.js`, `/ai/image-occlusion`) *is* covered, via `checkRequestBudget` on the fully-serialized request rather than `fitPayloadToBudget` — its payload shape (a base64 image blob) can't be usefully truncated the way text/HTML can, so it fails fast with an actionable message instead.

**Also found during that audit:** the occlusion upload's pre-existing size guard (`blob.size > 7MB`) checks the *decoded* image before base64 encoding, which inflates the wire size by roughly a third — a maximal 7 MB image becomes a ~9.3 MB request, leaving under 1 MB of headroom under the server's 10 MB limit before the question/answer/regions fields are even counted. Not a reported symptom, but a genuine near-miss this audit surfaced; `checkRequestBudget` now validates the actual serialized request rather than trusting the pre-encoding estimate.

### D4. Authentication verification fails closed

Two independent fail-open bugs produce one symptom ([notebooklm.rs:3488](../../../src-tauri/src/notebooklm.rs#L3488)):

```rust
let auth_valid = match &verify {
    Ok(_) => true,                        // exit status trusted; JSON body never read
    Err(e) => ... !is_auth_error(&msg),   // unrecognized error ⇒ "authenticated"
};
```

`is_auth_error` is a lowercase substring match over `auth|401|403|session|login|unauthorized`. Anything outside that vocabulary — CLI missing, Playwright browser absent, timeout, connection refused — reads as authenticated.

**Decision:** authenticated only on explicit success **and** an affirmative authenticated field in the parsed response. Every other outcome is unauthenticated. `is_auth_error` may remain for retry classification (`should_retry_generation`), but must not gate authentication state.

**Decision:** remove the auto-connect fired from `NotebookLMLoginPanel`'s mount effect ([NotebookLMPage.tsx:140](../../../src/pages/NotebookLMPage.tsx#L140)). Combined with D4's first half, this is what makes Disconnect stick — today the panel re-reports `true` on mount and reconnects underneath the user.

### D5. One image-acquisition path for all sources

`ingestHoveredImage` gates native ingest and rendered-pixel capture behind `isPublicRemoteImageUrl(src)` ([ImageSaveOverlay.tsx:109](../../../src/components/viewer/ImageSaveOverlay.tsx#L109)). Everything else falls to a WebView `fetch()` whose WebKit failure surfaces as the literal `"Load failed"` the reporter saw. The robust fallback added in v1.92.0 sits twenty lines above the failing branch and is unreachable from it.

**Decision:** one acquisition function that tries strategies in order — direct retrieval, native ingest, local file read, rendered-pixel capture — for **every** source. Source type selects the starting strategy; it never removes the fallbacks. Save-to-Registry and Create-Occlusion both call it, so they cannot diverge again.

### D6. Degradation is disclosed, not logged

Applies in three places, one rule: **if the user asked for X and got less than X, tell them.**

- A save that shed images reports "saved without images", not plain success.
- A boot that entered degraded mode surfaces a non-blocking indicator with Retry.
- A snapshot captured during a degraded boot is not treated as authoritative for the session.

That last point is the one that matters most. `ensureStartup` returns its cached snapshot whenever `status === "ready"` and the collection id matches ([startupStore.ts:57](../../../src/stores/startupStore.ts#L57)). If a degraded boot produced a partial snapshot, every later caller gets the partial data until the process restarts — which is exactly the reporter's ritual: *"Have to restart a few times before its working normally."*

**Decision:** mark snapshots captured under degradation, and invalidate them on recovery.

This is a hypothesis, not a confirmed root cause, and the design is honest about that: it predicts all four "worked earlier, then stopped" symptoms from one mechanism and predicts the restart ritual, which is strong enough to act on. Group 8 measures before assuming.

### D7. Bulk input moves to in-app dialogs

`handleBulkTag`, `handleBulkReprioritize`, and `handleBulkMoveCollection` all use `window.prompt()` ([DocumentsView.tsx:819–853](../../../src/components/documents/DocumentsView.tsx#L819)). Move is dead regardless — the write is a `TODO` — but the reporter says **both** Tag and Move do nothing, and `prompt()` in a WKWebView is a plausible shared cause worth eliminating on its own merits: it cannot be styled, tested, or translated, and its availability is not guaranteed.

**Decision:** replace all three with in-app dialogs using the existing dialog components. This is not a workaround for an unconfirmed platform quirk; it is what the rest of the app already does.

**Resolved during implementation — native JS dialogs do not work in this build, and the blast radius is wider than the report.** wry 0.55.1's `WKUIDelegate` (`src/wkwebview/class/wry_web_view_ui_delegate.rs`) implements exactly four methods: `windowWillClose:`, `runOpenPanelWithParameters:` (the file picker), `requestMediaCapturePermissionForOrigin:`, and `createWebViewWithConfiguration:`. It does **not** implement `runJavaScriptAlertPanelWithMessage:`, `runJavaScriptConfirmPanelWithMessage:`, or `runJavaScriptTextInputPanelWithPrompt:`. WKWebView suppresses a JS dialog whose delegate method is unimplemented, so in the desktop app:

- `window.prompt()` returns `null` — Tag and Reprioritize do nothing, exactly as reported.
- `window.confirm()` returns `false` — every call site gated on it silently declines.

The `confirm()` half was not in the reporter's list and affects four further actions that are dead today: notification-settings reset (`NotificationSettings.tsx:178`), discard-unsaved-changes (`SettingsPage.tsx:424`), reset-all-settings (`SettingsPage.tsx:459`), and discard-algorithm-arena-session (`ReviewSession.tsx:111`).

This confirms the dialog migration is the fix rather than a mask, and extends it: **no application code may depend on `window.alert`, `window.confirm`, or `window.prompt`.** Group 2 covers the three Documents handlers; the four `confirm()` sites are added as task 2.7.

### D8. Priority state is rendered directly, not inferred from layout timing

Investigation found no conditional measurement or load-order gate around the viewer priority control: both desktop and mobile render it whenever `currentDocument` exists. The nondeterminism was inside `PriorityControl`, which copied `prioritySlider` into component state only on its first mount. Reusing the mounted viewer for another document, or receiving an updated document after hydration, left the control displaying the previous document's priority. The control now resynchronizes from `documentId` and `prioritySlider`; library steppers and the keyboard shortcut persist through `update_document_priority` and patch the loaded document state from its response.

### D9. Desktop releases carry the NotebookLM runtime as resources

The release build already provisions a target-specific portable Python home,
`notebooklm-py[browser]`, and Playwright Chromium when
`NOTEBOOKLM_BUNDLE_RUNTIME=1`. The missing piece was Tauri packaging: the
NotebookLM sidecar and `notebooklm-runtime` directory were not declared as
desktop bundle inputs, so a clean install could still fall back to a first-run
Python installation.

**Decision:** declare `bin/notebooklm` as a desktop external sidecar and
`bin/notebooklm-runtime` as a desktop resource. The runtime resolver checks the
resource location before managed app-data runtimes, and the launcher also knows
the macOS `Contents/Resources/bin` location. Release verification fails when
the manifest, Python package, browser payload, or sidecar is missing.

The portable builder excludes host `site-packages` and `dist-packages` from the
copied Python stdlib. This prevents a developer's unrelated global Python
environment from becoming part of the release. The login flow is headed, so
the separate Playwright headless shell is not bundled.

The bundled CLI receives `NOTEBOOKLM_HOME` pointing at the app's per-user
NotebookLM directory, keeping its persistent browser profile beside
`storage_state.json` instead of depending on a separately installed
`~/.notebooklm` profile. Before opening a new login window, and again after a
login flow exits, the app can export an existing persistent Chromium profile
into `storage_state.json` and run the CLI auth check. This covers Google's
final-redirect race where the browser is authenticated but notebooklm-py times
out before writing its storage file; only a verified export can mark the app
connected.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Suspend semantics for documents/extracts may not exist in the repo layer (D2) | Settle before implementing; if absent, raise scope rather than improvise a definition |
| The 413 may already be fixed, making this hardening rather than a fix (D3) | Framed accurately in this doc and the proposal; diagnostics still pay for themselves if it recurs |
| The degraded-snapshot hypothesis may be wrong (D6) | Group 8 measures first; the recovery mechanism is independently worth having |
| Disclosure could become noisy | Only disclose on actual degradation; an undegraded save reports a plain success |
| Failing closed on NotebookLM auth may disconnect users who appear connected today | Correct — they were never connected; the error must say what to do |
| Six capabilities in one change is a large surface | Grouped tasks are independently shippable; groups 1–7 do not depend on group 8 |

## Migration Plan

No schema changes, no data migration, no breaking API changes.

The one user-visible state change: users whose NotebookLM shows Connected without a verified session will see it flip to disconnected with an explanation. That is the fix, not a regression, and the release note should say so plainly.

Extension changes require the user to reload the unpacked extension — already true of every extension change in this issue, and already communicated in previous rounds.

## Open Questions

1. ~~Does a document/extract suspension concept exist in the repository layer?~~ **Resolved: no `is_suspended`, but `is_dismissed` provides the same reversible semantics.** See D2.
2. ~~Does `window.prompt()` return in this WebView build?~~ **Resolved: no.** wry 0.55.1 implements no JS-dialog delegate methods, so `prompt()` returns `null` and `confirm()` returns `false`. See D7.
3. ~~Can the reporter supply the extension service-worker console from a failing save?~~ **Superseded.** Tracing every caller of `requestAIAnalysis` found no live path that can produce an unfitted request near 10 MB, and the reporter's own round-2 comment says the 413 was already gone after updating to v1.91.0. No longer worth asking for; group 5 ships as hardening, not a targeted fix. See D3.
4. When the priority slider is missing, does switching tabs restore it, or only a restart? Tab-switch ⇒ a render/measurement bug, independent of D6. Restart-only ⇒ D6's hypothesis holds. This single question splits the remaining ambiguity and costs one comment.
