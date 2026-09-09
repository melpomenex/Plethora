## 1. Schema, model, and persistence foundation

- [x] 1.1 Append migration `116_add_learning_item_source_reference` to `MIGRATIONS` in `src-tauri/src/database/migrations.rs`: `ALTER TABLE learning_items ADD COLUMN source_reference TEXT;` (nullable, no backfill). Add an upgrade test seeding a pre-116 database via `pool_migrated_up_to` and asserting the column exists after `run_migrations`.
- [x] 1.2 Add `source_reference: Option<String>` to `LearningItem` (src-tauri/src/models/learning_item.rs) with `#[serde(default)]` tolerance; read it tolerantly in `row_to_learning_item` (src-tauri/src/database/repository.rs:279-347) via `try_get(...).ok()`.
- [x] 1.3 Add the column to the explicit INSERT column lists in `create_learning_item` and `create_learning_items_batch` (repository.rs:2894-3130) and to the update path used for content edits; extend `CreateLearningItemInput` + `create_learning_item` / batch Tauri commands with an optional `source_reference` input (src-tauri/src/commands/learning_item.rs:231-364).
- [x] 1.4 Define the `CardSourceReference` TS envelope type (`version`, `document_id`, `locator: ExactSearchHitLocation`, `excerpt` ≤300 chars, `section_label?`, `fingerprint?`, `captured_at?`) plus a parse/validate helper (rejects wrong `version`, unknown `kind`, missing `document_id`) in src/types/; add the mirrored optional field to the `LearningItem` TS type (src/types/document.ts:337) and the `src/api/review.ts` review-item type.
- [x] 1.5 Browser/PWA parity: pass `source_reference` through the IndexedDB learning-item paths in `src/lib/browser-backend.ts` and the create wrappers in `src/api/learning-items.ts:159-193`.

## 2. Sync and export/import plumbing

- [x] 2.1 Add `source_reference` to the `"content"` field-group UPDATE in `apply_learning_item_groups` and to the `upsert_learning_item` INSERT (src-tauri/src/sync/full_state.rs:431+, :795-943); confirm `LEARNING_ITEM_GROUPS` needs no new group name.
- [x] 2.2 Capture writes are creation-time, so the existing whole-row Create payload already carries the field; provenance is never written post-creation in v1. Verified by `learning_item_payload_round_trips_source_reference` (sync/merge.rs tests).
- [x] 2.3 Add `source_reference` to both collection-archive import INSERT column lists (`import_collection_archive` ~line 280 and `import_collection_archive_merge` ~line 643 in src-tauri/src/commands/collection_archive.rs); confirm export includes it automatically via serde and add a round-trip test (export → import → field preserved; old archive without the field still imports).
- [x] 2.4 Cross-version sync tolerance test: apply a v2 learning-item payload without `source_reference` to a new-schema local row and vice versa (follow existing merge tests in src-tauri/src/sync/merge.rs), asserting no error and LWW behavior unchanged.

## 3. Provenance capture at creation

- [x] 3.1 FlashcardStudio: in `handleSaveSelected` (src/components/review/FlashcardStudioModal.tsx:3526-3680), when a draft carries `sourceContext` (`SectionSourceReference`, stamped at :3491-3496), build the `CardSourceReference` envelope (locator from section ranges over document content, excerpt from draft source passage, `fingerprint` from `contentHash`) and include it in the batch create inputs. Drafts with `extractId` only keep extract linkage (no envelope).
- [x] 3.2 MCP/assistant tools: add an optional `source` argument (document_id + optional locator fields/quote/timestamp) to `create_qa_card`, `create_cloze_card`, and `batch_create_cards` (src-tauri/src/mcp/tools.rs:669-800, :1334-1425) that persists `source_reference`; have `AssistantPanel.executeToolCalls` pass the artifact's existing `source` field (src/features/assistant/chatFlashcardArtifacts.ts:25).
- [x] 3.3 Browser-capture AI cards: investigated (src-tauri/src/browser_sync_server.rs:2625-2665, :3377-3405) — **no local document id exists at card-creation time** (the page document is materialized by the import flow, not the card flow), and the envelope requires one. v1 keeps these cards' provenance as the existing `sourceUrl`/`browserCaptureContext` in `interaction_metadata`; revisit envelope capture if browser captures ever persist the document before card creation.
- [x] 3.4 Inline extraction (Ctrl+E): pass the live `selectionContext` (page number is derivable from the PDF context at resolution time, so only the context is passed) into `createExtract` in the inline-extraction path (src/components/viewer/DocumentViewer.tsx:2096-2131) so extract-backed cloze/cards anchor exactly, matching what the toast-extract path already sends (useToastExtract.ts:38-58).
- [x] 3.5 Verify all other pathways are untouched: manual/paste/imports/NotebookLM/automation create successfully with `source_reference = NULL` (regression assertions in existing creation tests).

