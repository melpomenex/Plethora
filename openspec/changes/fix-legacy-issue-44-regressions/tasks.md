## 1. Knowledge Universe re-framing (Bug 01 — `knowledge-universe-scope-reframing`)

- [x] 1.1 Extract the follow-home decision into a pure, WebGL-free helper (beside `src/components/graph/universe/cameraFit.ts`) taking `{ scopeChanged, focusLevel, isAtHomeView }` and returning whether the camera re-frames; wire `engine.setData` (`src/components/graph/universe/engine.ts:765,850-853`) through it so a scope/dataset replacement re-frames (tween `orbit.target`→`homeTarget`, `orbit.dist`→`homeDist`) while same-data edits preserve a panned camera and non-universe focus is preserved
- [x] 1.2 In `KnowledgeUniverse.tsx`'s data effect (~194-209), detect scope/dataset replacement (collection/scope or filter-set identity change) and trigger the re-frame after `setData` (instant or short tween), keeping `engine.resetView` semantics for explicit user resets
- [x] 1.3 Change `layout.center` in `src/components/graph/universe/layout.ts:437-456` to the core envelope (clusters + visible system nodes); keep halo/Oort rim inside `bounds`/fit distance so rim content stays visible but no longer displaces the center
- [x] 1.4 Tests: pure-helper cases (scope change from panned camera ⇒ re-frame; same-data edit ⇒ preserve; focused node ⇒ preserve focus) in `src/components/graph/universe/__tests__/`; extend `layout.test.ts` with a one-sided-halo case asserting core-based center and rim-inclusive bounds
- [ ] 1.5 Manual: switch Main → Favorites → All (and back) after panning/zooming in the running app on all three view hosts (`KnowledgeGraphPage` universe mode, `KnowledgeSphereTab`, mobile) and confirm centering without resize/reload

## 2. NotebookLM listing integrity (Bug 02 — `notebooklm-listing-integrity`)

- [x] 2.1 In `src-tauri/src/notebooklm.rs:1440-1466`, return `Ok(vec![])` only for a parseable empty envelope; non-JSON non-empty stdout becomes `IntegrationError` carrying truncated raw output; add a `tracing::warn` on the branch
- [x] 2.2 Harden `parse_notebook_list` (`:1258-1298`): unknown envelope shapes error instead of mapping to empty; id-less entries are counted and reported in the error
- [x] 2.3 Verify strategy-2 login before success (`:4509-4760`): run `auth check --json` (mirror strategies 1/3) before reporting success; stop persisting `auth.connected = true` from unverified paths (`:4650-4678`) and make `notebooklm_connect` (`:3267`) verification-gated
- [x] 2.4 Raise/configure the listing timeout in `src/pages/NotebookLMPage.tsx:91-149` (cold CLI bootstrap routinely exceeds 12 s); keep the error-vs-empty distinction from `:118-126` and ensure UI copy distinguishes "verified, no notebooks yet" from failure
- [x] 2.5 Rust tests (faked CLI runner): exit-0-non-JSON → error with raw output; unknown envelope → error; id-less entries → counted error; strategy-2 unverified → not connected. Frontend test: Connected+empty only from a parseable empty envelope; timeout state shows retry affordance
- [ ] 2.6 Manual (not CI): against the real bundled CLI, exercise login → list → empty-account → expired-session and record outcomes; re-pin `notebooklm-py` past `0.8.0rc1` only when a stable release ships (open question 5)

## 3. Section mention reliability (Bug 03 — `section-mention-reliability`)

- [x] 3.1 Fix token identity in `src/components/tabs/DocumentQATab.tsx`: insert `#{id}` at `:582` and render the title, or filter chips by title in `handleInputChange` (`:532-534`), `formatInputForDisplay` (`:474-486`), and history restore (`:668-692`) — one identity end-to-end
- [x] 3.2 Pass `isLoading` to `SectionMentionPopup` from `AssistantPanel.tsx:3049-3060` while section text loads; replace bare "No sections available" with explanatory copy for Whole-Library mode (`DocumentQATab.tsx:190-213`) and non-document assistant contexts (`AssistantPanel.tsx:2002-2005`)
- [x] 3.3 Normalize matching (case/whitespace/punctuation) in `resolvePromptSectionMentions` (`src/utils/sectionIndex.ts:70-118`); ambiguous normalized matches fail naming duplicates
- [x] 3.4 Route pseudo-document contexts: podcast (`PodcastManager.tsx:2424-2434`) and `extract:` ids (`QueueScrollPage.tsx:2400-2402`) resolve `#` against attached transcript/extract content, or error with a context-specific message instead of "Could not focus the selected section… no request was made" (`AssistantPanel.tsx:1321-1326`)
- [x] 3.5 Tests: chip survival across keystrokes + history restore (`DocumentQATab.test.tsx`); popup loading/unavailable states; normalization cases in `sectionIndex.test.ts`; podcast/extract-context send resolves-or-explains; update the honest-copy hint ("# references sections of an open document")

