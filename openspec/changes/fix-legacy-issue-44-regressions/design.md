## Context

Incrementum issue #44's final reporter follow-up (2026-08-17, retested on Incrementum v2.7.0, tag `6d9e8976`) is the canonical defect list for this change. Plethora forked from Incrementum at `6881032c` (2026-08-17), after that tag, so the reporter-tested behavior is Plethora's starting point; per-file diffs (`git diff v2.7.0..HEAD`) confirm every affected subsystem is unchanged or rebrand-only except selection-interaction V2 (Bug 06 invocation) and AI-provider fixes. The prior fix round (`openspec/changes/fix-issue-44-bugs`, all tasks checked, shipped as Incrementum v2.5.0/v2.5.1) was retested by the reporter and found insufficient for Bugs 01/02/03/05; Bug 04 and Bugs 06–12 are first-time reports. Each decision below therefore starts from *why the prior fix (if any) did not close the report*, verified against current Plethora source.

Constraints carried through every decision: current security boundaries stay intact (loopback proxy SSRF validation, iframe sandbox, CSP `frame-src`); SQLite persistence invariants hold (no destructive migrations); the Extract reader keeps its reading presentation and stays Search-free; no live third-party service is required by CI.

## Goals / Non-Goals

**Goals:**
- Close all ten still-valid defects (Bugs 01–09, 11, 12) at root cause in Plethora's current architecture, and harden the Bug 10 class with an invariant.
- Make every "silently empty / silently broken" path in scope either work or surface an actionable error — the common thread across Bugs 02, 03, 04, 05, 06, 07.
- Pin each fix with a regression test at the strongest available layer (Rust unit, Vitest component/integration, or fixture-based), per the triage matrix's coverage column.

**Non-Goals:**
- No redesign of the Universe renderer, NotebookLM CLI protocol, queue scheduler, or extract data model beyond what the fixes require.
- No porting of Incrementum's post-fork security-hardening commits (eight commits, none related to #44).
- No popup-dictionary or quick-review-explanation features from the reporter's non-bug questions; no occlusion fixes (already handled pre-fork).
- No new external dependencies unless the OCR rasterization decision (D4) selects one, in which case it must be recorded as an open question resolved at implementation time.

## Decisions

### D1 — Universe: re-frame on scope change; center on the visible core (Bug 01)

**Current:** `UniverseEngine.setData` recomputes `homeTarget` from the new layout but copies it into `orbit.target` only when `this.layout === null || this.isAtHomeView()` (`src/components/graph/universe/engine.ts:765,850-853`). After any zoom tick, pan, or node focus, `isAtHomeView()` is false, so a scope change keeps the *previous* collection's camera while the galaxy moves under it. Separately, `homeTarget` is the midpoint of the *full* envelope including the tag halo (~1.28× core radius, `layout.ts:402`) and the Oort belt (~1.18×, `layout.ts:415`); with sparse rims (typical for Favorites/All scopes) that midpoint sits off the visible core (`layout.ts:437-456`), so even a perfect recenter looks "not centered". The prior fix only widened the `resize()` path — `git diff v2.7.0..HEAD` on `src/components/graph/` is empty, i.e. the reporter tested exactly this code.