## 4. Source resolution service

- [x] 4.1 Create `src/utils/cardSourceNavigation.ts` implementing the resolution ladder from design D2: (1) extract `selection_context` → `ExactSearchHitLocation` per variant (PDF page+quote, EPUB cfiRange, text offsets → scrollPercent, `AudioCaptureProvenance` → timeSeconds), (2) validated card `source_reference.locator`, (3) `ai_provenance` metadata, (4) bounded quote match via `src/utils/resolveCitationLocation.ts` semantics (unique ⇒ highlight; ambiguous ⇒ coarse only; none ⇒ coarse), (5) coarse `page_number`/document start, (6) unavailable. Return a confidence-tagged `CardSourceResolution` union; unit-test each rung with fixture selection contexts.
- [x] 4.2 Existing `get_ai_provenance` command + `getAiProvenance` TS wrapper (src/api/ai-provenance.ts) already provide the read side — no new command needed; the resolver consumes them.
- [x] 4.3 Replace the full-scan in `get_card_source_context` (src-tauri/src/commands/review.rs:142-146) with a direct indexed SELECT by item id (same return shape — no caller changes).
- [x] 4.4 Failure semantics unit tests: deleted document → `unavailable(excerpt)`; malformed/corrupt anchor → treated as absent with extract fallback; duplicate quote matches → no highlight; stale fingerprint + failed match → coarse + `notLocated` flag; offline equivalence (pure-local calls only).
- [x] 4.5 Sync serialization tests for the envelope itself (JSON round-trip through the learning-item payload; snapshot guards against accidental shape changes).

## 5. Review affordance UX

- [x] 5.1 Upgrade `CardSourceContext` (src/components/review/CardSourceContext.tsx) to render the strip as an activatable control: `BookOpen` + "From: *title* (p. N)" + optional `section_label` + trailing `ArrowSquareOut` icon; semantic `<button>` with `aria-label="View source: <title>"`, hover/focus-visible ring per existing ghost-button conventions, ≥44px touch target; the snippet disclosure chevron and `aria-expanded` behavior remain. Accept an `onActivate` prop instead of internal navigation.
- [x] 5.2 unavailable/resolve states: on activation show an inline resolving spinner in the strip; if resolution returns `unavailable`, render the source-unavailable panel (excerpt + message, text-only rendering) instead of navigating; add i18n keys `review.viewSource`, `review.source.unavailable`, `review.source.notLocated`, `review.source.returnToCard` across en/fr/ja/zh/de/es.
- [x] 5.3 Wire activation in `ReviewCard` (ReviewCard.tsx:750) to `openCardSource` via the new orchestrator; keep the strip hidden when `get_card_source_context` returns null (existing behavior covers source-less cards).
- [x] 5.4 Keyboard: register `review.viewSource` (`V`) in `DEFAULT_SHORTCUTS` (src/components/common/KeyboardShortcuts.tsx), handle it in ReviewSession for the current card (no-op when no source resolves), and show the kbd hint via ShortcutTooltip on desktop.
- [x] 5.5 DeckManager: add a "View source" entry to `CardContextMenu` (src/components/review/CardContextMenu.tsx) shown only when the card's source resolves, invoking the same orchestrator.
- [x] 5.6 Zen mode: feed the dead `ContextPeek` (src/components/review/ZenReviewMode.tsx:242-276) with context resolved from the current item (extract snippet / anchor excerpt) so hold-Alt shows real data, and support the `V` shortcut for the jump.

## 6. Navigation, tab reuse, and return path