## 4. OCR pipeline availability (Bug 04 — `ocr-pipeline-availability`)

- [x] 4.1 Initialize the OCR processor at app startup from persisted settings (Rust `setup` in `src-tauri/src/lib.rs`, default config via existing `update_ocr_config` path); keep a lazy `ensureOCRConfig` fallback but remove the dependency of `pdfCanonicalOcr.ts:71`, `mathOcr.ts:54`, and `PdfOcrManager.retryOcr:197-201` on it
- [x] 4.2 Push settings on save: `src/components/settings/OCRSettings.tsx` invokes `update_ocr_config` when the user saves (map the store's fields to the backend config), replacing localStorage-only persistence of runtime-relevant fields
- [x] 4.3 Preflight and honest failure in `src-tauri/src/commands/ocr.rs`: check `provider.is_available()` in `ocr_image_file`/`ocr_image_bytes`/`ocr_pdf_file` and return `success:false` with the provider's guidance (e.g. `providers.rs:420` install message); in `ocr_pdf_file` (`:399-556`), all-pages-failed or empty combined text ⇒ `success:false` with the first error; remove per-page swallow-to-blank (`:512-519`)
- [x] 4.4 Rasterize PDF pages for image-only providers: resolve open question 1 (default: reuse the frontend pdf.js renderer pattern from `src/components/viewer/pdfReflowOcr.ts:20-31`, adding a Rust fallback only if a headless path needs it); delete or implement the dead stubs in `src-tauri/src/ocr/processor.rs:32-55`; surface the "no usable text layer" → OCR fallback path's errors verbatim in `DocumentViewer.tsx:4844-4916`
- [x] 4.5 Thread `language` from request to `TesseractProvider` args (`src-tauri/src/ocr/providers.rs:449,505-511`), replacing hardcoded `-l eng`
- [x] 4.6 Tests: Rust — preflight-missing-provider, all-pages-failed semantics, language arg threading, rasterized-page path with a fixture PDF; frontend — saving OCR settings invokes `update_ocr_config` (`OCRSettings` test), cold-start `ocrImageBytes` call sequence (mocked invoke) for `pdfCanonicalOcr` and the occlusion AI-assist path from screenshot 11
- [x] 4.7 Cross-reference: do not duplicate `add-glm-ocr-provider`/`add-glm-ocr-runtime-setup` work — GLM availability preflight reuses their runtime checks; leave those change folders untouched

## 5. Due-queue completeness (Bug 05 — `due-queue-completeness`)

- [x] 5.1 Extend `get_workload_forecast_grouped` (`src-tauri/src/database/repository.rs:6152-6182`) to count text extracts (`next_review_date`, `is_dismissed = 0`) and video extracts, and to bucket overdue items into a leading overdue point; extend `DueForecastPoint` (`src-tauri/src/commands/algorithm.rs:671-676`) and wire the new series into `ScheduleView.tsx:151-171` and `analytics/ScheduleVisualization.tsx:41,85-100` (resolve open question 2: default leading point)
- [x] 5.2 Fix the collection sentinel: resolve "is default collection" once in `src-tauri/src/commands/queue.rs` against `DEFAULT_COLLECTION_ID` and pass semantics down; apply the same fallback (sentinel OR legacy NULL/empty) across `get_due_learning_items` (`repository.rs:2590-2622`), `list_due_documents_for_queue` (`:1131-1170`), and the extract/video-extract collection skips (`queue.rs:677-681,722-726`)
- [x] 5.3 Thread the chosen collection through imports: `build_learning_item` in `src-tauri/src/study_json_import.rs` (`:185,255-301`); audit `anki.rs` and `legacy_third_party_import.rs` for the same pattern and fix identically
- [x] 5.4 Rust tests: UUID-default fallback includes legacy NULL/empty rows for all four item types; extract/video-extract inclusion in `get_due_queue_items_from_repo_at`; overdue bucket non-zero for a fully-overdue fixture; import test asserting created cards carry the chosen collection id
- [x] 5.5 Review the Due All filter description copy (`queue.filterDueAllDesc`) against the kept "due through today UTC" semantics (open question 3) and adjust the label if product chooses "all scheduled"

## 6. Reader search teardown (Bug 06 — `reader-search-teardown`)

- [x] 6.1 Replace the dead innerHTML restore in `src/components/viewer/MarkdownViewer.tsx:153-257` with a surgical unwrap of all `mark[data-search-highlight]` (pattern: `removeAllHighlightMarks` in `src/utils/textHighlights.ts:120-130`) executed at the top of every effect run before matching, so the empty-query branch (`:169-173`) leaves a pristine DOM; no `innerHTML` reassignment and no signature change
- [x] 6.2 Add `selectedText` to the AI action memo dependencies (or read from a ref) at `src/components/viewer/DocumentViewer.tsx:2330` so the legacy (V2-off) path cannot act on a stale selection; verify V2 `captureForAction` against a post-teardown DOM
- [x] 6.3 New test file `src/components/viewer/__tests__/MarkdownViewer.search.test.tsx`: clear removes all marks; second search never nests marks; persistent highlight created after a cleared search doesn't bake marks into the baseline; selection in surviving text survives unwrap; AI action executes against a fresh selection immediately after clear
- [ ] 6.4 Manual: on the running app, replay the reporter's exact repro (note → AI action → search → clear → AI action) with selection-interaction V2 both on and off

## 7. Embedded browser redirectors (Bug 07 — `embedded-browser-redirectors`)

- [x] 7.1 Add a table-driven redirector unwrap (`google.com/url?q=`, `google.com/imgres?imgurl=`, `duckduckgo.com/l/?uddg=`, `bing.com/ck/a` `u=` base64) and apply it in `handleBridgeNavigate` (`src/components/tabs/WebBrowserTab.tsx:856-871`) before setting `requestedUrl`; unwrapped targets still pass `isSafeWebUrl` (`:525-532`) and the proxy's per-hop validation; malformed params fall back to the original URL
- [x] 7.2 Add a Tauri-path watchdog mirroring `scheduleIframeBlockedFallback` (`WebBrowserTab.tsx:506-510`): if no bridge `ready` arrives within N ms of a navigation request (or the frame leaves the proxy), show the existing blocked/failure state (reader view / open in system browser); remove the `!isTauri()` gate at `:1363` for this state
- [x] 7.3 Confirm zero security-config drift: sandbox attrs (`:1425`) and CSP `frame-src` (`src-tauri/tauri.conf.json:36-37`) untouched; add tests — unwrap table unit tests (param extraction, malformed, pass-through), private/loopback redirector target rejected through existing validation, watchdog timer fires and shows fallback; keep the proxy Rust tests green (`web_proxy.rs:472-701`)
- [ ] 7.4 Manual (not CI): live Google/DuckDuckGo/Bing result clicks in the embedded browser load target pages; record any remaining interstitial-only engines in the change notes

## 8. Unified extract editor (Bugs 08 + 12 — `unified-extract-editor`)

- [x] 8.1 Merge `src/components/extracts/EditExtractDialog.tsx` into `CreateExtractDialog.tsx` (shared component supporting create and edit modes: annotations, article images, embedded `ImageRegistryLibrary`, notes/category/tags/color/disclosure); route the quick-extract toast "Edit" action (`src/hooks/useToastExtract.ts`), `ExtractsList`, and `ExtractsTab` edit affordances to it; keep one-click quick extraction unchanged
- [x] 8.2 Extend the update path for rich content: add `html_content` to `UpdateExtractInput` (`src/api/extracts.ts:65-73`) and accept it in `update_extract` (`src-tauri/src/commands/extract.rs:108-110`, preserving stored value when `None`); regenerate `html_content` from the content's markdown when no images are attached
- [x] 8.3 Fix annotation controls: textarea ref + `onMouseDown={e => e.preventDefault()}` on toolbar buttons, operate on the live selection (insert at cursor otherwise), bind Cmd/Ctrl+B/I (+U where available) — replacing the `document.activeElement` guard (`CreateExtractDialog.tsx:152-154`, `EditExtractDialog.tsx:88-90`)
- [x] 8.4 Render formatting in reading surfaces: pass `content` through `renderMarkdown` (`src/utils/markdown.ts:183`) when `html_content` is absent, in `ExtractsList.tsx:630-644`, `tabs/ExtractReader.tsx:189-195`, and `review/ExtractScrollItem.tsx:398-425`; keep the Extract reader search-free and its sandboxed reading presentation unchanged
- [x] 8.5 Tests: parity (both creation funnels yield extracts editable to the same capability set; registry attachable post-creation and persists/renders after reopen); annotation button applies to a selection via simulated mousedown; markdown rendering in all three surfaces; Rust `update_extract` html_content write/preserve test; `Update & Regenerate Cards` flow still works after the merge
- [ ] 8.6 Manual: replay the reporter's divergence — select-text extract vs lightbulb extract, then attach an image and bold text to each; confirm identical capability and persistence after reopen

## 9. Extract image ingest (Bug 09 — `extract-image-ingest`, depends on group 8)

- [x] 9.1 Dialog-level paste routing: `onPasteCapture` on the shared extract editor root routes image-typed paste to the embedded registry regardless of inner focus (text paste still reaches the textarea); covers the WKWebView case where `clipboard.read()` is blocked (screenshot 5's toast path)
- [x] 9.2 Drop handling on the editor and `ImageRegistryLibrary` (`src/components/image-registry/ImageRegistryLibrary.tsx`): visible drag-over state; image files ingest via `ingest_image_asset` (existing type/size validation); non-image drops ignored without rendering errors
- [x] 9.3 Full-resolution embedding: when attaching a registry pick, fetch via `get_image_asset` (full rendition) instead of embedding the 256 px list thumbnail (`src-tauri/src/commands/image_registry.rs:353-389`, `CreateExtractDialog.tsx:309-323`)
- [x] 9.4 Tests: paste with textarea focus ingests the image (synthetic clipboard event) and text paste unaffected; drop ingest happy path + non-image rejection; embed uses the full-res asset id; reopen renders the image (data-url persistence through `html_content`)

## 10. Deck-manager visibility (Bug 10 — `deck-manager-visibility`, hardening; literal report CANNOT VERIFY)

- [x] 10.1 Materialize decks on save: whenever a card is saved with a deck reference — studio `seed.deckTag`/`handleSaveSelected` (`src/components/review/FlashcardStudioModal.tsx:2880-2910,3091`), assistant `deck:` tags (`AssistantPanel.tsx:1805-1815`), vim `:deck` (`DocumentViewer.tsx:1985-2116`) — call the existing `ensureDecksExist` (`src/stores/studyDeckStore.ts:161-188`) in the same path so the StudyDeck exists immediately
- [x] 10.2 Regression tests: saving a card with a new deck tag creates the deck and it appears in Deck Manager's list; parity invariant — every deck offerable in the studio picker is listed by `DeckManager.tsx:66-70` after save; existing `studyDeckStore.test.ts` / `studyDecks.test.ts` stay green
- [x] 10.3 Record the disposition in the change notes: `"Default Deck"` never existed in this repo's history (pickaxe-verified); both surfaces read one store; no synthetic default deck is introduced (design D10)

## 11. Document category editing (Bug 11 — `document-category-editing`)

- [x] 11.1 Inline category editor in `src/components/common/ItemDetailsPopover.tsx:466-470` (pattern: neighboring `ItemTagEditor`): preset chips from the union of existing document categories + free-text input, persisting via the already-imported `updateDocument`; support clearing (empty ⇒ unset)
- [x] 11.2 Expose the same editor in the Library document details/context surface (`src/components/documents/DocumentsView.tsx`, reusing its existing `updateDocument` plumbing at ~1610/1810/2111) so the reporter's two expected surfaces (library + document) both edit
- [x] 11.3 Fix clearing semantics in `update_document` (`src-tauri/src/database/repository.rs:1242-1261`): an explicit clear must be distinguishable from "leave unchanged" (e.g. sentinel or explicit Optional handling) instead of the current empty-string filter before `COALESCE`
- [x] 11.4 Extend `get_category_stats` (`src-tauri/src/commands/analytics.rs:377-394`) to also group `documents.category`; surface in the Stats breakdown (`AnalyticsTab.tsx:302-304`)
- [x] 11.5 Tests: popover and Library edits persist/clear; Library filter values and queue chips reflect edits without reload; analytics includes document categories; Rust test for `update_document` set/clear/preserve semantics

## 12. Validation gates

- [x] 12.1 Frontend: `npm run lint`, typecheck, and full vitest suite pass, including every new test file from groups 1-11
- [x] 12.2 Rust: `cargo test` in `src-tauri/` passes, including new NotebookLM parsing, OCR pipeline, due-query/forecast, extract update, and analytics tests
- [x] 12.3 `npm run bench:check` passes or intentional deltas are recorded in `scripts/perf-baselines.json` with justification (universe layout and forecast queries may be benchmarked paths)
- [x] 12.4 `npm run build` and the Tauri build succeed; no security configuration changed (sandbox attrs, CSP `frame-src`, proxy validation — verified by the group 7 tests)
- [x] 12.5 Reread the triage matrix in `proposal.md` and confirm every UNRESOLVED/PARTIALLY FIXED row has shipped code + a regression test; confirm Bug 10's disposition note and evidence are in the change notes; no live third-party service is required by any CI test (manual tasks 2.6/7.4 are the only real-service checks)