**Change:**
1. In `KnowledgeUniverse.tsx`'s data effect, distinguish *scope/data replacement* from *incremental edits*: when the incoming dataset's identity (collection/scope) differs from the last, call `engine.resetView(true)` (or `setFocus({level:"universe"}, {instant:true})`) after `setData`, deliberately re-framing.
2. In `engine.setData`, when `focus.level === "universe"` and data changed, tween `orbit.target`→`homeTarget` and `orbit.dist`→`homeDist` instead of snapping only-when-at-home; non-universe focus (a focused system/node) is preserved as today.
3. In `layout.ts`, compute `layout.center` from the **core envelope** (clusters + visible system nodes); halo/belt content contributes to `bounds`/fit distance, not the midpoint.
4. Extract the follow-home decision into a pure helper (like `cameraFit.ts`) so it is testable without a WebGL canvas — today no engine-level test exists at all (`KnowledgeUniverse.test.tsx` from the prior fix's task 4.2 does not exist in the repo).

**Alternatives:** Widening `isAtHomeView()` tolerances further (the prior fix's approach) — rejected: it still misses every deliberate pan and does not address the biased center. Always resetting the camera on any `setData` — rejected: it would fight the preserved-focus behavior pinned by `center-knowledge-universe-viewports` (task 2.2) for same-data updates; scope-change re-framing reconciles the two specs by distinguishing the events.

**Tests:** pure-function tests for the follow-home gate (scope change ⇒ re-frame; same-data edit with user pan ⇒ preserve); `layout.test.ts` cases asserting the core-based center with a one-sided halo.

### D2 — NotebookLM: never fabricate an empty list; verify before "connected" (Bug 02)

**Current:** `notebooklm_list_notebooks` treats exit-0-but-not-JSON stdout as a genuine empty list and returns `Ok(vec![])` with no warning (`src-tauri/src/notebooklm.rs:1459-1465`) — the frontend then sets `connected` (`NotebookLMPage.tsx:118-126`) and shows the Connected badge over an empty workspace: exactly the reported symptom, surviving both prior fix rounds (`fix-issue-40`'s fail-closed auth + `fix-issue-44-bugs`' error surfacing). `parse_notebook_list` also returns `vec![]` for any unrecognized envelope (`:1297`). Strategy-2 CLI login reports success without verification and writes `auth.connected = true` (`:4650-4678`). The page's 12 s list timeout races a Playwright-launched Chromium CLI (`NotebookLMPage.tsx:94,103-107`).

**Change:**
1. `Ok(vec![])` is returned **only** for a parseable empty envelope; non-empty unparseable stdout becomes `IntegrationError` carrying the raw output (truncated), which the existing error state already surfaces with the re-authenticate action.
2. `parse_notebook_list` rejects unknown JSON shapes instead of mapping them to empty; entries missing ids are counted and reported in the error, not silently dropped.
3. Strategy-2 login verifies via `auth check --json` before reporting success (mirroring strategies 1 and 3); `notebooklm_connect` no longer persists `connected=true` without verification.
4. The listing call from `checkConnection` distinguishes "verified, zero notebooks" from failure in the UI copy (the spec's scenario), and the timeout is raised/configurable so bootstrap-heavy first listings are not reported as errors.

**Alternatives:** Health performs a listing to unify evidence — deferred: it doubles login latency; the fabricated-empty fix removes the lie the badge told. Re-pinning `notebooklm-py` beyond `0.8.0rc1` — out of scope until upstream ships a stable release; recorded as an open question.

**Tests:** Rust unit tests for exit-0-non-JSON, unknown envelope, id-less entries, and strategy-2 verification (CLI runner faked); frontend test asserting Connected-with-zero is reachable only from a verified empty envelope.

### D3 — Section mentions: stable identity, honest states, tolerant matching (Bug 03)

**Current:** The TOC fix from round 1 exists and is tested (`sectionIndex.ts:840-851`). The residual failures are elsewhere: (a) Document Q&A inserts `#{title}` tokens but `handleInputChange` filters chips by id, so the first keystroke after a pick empties the selection (`DocumentQATab.tsx:532-534` vs `:582`); (b) `#` is gated to `context?.type === "document"` in the Assistant (`AssistantPanel.tsx:2002-2005,3049`) and shows "No sections available" in Whole-Library mode and while sections lazily load (`useDocumentSections` fetch, `isLoading` never passed); (c) send-time matching is exact and case-sensitive (`sectionIndex.ts:81-83`); (d) pseudo-document contexts (podcast with no `documentId`; scroll-mode `documentId: "extract:<id>"`) resolve structurally and fail with the reporter's exact captured error ("Could not focus the selected section… no request was made"); (e) **Note IDs were never resolvable** — the catalog only contains section nodes of the targeted document, so the reporter's "tested with several Note IDs" could only ever fail.

**Change:**
1. Make chip identity consistent end-to-end: insert `#{id}` and render the title (or filter by title consistently) so chips survive keystrokes, display formatting, and history restore.
2. Pass `isLoading` to `SectionMentionPopup`; replace "No sections available" with explanatory copy in Whole-Library mode and non-document contexts ("`#` references sections of an open document — mention a document with `@` first").
3. Normalize (case, whitespace, punctuation) title comparisons in `resolvePromptSectionMentions` before declaring `unresolved`.
4. For pseudo-document contexts, resolve against the already-attached transcript/extract content instead of attempting structural document-text resolution; if impossible, an explanatory message replaces the generic failure.
5. Scope statement: `#` remains a *document-section* reference; Note/extract references are surfaced via the honest-copy above rather than building a new note-search catalog (product decision recorded as an open question; the reporter's underlying need is met by @-mentioning the document that contains the note).

**Alternatives:** Extending the catalog with notes/extracts — rejected for this change: it crosses into the `@` document-mention subsystem and the unified extract editor (D8) already gives extracts a first-class surface; revisit if reporters ask again.

**Tests:** chip-survival across keystrokes and history in `DocumentQATab`; popup loading/unavailable states; normalization cases (case, punctuation) in `resolvePromptSectionMentions`; podcast/extract-context send resolves or explains.

### D4 — OCR: deterministic init, propagated settings, preflight, rasterization (Bug 04)

**Current:** Four independent breakages, any of which alone matches "OCR cannot be performed": (1) `OCR_PROCESSOR` starts `None`, `init_ocr` has zero production callers, and three call sites (`pdfCanonicalOcr.ts:71`, `mathOcr.ts:54`, `PdfOcrManager.retryOcr:197-201`) never run `ensureOCRConfig` — the reporter's screenshot captures the resulting `"ocr_image_bytes" failed: OCR processor not initialized`; (2) `OCRSettings.tsx` persists only to localStorage; nothing pushes config to the backend; (3) `ocr_pdf_file`'s per-page failures are swallowed into blank pages and the response still says `success: true` (`commands/ocr.rs:512-555`), and `extract_pdf_page_image` only extracts embedded JPEG/JPX images — no rasterization — so most PDFs yield nothing (`:348-385`); (4) Tesseract hardcodes `-l eng` so the language setting is a no-op (`ocr/providers.rs:449,508`); the default provider (Tesseract) is not bundled, and its actionable "not installed" guidance never reaches the user.

**Change:**
1. Initialize the processor at app startup with persisted settings (Rust `setup`), and make `OCRSettings` save push `update_ocr_config`; delete the scattered per-call `ensureOCRConfig` requirement (keep a lazy fallback for safety).
2. Preflight `provider.is_available()` in `ocr_image_file`/`ocr_image_bytes`/`ocr_pdf_file`; a missing provider returns `success:false` with the installation-guidance message; if every page fails or all text is empty, the response is `success:false` with the first real error.
3. Rasterize PDF pages for image-only providers instead of embedded-JPEG-only extraction (frontend pdf.js render exists at `pdfReflowOcr.renderPageForOcr`; a Rust-side rasterizer is the alternative — selection deferred to an open question). Implement or delete the dead `process_pdf`/`process_pdf_page` stubs (`ocr/processor.rs:32-55`).
4. Thread `language` from request to `TesseractProvider` args.
5. Fold the overlap with the pending `add-glm-ocr-provider`/`add-glm-ocr-runtime-setup` changes by referencing them: GLM availability preflight uses their runtime checks; those folders are not modified.

**Alternatives:** Keep per-call `ensureOCRConfig` and just fix its callers — rejected: three call sites already missed it; startup init removes the class of bug.

**Tests:** Rust tests for preflight-missing-provider, all-pages-failed semantics, rasterized-page path (fixture PDF), language arg threading; frontend test that saving OCR settings invokes `update_ocr_config`; `pdfCanonicalOcr`/`mathOcr` calls succeed on a cold start (mocked invoke asserting initialization order).

### D5 — Due All: forecast parity, real sentinel, import threading (Bug 05)

**Current:** The queue list itself includes learning items, extracts, video extracts, and documents (`commands/queue.rs:574-825`) — but the graphs compute from a narrower dataset: `get_workload_forecast_grouped` counts only learning items + documents, only `due_date >= start-of-today` (`repository.rs:6152-6182`), so an overdue- or extract-heavy library renders the zero-workload graph the reporter photographed ("Min Reviews" axis, screenshot 1). The round-1 collection fallback guards on the literal `"default"` while the real default-collection id is the UUID `00000000-…-0001` (`repository.rs:2596` vs `models/collection.rs:7`) — dead code today (schema backfills the UUID), live for any legacy row with NULL/empty. Imports strand cards in the default collection while their document goes to the chosen one (`study_json_import.rs:255-301`). Nothing changed due-ness semantics after the round-1 fix (`git log` on `queue.rs`/`queueStore.ts` confirms), so these are original design gaps, not regressions.

**Change:**
1. Forecast parity: count extracts (`next_review_date`, `is_dismissed`) and video extracts alongside cards and documents; bucket everything overdue into a leading "overdue/backlog" point (or today's bucket — picked at implementation for chart clarity) so the backlog is visible rather than zero; extend `DueForecastPoint` and the Schedule/Analytics series accordingly.
2. Sentinel: resolve "is default collection" once in `queue.rs` against `DEFAULT_COLLECTION_ID` and pass the semantics down; apply the same fallback across learning-item, document, extract, and video-extract due queries so all four item types scope identically.
3. Thread the chosen `collection_id` through `build_learning_item` in `study_json_import.rs` (and audit `anki.rs`/`legacy_third_party_import.rs` for the same pattern).
4. Document the "Due All = due through end of today UTC" semantic in the filter description copy if product wants "all scheduled" instead — open question, default is keep current semantics.

**Tests:** Rust tests for the UUID fallback (legacy NULL/empty rows), extract/video-extract inclusion in `get_due_queue_items`, overdue bucketing in the forecast; an import test asserting imported cards land in the chosen collection.

### D6 — Reader search teardown: surgical unwrap (Bug 06)

**Current:** `MarkdownViewer`'s highlight effect caches "original" HTML keyed by a signature that excludes the query; the restore is dead code (the cache is overwritten from the currently-marked DOM before restore reads it), and the empty-query early return never unwraps `mark[data-search-highlight]` (`MarkdownViewer.tsx:153-257`). After clear: stale amber marks persist, re-searches nest marks inside marks (the TreeWalker skip filter only excludes persisted highlight wrappers, `:190`), and any later highlight/content change bakes marks into the cached baseline. The file is byte-identical to v2.7.0. Post-v2.7.0, the AI invocation path was rebuilt (selection-interaction V2, default-on) to snapshot the live DOM selection (`useSelectionInteraction.ts:526-553`), which likely absorbs the symptom; but the legacy memo still omits `selectedText` (`DocumentViewer.tsx:2330`), and the reporter's diagnostics screenshot shows the actions failing with `ProviderOffline`/`Fallback: none` — the provider-side failure the recent `c0b92608`/`f937bb1e` commits address. The DOM teardown defect is the part this change owns.

**Change:**
1. On every effect run, unwrap existing `mark[data-search-highlight]` nodes surgically (`parent.replaceChild(textNode, mark); parent.normalize()`) *before* matching — the exact pattern already shipped twice in this codebase (`removeAllHighlightMarks`, `unwrapPreviousSearchMarks`). No `innerHTML` reassignment, so live selections anchored in surviving text nodes are preserved (the goal of the commit `c879330f` that broke this). The empty-query branch then leaves a pristine DOM.
2. Add `selectedText` to the AI menu memo dependencies (or read from a ref) so the legacy path cannot act on a stale selection.
3. Verify V2 capture works against a post-teardown DOM via the existing selection-interaction test suite; no provider changes here.

**Alternatives:** Adding the query to the cache signature — rejected: it resurrects the destructive full-`innerHTML` reset that `c879330f` removed. Re-rendering content from source on clear — rejected: heavier and loses scroll/selection state.

**Tests:** new `MarkdownViewer` test file: clear restores mark-free DOM; re-search does not nest marks; highlight creation after a cleared search does not bake marks into the baseline; selection survives unwrap.

### D7 — Browser redirectors: unwrap before proxy, watchdog for escapes (Bug 07)

**Current:** Google result links point at `google.com/url?q=<target>`; the injected bridge posts them as-is (`webview-extract-bridge.ts:280-307` → `WebBrowserTab.tsx:856-871`), the loopback proxy fetches with a desktop-Chrome UA and **no cookie jar** (`web_proxy.rs:16-18,48-49`), and Google answers cookie-less requests with an HTTP 200 "Redirect Notice" interstitial (live-verified 2026-08-18 with the proxy's exact UA) which the proxy frames verbatim — a nearly blank page. Non-redirector links (the reporter's "Wikipedia info links") work through the same path. Separately, any navigation that escapes the bridge hits the CSP `frame-src` allowlist and dies silently because the blocked-frame fallback is gated `!isTauri()` (`WebBrowserTab.tsx:1363`).

**Change:**
1. Unwrap known redirector URLs **before** requesting the proxy, in `handleBridgeNavigate` (single choke point): `www.google.com/url?q=`, `www.google.com/imgres?imgurl=`, `duckduckgo.com/l/?uddg=`, `bing.com/ck/a`'s base64 `u=` param. The unwrapped target flows through the unchanged `isSafeWebUrl` check and the proxy's per-hop SSRF validation — no security surface is widened.
2. Add a Tauri-path watchdog mirroring `scheduleIframeBlockedFallback`: if the frame navigates off-proxy or no bridge `ready` arrives within N ms, show the existing failure state (Reader View / open in system browser) instead of a white frame.
3. Keep sandbox attrs and CSP exactly as they are.

**Alternatives:** Teaching the proxy to follow interstitials server-side — rejected: fragile HTML parsing of adversary-controlled pages; the client-side unwrap is deterministic. Loosening `frame-src` — explicitly forbidden.

**Tests:** unit tests for the unwrap table (param extraction, malformed values, non-redirector pass-through); watchdog timer test; a proxy test pinning that a 200-HTML interstitial from an unknown host is not silently special-cased.

### D8 — Unified extract editor: one surface, one data shape (Bugs 08 + 12)

**Current:** Two funnels with different capabilities: every fast path (selection pill, context menu, selection bar/sheet, Ctrl+E, extract mode, PDF OCR-extract — all routed via `createInstantExtract`/`handleInlineExtract`, `useToastExtract.ts:23-83`) creates a plain-text row with no dialog; the lightbulb/"Add note" path opens `CreateExtractDialog` with annotations, article images, and the embedded `ImageRegistryLibrary`. Post-creation, `EditExtractDialog` has **no registry section** and `UpdateExtractInput` cannot write `html_content` (`api/extracts.ts:65-73`), so a fast-path extract can never be given images — the reporter's exact divergence. Formatting is doubly broken: `applyAnnotation` early-returns unless the textarea itself is `document.activeElement`, which clicking a toolbar button breaks (`CreateExtractDialog.tsx:152-154`, `EditExtractDialog.tsx:88-90`; jsDOM tests never move focus, so this passed unnoticed), and even applied markup is inert because reading surfaces render `content` verbatim while `html_content` is only generated when images are attached (`CreateExtractDialog.tsx:303-324`).

**Change:**
1. Merge `CreateExtractDialog` and `EditExtractDialog` into one shared extract editor (annotations, article images, embedded registry, metadata) used for creation *and* editing; the fast paths keep their one-click flow but their toast "Edit" action and every list/reader affordance open the same editor, making images attachable after creation.
2. Extend `UpdateExtractInput` + `update_extract` to write `html_content`; regenerate it from markdown when no images exist so text-only extracts still get rendered formatting (Rust preserves it when `None`, `commands/extract.rs:108-110` — the frontend simply gains the ability to send it).
3. Fix the annotation toolbar: hold a textarea ref, `onMouseDown={e => e.preventDefault()}` on buttons, bind Cmd/Ctrl+B/I/U; operate on the current selection when one exists, else insert at cursor ("Select text to format" hint becomes accurate).
4. Render `content` through the existing `renderMarkdown` (`src/utils/markdown.ts:183`) whenever `html_content` is absent, in `ExtractsList`, `ExtractReader`, and `ExtractScrollItem` — preserving the sandboxed reading presentation; `ExtractReader` stays Search-free.
5. `PasteExtractDialog` and other direct-`createExtract` callers converge on the same input shape (they need no registry UI, but their extracts remain editable into the shared editor).

**Alternatives:** Giving the fast paths their own mini-registry — rejected: duplicates the surface the reporter already found inconsistent. A rich-text (TipTap/ProseMirror) editor — rejected: the codebase's extracts are textarea+markdown throughout; introducing a rich editor is a redesign, and the reading-presentation requirement favors markdown.

**Tests:** parity test (both creation funnels produce rows editable to the same capability set); post-creation image attach persists and renders; annotation buttons apply to selected text via ref (simulate mousedown); markdown rendering in all three reading surfaces; `update_extract` Rust test for `html_content` write/preserve.

### D9 — Image ingest: focus-independent paste, drop handlers, full-res embeds (Bug 09)

**Current:** The registry's paste button uses `navigator.clipboard.read()` (blocked on WKWebView — the reporter's toast screenshot) and its `onPasteCapture` fires only when focus is inside the library container (`ImageRegistryLibrary.tsx:183-224`); pasting while the dialog's textarea is focused drops the image silently. **No `onDrop` handler exists in any extract or registry surface** (repo-wide `onDrop` survey), so dragged images fall through to the document import zone or the WebView default — the historical "rendering errors". Registry picks embed the 256 px list thumbnail (`image_registry.rs:353-389` → `CreateExtractDialog.tsx:312`).

**Change:**
1. In the shared extract editor (D8), route image-typed paste events at the dialog level to the embedded registry regardless of inner focus (`onPasteCapture` on the dialog root; text paste still goes to the textarea).
2. Add drop handling on the editor/registry: dragged image files go through `ingest_image_asset` (the canonical pipeline) with the existing type/size validation and a visible drag-over state; drops that aren't images are ignored, not error pages.
3. Embed full-resolution assets (fetch via `get_image_asset`) instead of list thumbnails when attaching to an extract.

**Alternatives:** Global paste routing through `GlobalPasteHandler` — rejected for the dialog case: the handler targets the main view; the dialog owns its scope.

**Tests:** paste with focus in the textarea still ingests the image (component test with a synthetic clipboard event); drop ingest happy path + rejected non-image; embed uses the full-res asset id.

### D10 — Deck visibility: materialize on save (Bug 10, hardening)

**Current:** `"Default Deck"` never existed anywhere in this repo's history (pickaxe across all commits); decks are virtual tag filters in one zustand store read identically by the studio picker and Deck Manager, so the reported creation-vs-manager divergence cannot occur through current code. The adjacent real gap: cards saved with a `deck:` tag or a studio `seed.deckTag` do not always materialize the `StudyDeck` (`FlashcardStudioModal.tsx:3091`), so a deck reference that existed at creation can be invisible in Deck Manager until another surface reconciles — the reporter's screenshots (6 cards, 0 decks; "5 due" with an empty manager) are consistent with this class. Decks are also per-device localStorage (documented behavior, unchanged).

**Change:** whenever a card is saved with a deck reference (studio save, assistant tagging, `:deck` command), materialize the corresponding `StudyDeck` via the existing `ensureDecksExist` pattern in the same code path, so creation-time deck references are immediately visible and editable in Deck Manager. Add a regression test asserting the parity invariant: every deck offerable in the studio picker appears in Deck Manager's list after save. No synthetic "Default Deck" is created — the app's model is "No deck" plus real decks, and inventing a system deck would contradict it.

**Alternatives:** Seeding a guaranteed default deck (migration-065 collection precedent) — rejected: collections are a data partition requiring a default; decks are user-defined filters with an explicit "No deck" state.

**Tests:** store test — saving a card with a new deck tag creates the deck; picker↔manager parity test.

### D11 — Category editing: follow the tag-editor pattern (Bug 11)

**Current:** v2.5.0 shipped import-default assignment and the Library category *filter* (commit `127d747c`), but no edit surface: the reader's only affordance is a title rename; `ItemDetailsPopover` renders the category read-only beside an editable tag editor; the sole document-category editor is the Knowledge Graph node panel (`NodeDetailView.tsx:118-194`). Rust `get_categories`/`create_category` are `TODO` stubs (`commands/category.rs:8-19`); `documents.category` is free-form text by design (migration 038 removed the FK); `update_document` can set but never clear a category (`repository.rs:1242`); Stats groups extract categories only (`analytics.rs:377-394`).

**Change:**
1. Add an inline category editor to `ItemDetailsPopover` (it already imports `updateDocument` and persists tag edits) — preset chips derived from the union of existing document categories plus free-text input, mirroring `EditExtractDialog`'s category field.
2. Expose the same field in the Library's document details/context menu surface (`DocumentsView` already has `updateDocument` plumbing), so "modify the category from the library or the document" is satisfied in both places the reporter looked.
3. Allow clearing (empty ⇒ `None`/unset) by fixing the empty-string filter before `COALESCE`.
4. Extend `get_category_stats` to also group `documents.category` so Stats reflects document categorization.
5. Leave the `categories` table stubs alone (no registry is being introduced; categories remain free-form per migration 038's decision).

**Alternatives:** Implementing the stubbed category registry + a Category Manager — rejected for scope: free-form categories plus derived chips match the shipped tag model and the Library filter; a registry with rename-repointing is a product change, not a bug fix.

**Tests:** popover/Library edit persists and clears; Library filter and queue chips reflect the change after edit; analytics includes document categories.

## Risks / Trade-offs

- **[Risk] Universe re-frame fights muscle memory of users who pan, then switch scope expecting their camera.** → Mitigation: only scope/data *replacement* re-frames; same-data edits preserve the camera (D1.1), and the tween is short.
- **[Risk] NotebookLM strict parsing turns previously-"successful" empty listings into errors.** → Mitigation: that is the point — the error carries the raw CLI output and the existing re-authenticate action; a parseable empty envelope still shows the healthy empty state.
- **[Risk] OCR rasterization adds a dependency or heavy path.** → Mitigation: prefer the existing frontend pdf.js renderer first; the Rust-side rasterizer choice is an explicit open question; failures degrade to the preflight error, never a silent blank.
- **[Risk] Forecast overdue bucketing changes chart shape for existing users.** → Mitigation: overdue is additive (a leading bucket), existing forward buckets unchanged.
- **[Risk] Markdown unwrap could disturb a selection anchored inside a removed mark.** → Mitigation: unwrap only runs on search-clear/re-search, where the marks are the anomaly; `normalize()` merges text nodes without resetting scroll; test coverage pins selection survival in surviving text.
- **[Risk] Redirector unwrap list needs maintenance as search engines change.** → Mitigation: table-driven, unknown redirectors degrade to today's behavior plus the new watchdog surfacing.
- **[Risk] Merging the extract dialogs changes the lightbulb flow users know.** → Mitigation: the merged editor is the current `CreateExtractDialog` experience extended with edit capability; fast paths still create in one click.
- **[Risk] `html_content` regeneration could clobber hand-authored HTML.** → Mitigation: frontend sends regenerated content only from its own editor state; Rust `None`-preserve semantics unchanged.

## Migration Plan

All changes are backward-compatible: no schema migrations (only `update_document` semantics and new optional fields on existing update paths), no settings-format changes (OCR settings gain propagation, not shape), localStorage deck store unchanged in format. Rollback is per-fix revert; no data written by these fixes needs unwinding.

## Open Questions

1. **OCR rasterization locus** — frontend pdf.js page rendering (exists, keeps Rust lean) vs Rust-side rasterizer (works for headless/auto-OCR). Decide at implementation of D4.3; default: frontend first.
2. **Overdue forecast bucket** — leading "Overdue" data point vs folding into today's bucket. Default: leading point (matches "Tackle backlog first" queue copy).
3. **"Due All" semantics** — keep "due through end of today UTC" (current) vs "all scheduled items". Default: keep; adjust filter description copy only.
4. **Note references via `#`** — the reporter expected Note IDs to resolve. This change makes `#` honestly document-scoped (D3.5); a note/extract mention catalog is a candidate follow-up change if requested again.
5. **NotebookLM CLI pin** — revisit `notebooklm-py==0.8.0rc1` once a stable release with working post-rebrand listing exists; not blocking D2 (fail-honest now).