- [x] 6.1 Extend `openDocumentAtLocation` (src/utils/openDocumentAtLocation.ts) with reuse-and-retarget: when a `document-viewer` tab for the same `documentId` exists, `updateTab` its data (`{...data, initialJump, highlightQuery, jumpRequestId: fresh, reviewReturn}`) and activate it; otherwise add a new tab (existing behavior for all current callers preserved).
- [x] 6.2 Eviction guard: **not needed** — existing policy already guarantees it. `EVICTABLE_TAB_TYPES` is only dashboard/analytics/continue-reading and the reader cap only governs `document-viewer`, so the review tab can never be cap-evicted and never unmounts during the round trip. Pinned by regression test `review tabs are never evicted by the resident or reader caps`.
- [x] 6.3 "Back to flashcard" return affordance in DocumentViewer's header when tab data carries `reviewReturn: true`: ghost header button (mobile ≥44px) that activates the review tab and restores focus to the card container (reviewFocus convention); announce nothing extra (state is visually restored). Mobile edge-swipe back already returns via tab activation — verify no review-session reset occurs on that path.
- [x] 6.4 Integration test the round trip at the store level: start session → reveal answer → openCardSource → activate review tab → same `currentCard`, `isAnswerShown=true`, `currentIndex`, progress counters unchanged, origin tab never evicted (simulated cap pressure).

## 7. Source-type and failure matrix

- [ ] 7.1 Per-type integration tests through the resolver + viewer props (partially covered: locator mapping for PDF/EPUB/text/audio and the envelope path are unit-tested in cardSourceNavigation.test.ts; full viewer-level jump verification per type is covered by the manual matrix in 9.2): PDF (page+quote via canonical anchor), EPUB (cfiRange), HTML article (offsets → scrollPercent + textQuote), markdown, YouTube/audio transcript (timeSeconds + segmentId), extract-backed card with only `page_number`, card with only `source_reference`.
- [x] 7.2 Failure-state tests: deleted source (unavailable panel, no navigation), modified source (coarse + notice, no false highlight), duplicate excerpt occurrences, legacy card with extract but no selection_context, legacy card with nothing, corrupt `source_reference` JSON.
- [x] 7.3 Cross-device coverage at the sync layer: `remote_create_payload_persists_source_reference` + `legacy_content_update_preserves_local_source_reference` (sync/merge.rs) prove anchor persistence and cross-version tolerance through `apply_remote_record`; deletion propagation rides the existing tombstone flow and the unavailable state is covered at resolver level.

## 8. Accessibility, presentation, and polish

- [ ] 8.1 A11y pass: keyboard-only walkthrough (Tab to strip → Enter; `V`; return focus lands on card region), screen-reader labels + live-region announcement for degraded outcomes (reuse Toast/aria-live conventions), no hover-only affordances, contrast of the strip and unavailable panel in light/dark.
- [ ] 8.2 Presentation modes: verify reduced-motion and e-ink (`data-reduced-motion`, `data-display-mode="eink"`) show instant scroll + static highlight on a real jump for PDF/EPUB/HTML; verify mobile touch targets and swipe-back return.
- [x] 8.3 Confirm excerpts render inert everywhere (strip, unavailable panel, mark insertion path uses text-node walking, not HTML parsing) — add a test injecting markup into `excerpt`.

## 9. Gates and validation

- [x] 9.1 Touched Rust modules: 12/12 pass (migration upgrade, sync merge incl. cross-version tolerance, archive payload). Frontend: 25/25 feature tests pass; full vitest run green except 5 failures verified pre-existing on the clean tree (scheduler terminology gate, browser Precision collection ×3, help integration). `tsc --noEmit` clean. `npm run bench:check` reports 12–13 failures on benchmarks unrelated to this change (TTS cache key, document fingerprint, kp-timeline, tabs-dom, ambient canvas) — reproduced identically on the stashed clean tree, i.e. a pre-existing machine/baseline mismatch, not a regression from this change; per AGENTS.md baselines are only updated for intentional perf changes, and none were made.
- [ ] 9.2 Manual smoke on desktop + mobile shells: extract-backed card, Studio section card, source-less card (no affordance), deleted source, offline jump, return round trip preserving a mid-session state.
- [x] 9.3 `openspec validate --strict` passes; update this tasks checklist as items complete.

## 10. Follow-ups (explicitly out of v1; do not block)

- [ ] 10.1 Source preview popover ("Source: Chapter 4 · Memory Systems" → sheet with excerpt → Open in reader).
- [ ] 10.2 Manual attach/edit source on existing cards; provenance inspector.
- [ ] 10.3 Multi-anchor cards (envelope → list) and secondary references.
- [ ] 10.4 Timed pulse highlight (XThread precedent) replacing persistent search-style marks.
- [ ] 10.5 Extend affordance to search results, scroll-mode inline flashcards, card editor, and the DeckManager preview panel.
- [ ] 10.6 Backfill `selection_context` on high-value legacy extracts (queue-scroll, extension) as a separate change.
