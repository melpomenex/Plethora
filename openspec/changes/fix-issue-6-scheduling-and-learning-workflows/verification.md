# Verification, risk controls, and handoff

## Proposal-phase evidence actually obtained

- Checked-out source: `7d87d811f6db8fcd98da148d22e7f10a46bd747d`; initial worktree clean.
- Complete live issue and all 12 screenshots inspected; zero issue comments at retrieval.
- Targeted pre-existing Vitest run: **9 files passed, 82 tests passed**, exit 0. There were existing jsdom media-not-implemented, native event-listener, and React act warnings. This is mocked component/unit evidence, not native or database roundtrip coverage.
- Scheduling comparison values in design.md were independently calculated with Python `math.expm1`, fixed explicit inputs, and the read old formula. No production algorithm was modified or executed as the proposed policy.
- OpenSpec change strict validation passes. It reports an **INFO archive-preflight blocker inherited from the main `priority-vector-improvements` spec**, which has a delta header outside a main Requirements section. Direct strict validation of that existing main spec fails. Task 1.2 fixes its wrapper during implementation; the proposal-only constraint forbids silently changing it now.
- Planning status: **4/4 artifacts complete**, 13 capability deltas, 46 requirements, 100 scenarios, and 57 unchecked tasks. Mechanical review verified declared capabilities, exact existing modified-requirement headings, scenario presence, unique task IDs, traceability references/local links, and the numerical comparison table.
- No application fix, test source, production schema, handbook, or other documentation was edited during proposal creation. No commit, branch, PR, or push was made. Lemmalog stores investigation facts per repository policy.

Actual targeted baseline command:

```bash
npm run test:run -- \
  src/__tests__/clozeUtils.test.ts \
  src/components/review/__tests__/ReviewCard.test.tsx \
  src/components/review/__tests__/FlashcardScrollItem.test.tsx \
  src/components/review/__tests__/InlineCardEditor.test.tsx \
  src/components/review/__tests__/ReviewSession.edit.test.tsx \
  src/pages/__tests__/QueueScrollPage.audio-editing.test.tsx \
  src/pages/__tests__/QueueScrollPage.rebuild.test.tsx \
  src/lib/ai/assistant/__tests__/learningAgentScope.test.ts \
  src/features/documentQa/__tests__/sectionContextRequest.integration.test.ts
```

Actual final planning validation:

```text
openspec validate fix-issue-6-scheduling-and-learning-workflows --strict --no-interactive
exit 0: Change is valid
INFO: archive preflight requires fixing the existing priority-vector-improvements main-spec structure

openspec status --change fix-issue-6-scheduling-and-learning-workflows
4/4 artifacts complete: proposal, specs, design, tasks
```

## R00. Deterministic reproduction fixture and evidence ledger

### Implementation evidence in progress

- The priority-vector main-spec wrapper now passes strict validation, as does this change's archive preflight.
- `cargo test --lib issue6_` passed six real SQLite fixture, MCP, and reproduction tests with production migrations and foreign keys enabled (`6 passed; 0 failed; 1 ignored; 1767 filtered out`): `issue6_fixture_recreates_with_foreign_keys_and_preserved_state`, `issue6_repro_s04_partial_identity_and_split_content_tag_writes`, `issue6_repro_s05_raw_extract_namespace_triggers_sqlite_fk_787_while_mcp_resolves`, `issue6_repro_s09_deleted_card_lookup_and_content_write_fail_not_found`, `mcp::tools::tests::issue6_extract_source_creates_card_with_real_parent_and_extract`, and `mcp::tools::tests::issue6_batch_cloze_persists_source_and_reports_partial_failure`.
- `npm run test:visual -- src/visual/issue6-fixture.visual.spec.ts` passed against the production IndexedDB adapter in a disposable namespace, including a real extract-linked card read-back and rejection of a mismatched source. Browser video extract persistence is not yet implemented.
- Retained baseline artifacts are checked in under this change directory (without checking the 15 MB `/tmp/plethora-issue6-evidence/01.png`..`12.png` binaries into git):
  - [SQLite fixture before-state](before-state.sqlite.json), regenerated via `ISSUE6_BASELINE_PATH=../openspec/changes/fix-issue-6-scheduling-and-learning-workflows/before-state.sqlite.json cargo test --lib issue6_test_support::tests::issue6_capture_baseline -- --ignored --exact`, retaining persisted `dateLastReviewed`, `nextReadingDate`, `prioritySlider`, `priorityRating`, `priorityScore`, `priorityExplicitlySet`, `stability`, `difficulty`, `reps`, source links, FSRS memory, and `sync_outbox` count (`10`).
  - [Browser fixture before-state](before-state.browser.json), captured against the unchanged browser database layer at starting checkout `7d87d811f6db8fcd98da148d22e7f10a46bd747d`, recording priority, due dates, source links, memory, counts, and unsupported browser fields.
  - [Evidence baseline manifest](evidence-baseline.json), recording `implementation_start_revision` (`7d87d811f6db8fcd98da148d22e7f10a46bd747d`), 26 overlapping unarchived OpenSpec changes across 314 scanned (including direct capability delta overlap `fix-section-mention-content`), SHA-256 digests/byte sizes/`3024x1964` dimensions/surfaces/classifications for all 12 screenshots `S01`–`S12`, and programmatic 27/27 C/R/H/D verification of [traceability.md](traceability.md).
- **Task 1.4 (`R08` keyboard priority reproduction, `src/components/documents/__tests__/issue6PriorityKeyboardRepro.test.tsx`, 4 passed)**:
  - **Working shortcut path (`C`, keep intact)**: Default `doc.priority` (`Alt+P` and macOS `Option+P` physical `KeyP` fallback in `eventMatchesCombo`), remapped `doc.priority` combos, and EPUB iframe `doc-priority-shortcut` forwarding all open `usePriorityPopup`, commit once via `Modal` `Enter` or `Apply` through `update_document_priority`, cancel cleanly on `Escape`, and persist explicit `0` across independent `get_document` read-backs under Tauri command semantics.
  - **Confirmed divergences to unify in Phase 6 (`C`)**: (1) `src/components/viewer/PriorityControl.tsx` writes per `onChange` with no draft/Apply/Escape, maps `slider = 0` to `rating = 1`, and logs rejections only to `console.error` while leaving stale optimistic UI displayed; (2) `src/components/documents/usePriorityPopup.tsx` resolves/closes `Modal` before awaiting `updateDocumentPriority`, discarding the draft on backend failure; (3) `src/lib/browser-backend.ts` `update_document_priority` omits `priority_explicitly_set`, causing explicit `slider = 0` / `rating = 0` to read back as `50` via `resolveDisplaySlider`; and (4) `src/components/viewer/DocumentViewer.tsx` same-origin HTML import iframe keydown forwards `Cmd/Ctrl+K`, `Escape`, and `j`/`k` without `doc.priority`.
- **Task 1.5 (`R03/R04/R06/R13/R14` workflow reproductions, `src-tauri/src/issue6_test_support.rs` + `src/test/issue6/reproductions.test.tsx`, 4 frontend + 3 new SQLite tests passed)** — failure signatures explicitly distinguish **identity**, **persistence**, **refresh**, and **provider** errors:
  - **S04 (card edit)**: Queue-prefixed display ID (`flashcard-<id>`) fails canonical lookup (`None`/`NotFound` → `"Failed to save card"` toast) with zero storage writes (**identity**); separate `updateLearningItemContentWithVersion` + `updateLearningItemTags` writes commit new content durably in SQLite before failing on tag update, while UI rolls back via `onSave(prevCard)` (**persistence**).
  - **S05 (`extract:<id>` card creation)**: `QueueScrollPage` sets `documentId: "extract:<id>"` and `normalizeAssistantToolParameters` copies it into `document_id`; writing that un-resolved string into `learning_items.document_id` triggers real SQLite extended error code `787` (`FOREIGN KEY constraint failed`, **identity**), whereas canonical `MCPToolRegistry::execute_tool("create_qa_card", ...)` and `createBrowserAssistantCard` resolve parent `document_id` + `extract_id` and reject missing/mismatched sources cleanly.
  - **S09 / S10 (delete resurrection & title leak)**: `QueueScrollPage` populates `documentTitle` from raw `question.substring(0, 50)`, leaking `{{c1::...}}` markers into `itemTitle`; `handleFlashcardDelete` deletes the DB row (S10 undoable toast) without updating `dueFlashcards` or a deleted-ID barrier, so `canPresentItem` stays `true` and `applySessionItems` / `reanchorSessionPosition` resurrects the deleted card (**refresh**), causing a second Delete/Postpone/Review to fail with `"Learning item not found"` (**identity**, S09).
  - **S12 (Learning Agent section vs selection scope)**: `buildAgentSection` (`AssistantPanel.tsx`) reads only `selectedSectionNodes[0].content` without canonical re-resolution, returning `{ ok: false, reason: "needs-section" }` with zero provider calls when an outline node has empty `.content` and no pinned selection (**identity**); when explicit `agentScope === "document"` is active alongside a pinned selection, `resolveLearningAgentScope` populates `run.selection` (`get_current_selection` → `ok`) while leaving `run.section = undefined` (`get_section_context` → `not-available`), explaining S12's `"no section context"` + `current_selection` output without blaming Apple Intelligence; genuine **provider** failures occur after bounded section capture and record the exact request in `provider.requests`.
- Focused frontend tests passed for card receipts, video ratings, cloze helpers, review components, and Assistant actions; focused ESLint and `npx tsc --noEmit -p tsconfig.json` passed. `src/visual/issue6-assistant-scroll.visual.spec.ts` passed three browser tests covering streaming, late image resize, removed anchors, session restoration, provider switching and reduced motion; existing assistant layout tests passed all seven configurations. These checks do not establish the review-event, reader-locator, native-platform or complete cross-mode contracts.

Build fixtures in tests, never the user's real database. Fixed instant `2026-10-29T12:00:00Z`, deterministic IDs, no live network/model. Seed one collection, Markdown/HTML/PDF/EPUB documents with duplicate headings and nested sections, an extract linked to a real parent, basic/cloze/occlusion cards, a video document and new/due video extracts, and a playlist/settings row. Fake providers return typed canned candidates or errors. Native persistence tests use a fresh SQLite database with foreign keys enabled and the production migration/repository paths; browser tests use the supported local storage adapter with a fresh namespace. UI tests may fake transport, but the same payload fixture must cross a real persistence boundary in companion integration tests.

Retain row dumps and expected source IDs, scheduler state, explicit priority flags/order keys, content revisions, review events, and outbox receipts. Give delayed/failed responses controllable deferred promises. Reproduction evidence records screenshot, surface, input, actual result, expected result, source classification, and whether it fails before the implementation. Repair the existing priority-vector main-spec wrapper, then verify its delta can be applied to a scratch copy; do not archive or mark tasks done in the live proposal merely for validation.

## Regression packages and exact targets

All targets marked **new** are planned files or new named blocks, not tests already run.

| ID | Target and meaningful checks |
|---|---|
| R01 | Rust tests in `src-tauri/src/algorithms/daqe/terms.rs`, `ranker.rs`, `algorithms/mod.rs`, `queue_selector.rs`, and queue producer tests: fixed-clock M/T/O matrix, finite defaults, strict P direction/slope, monotone lateness, τ horizon, no after-cap decline, max-risk/readiness behavior, missing FSRS/date, explicit zero, correct last-review elapsed time, huge lateness, input permutations, eligibility buckets and no scheduling writes. Deterministic grids/property-style generated valid inputs use fixed seeds. |
| R02 | `src-tauri/src/database/priority_rank.rs`, queue command/model tests; `src/utils/__tests__/reviewUx.test.ts` and **new** ranking-evidence parity fixture tests: canonical positional P across documents/extracts/cards, derived bucket only, legacy zero handling, inherited video/playlist scale, stable rank population under session filtering, equal keys/singleton/malformed fields, legacy preset weight collapse, adaptive-order preservation and diagnostic equality. |
| R03 | `src/__tests__/clozeUtils.test.ts`, ReviewCard/FlashcardScrollItem tests, **new** `src/components/review/__tests__/ReviewCardContent.parity.test.tsx`, and queue-page integration: shared C01–C12 persisted fixtures through all three modes, creation-to-queue reachability, complete DTO hydration, safe headers/accessibility/speech/auxiliary explanations, no marker/answer hidden DOM leak, reveal and relaunch. |
| R04 | InlineCardEditor/ReviewSession.edit/LearningCardsList tests; Rust repository/learning-item command tests; **new** atomic-edit integration cases: source/ranges/tags/version in one transaction, fault injection at each write boundary, lossless legacy projection, empty answer and absent-field handling, prompt-free pencil activation, failed draft retry, complex Studio handoff, scheduling/source/priority invariance, version restore, stale completion and offline restart read-back. |
| R05 | Existing occlusion tests plus ReviewCardContent parity; **new** `src/visual/issue6-review-cards.visual.spec.ts`: authored QA metadata, tall/wide/high-resolution/local/imported/multiple regions, real image dimensions and overlay rectangles, opaque defaults/authored colors, target/all reveal, letterbox avoidance, DPR1/2, scroll/resize/navigation while loading, missing/corrupt image, invalid coordinates and no plain duplicate image. |
| R06 | `src/pages/__tests__/QueueScrollPage.rebuild.test.tsx`, `.audio-editing.test.tsx`, review-store tests, and **new** shared session-mutation reducer tests: first/middle/last/only/current/noncurrent deletion, exact next identity, no review, remaining/removed/reviewed progress, static custom snapshot and old refresh resurrection, pending rating, repeated delete and item change while pending. Use actual command result shapes rather than a no-op delete alone. |
| R07 | `src/commands/__tests__/undoableCommands.test.ts` and session integration: success/failure/redo, deleted barriers, undo after session completion, original scheduling restored, late refresh during undo, no duplicated restored card and no position theft. |
| R08 | Existing priority popup/overlay/modal/keyboard tests and **new** `src/visual/issue6-priority-persistence.visual.spec.ts`: configured shortcut, EPUB bridge, keyboard numeric/range/presets/Enter, pointer/touch parity, explicit 0/25/50/75/100, one commit per intent, failure/retry/identity change, overlay focus/shortcut ownership, independent backend read and store recreation. Native recheck uses actual IPC/DB, not only browser mock state. |
| R09 | **New** `src/components/media/__tests__/YouTubePlaylistManager.persistence.test.tsx`; Rust playlist/repository tests and browser adapter tests: draft clearing/multi-digit/fractions/blanks/out-of-range/zero, no keystroke writes, one Save, Cancel, pending/failure/saved state, stale response/focus protection, restart. Existing Settings catalog/coverage/navigation suites verify IDs, labels, nested reveal and no indexing of user playlist names. |
| R10 | Rust playlist creation and queue interspersion tests plus **new** fixed frontend/API fixtures: defaults seed only new subscriptions; saved existing interval/priority governs cadence, global consecutive limit, disabled subscriptions and coincident slots; newly imported video rank seed happens once; later document priority/due dates are retained; no network is needed for settings tests. |
| R11 | Video model/repository/command tests and **new** `src/components/video/__tests__/VideoExtracts.lifecycle.test.tsx`: viewing success/failure, new/seen/not-reviewed/reviewed labels, independent due badge, first/last seen update, restart/old rows/nulls, new extract pool reachability, parent rating leaves extract history untouched and vice versa. |
| R12 | **New** video-rating transaction tests and `src/components/__tests__/VideoExtracts.rating.test.tsx`: one child click through parent equals one command/event/count/advance; new and due ordinary/session paths; busy double click/Enter; same-operation replay/conflict; lost response; parallel distinct operations serialize; transaction/journal failure rolls back, retry succeeds, and parent state is unchanged. |
| R13 | `src/features/assistant/__tests__/chatFlashcardArtifacts.test.ts`, ChatFlashcardCollection/AssistantPanel integration, learningAgentAcceptance tests, tool parser tests and Rust `mcp/tools.rs`/creation tests: real-FK extract context, wrong parent, deleted source, missing collection, canonical single/batch cloze, malformed candidates, accurate mixed results, retry only failures, lost-reply idempotency, safe error/Open states and actual saved IDs/outbox/tree/counts. |
| R14 | `src/utils/sectionIndex.test.ts`, `src/utils/__tests__/sectionIndex.test.ts`, `src/features/documentQa/__tests__/sectionContextRequest.integration.test.ts`, learningAgentScope and AssistantPanelLearningAgent integration plus **new** scoped-generation parity cases: actual selected body reaches the complete generation boundary for Chat/Agent/Q&A/Studio and mocked Ollama/on-device/Apple/remote adapters. Duplicate titles/path, parent/child overlap, Markdown/PDF/EPUB, stale/empty/missing extraction, pinned selection, no selection, multiple/very long sections, provider budget/timeout/unavailability and zero remote fallback. Assert unrelated body substrings are absent, not only section labels present. |
| R15 | **New** `src/components/assistant/__tests__/AssistantPanel.scroll.test.tsx` and `src/visual/issue6-assistant-scroll.visual.spec.ts`; existing reader Assistant resize tests: follow threshold 48px, user scrolled up during streaming, Latest action, close/reopen, late media/hydration, separate conversations, provider/tab/context changes, reduced motion, reader locator retained with no zero-progress write. Pixel positioning needs real browser evidence beyond jsdom. |
| R16 | **New** `src/visual/issue6-learning-workflows.spec.ts` plus SQLite/native integration fixture: cross-mode creation/render/reveal/edit/delete/undo/rating/priority/playlist/AI scope workflow with authoritative reads after every mutation and a relaunch. Replay migration/backup/restore/sync/offline cases and preserve all preexisting histories/order keys; no live external service. |

### Shared cloze fixture inventory

| Fixture | Input/condition | Required result |
|---|---|---|
| C01 | `The {{c1::sun}} rises.` | Blank before reveal, sun afterward |
| C02 | `{{c1::mitochondria::cell organelle}}` | Hint before reveal; actual answer afterward |
| C03 | `{{answer}}` and `{{::answer}}` | Simplified formats normalize without raw markers |
| C04 | `[[c2::answer]]` | Legacy format parity |
| C05 | Explicit c1 plus simplified marker | No normalization index collision; both hidden |
| C06 | Repeated c1, distinct c2, multiline content | All deletions hide/reveal on one persisted card |
| C07 | Markers plus plausible but stale in-bounds ranges | Markers win; no answer leakage |
| C08 | Missing/empty/out-of-bounds/overlap/noninteger ranges | Marker fallback or explicit repair state |
| C09 | Marker-free valid ranges, emoji/non-ASCII | Correct offset conversion and lossless edit projection |
| C10 | HTML/Markdown/LaTeX around/across deletion content | Formatting/sanitization intact, no split invalid markup |
| C11 | Question-only cloze returned by batch creation | Reachable and equivalent in every mode |
| C12 | Malformed markers or literal `[...]` without recoverable answer | Repair/skip; no fabricated answer or grading |

## Implementation command gates

The following commands are supported by the inspected package/configuration and are **future implementation gates** unless explicitly listed as run above:

```bash
# Existing suites plus all new test files in the packages above
npm run test:run -- src/components/review/__tests__ src/components/learning/__tests__ src/pages/__tests__
npm run test:run -- src/components/assistant/__tests__ src/lib/ai/assistant/__tests__ src/features/assistant/__tests__
npm run test:run -- src/features/documentQa/__tests__ src/components/settings/search/__tests__ src/utils/__tests__/reviewUx.test.ts
npm run test:run -- src/components/media/__tests__ src/components/video/__tests__
npm run test:run
npm run test:scripts
npm run lint
npm run build

# Run from src-tauri; production migrations and real FKs enabled in fixtures
cargo test --lib algorithms::
cargo test --lib database::priority_rank
cargo test --lib database::repository::tests
cargo test --lib commands::learning_item
cargo test --lib mcp::tools
cargo test --lib

# Repo root; new visual files must be implemented before these selectors exist
npm run test:visual -- src/visual/issue6-review-cards.visual.spec.ts
npm run test:visual -- src/visual/issue6-priority-persistence.visual.spec.ts
npm run test:visual -- src/visual/issue6-assistant-scroll.visual.spec.ts
npm run test:visual -- src/visual/issue6-learning-workflows.spec.ts
npm run bench:check

openspec validate priority-vector-improvements --type spec --strict
openspec validate fix-issue-6-scheduling-and-learning-workflows --strict --no-interactive
openspec status --change fix-issue-6-scheduling-and-learning-workflows
```

`cargo test` selectors can match zero tests if module organization changes: record discovered test names/counts and require nonzero targeted coverage. Full `cargo test --lib` is the backstop. Rust/Tauri system dependencies or cross-target limitations must be recorded rather than silently substituting frontend mocks. Existing relevant names/configuration were inspected; Rust/native/Playwright/full-build/benchmark gates were not run for this documentation-only proposal.

Benchmarks use `src/test/bench-support.ts` seededRandom, fixed input sizes, void-return bodies and consumed sink values; no network/filesystem/native IPC in benchmark bodies. Add meaningful queue-feature assembly, cloze content normalization, missing-card hydration planning, and section-envelope construction suites only where the changed cost warrants them. Native queue scaling can use a deterministic Rust test/harness alongside the mandatory frontend gate. Compare 1k/10k pools for accidental N+1 DB calls/quadratic loops. Run `npm run build` before bundle budget checks. `bench:check` includes normalized anchor comparisons and bundle budgets; plain bench is measurement only. An intentional regression requires the corresponding baseline and written explanation, not a tolerance increase to conceal an unrelated failure.

## Practical platform matrix

| Platform | Automated shared evidence | Required real-runtime acceptance |
|---|---|---|
| Linux desktop | Vitest, real SQLite/Rust where dependencies permit; Chromium Playwright | WebKitGTK image assets/masks, prompt-free editor, Alt+P/Enter/focus, reader/Assistant anchoring, offline restart |
| macOS | Shared tests; mocked Apple adapter request parity | WKWebView card/editor/Option-key behavior, S05/S12 reproduction, native Apple Intelligence availability/budget, no cloud fallback |
| Windows | Shared/Rust tests on native toolchain | WebView2 asset URLs, keyboard/modals, persistence/relaunch, offline queue; platform AI only when available |
| Android | Shared small-screen/touch tests; existing build/test infrastructure | Actual WebView gestures, soft keyboard numeric forms, system Back/focus, local asset scaling, extract ratings/persistence and supported on-device provider |
| iOS | Shared mobile fixtures; existing `test:ios:*` scripts where Xcode available | WKWebView safe areas, keyboard/touch/Back, local images, restart and platform-gated Apple/on-device behavior |
| Browser/PWA | Local-adapter tests and Playwright with service/network mocked | Local offline settings/cards/ratings if supported; clearly unavailable native-only playlist import/provider features, no false functional controls |

Visual matrix: desktop 1440×1000; phone 390×844; narrow phone 320×740; landscape 844×390; light/dark, long localized labels and enlarged text. At least desktop/phone use DPR1 and DPR2. Verify masks with synthetic opaque contrasting assets and known region coordinates, hit testing/focus for controls, and actual persisted state for mutations. Screenshots alone cannot prove a save or a review event count.

No real native/mobile/provider matrix result is claimed in this proposal. During implementation, block release/closure for required unsupported or failing platform checks until evidence or an explicit scoped delivery decision exists; do not mark them passed because common logic tests pass.

## Risks, migration rehearsal, and rollback evidence

| Risk | Rehearsal / rollback rule |
|---|---|
| Existing user priorities | Snapshot all keys/direction/explicit flags; upgrade leaves keys unchanged. New P is derived, not migrated. Roll back rank calculation independently. |
| Due dates, FSRS memory, review history | Rank/edit/priority snapshots prove invariance; only explicit rating writes change the intended history. Do not bulk reschedule on upgrade/rollback. |
| Legacy cloze contents/ranges | Roundtrip all fixtures including Unicode/HTML and older version snapshots. Preserve raw data; repair state for irrecoverable blanks rather than data guessing. |
| Card edit/sync atomicity | Inject version/content/tag/journal failures and inspect transaction rollback plus outbox. Offline writes commit locally; sync retry does not duplicate/revert. |
| Deletion and undo | Stable IDs/barriers, pending refreshes and failed undo covered; restore full history with canonical backend mechanism. |
| New video state/events | Additive nullable migration, no fabricated historical records. Restore fixtures preserve aggregates/events and operation replay; older payloads default absent fields safely. Retain additive tables on binary rollback. |
| AI FK/provenance/partial success | Real FKs and canonical source resolver; no disabling constraints/unlinked fallback. Lost-reply receipt replay returns original IDs. |
| UI/performance/native differences | Seeded perf/bundle gate, browser pixels and real WebView/device acceptance; report unavailable coverage explicitly. |

## Implementation handoff

Expected source areas: Rust algorithms/DAQE/queue selector and models, `commands/queue.rs`, document/extract/learning-item/video/playlist commands, repository/priority-rank/migrations, MCP tools, sync/backup serialization; frontend learning/queue APIs, ReviewStore/QueueScrollPage, ReviewCard/FlashcardScrollItem/InlineCardEditor/LearningCardsList, priority popup/control/overlay, playlist manager, video extracts, AssistantPanel/tool normalization/acceptance, section resolver/Q&A/Studio/provider boundaries and conversation UI state. Extend `src/lib/browser-backend.ts` or the established local adapters where supported; do not route local-only actions to a new service.

Dependency order: phase 1 evidence/spec wrapper → phase 2 ranking evidence; phase 3 full-card hydration/presentation → phases 4–5 editing/session lifecycle. Phase 6 reuses priority evidence/coordinator. Phase 7 applies rank/default contracts; phase 8 uses mutation/session semantics and additive persistence. Phase 9 reuses canonical creation/hydration, shared source resolver and receipts. Phase 10 integrates all outputs. Tasks sharing model/API/sync boundaries should land coherently on main per AGENTS.md, with no unrelated unarchived-change edits. No commit/push is authorized by this proposal request.

Major decisions are fixed in design D1–D13: preserve high-is-important order keys; normalize live rank once; M=.8T+.2P with exponential τ14 readiness; preserve scheduling histories; full canonical card plus shared content renderer; lossless cloze editing; shared occlusion geometry; coordinator commits/session owner advances; atomic edit/version/tags; explicit playlist Save/default seeding; seen distinct from reviewed with retry-safe ratings; typed source IDs/validated candidate receipts; shared section-body resolver/provider budget; conversation-keyed scroll anchors.

Remaining evidence gaps are narrow: the reporter's exact build/database, which FK failed in that database, current native keyboard failure, precise reopen/top-jump container, and native provider/device execution. None changes the selected implementation contract. Reproduction tasks must record when an old report no longer reproduces and retain acceptance tests for the required behavior.

**Definition of done for implementation:** all traceability rows have passing workflow/persistence evidence; no original mathematical counterexample remains; no answer leakage or metadata loss across modes; no duplicate review/create; no lost content/history/manual rank; bounded and correctly scoped model requests; offline supported flows work; settings-search and benchmark gates pass or explicit unresolved failures block closure; native matrix is honestly accounted for; strict change and affected main specs/archive preflight are clean. Only then complete implementation checkboxes and consider archive. Proposal planning completion is not implementation completion.

## Adversarial proposal review

Reviewed coverage of all 21 issue concerns plus double rating, priority direction/zero, source FK, auxiliary leak and atomic versioning. Checked formula limits/independence and old/new values, identified mode-specific bypasses, retained working earlier direct-content/undo/section infrastructure, and made explicit decisions for all 15 requested topics. No arbitrary delays/reloads, fake grades for deletion, silent cloud fallback, title-only context, new generator, priority inversion, or destructive scheduling migration is proposed.

The discovered base-spec structural defect is retained as a visible implementation prerequisite, not hidden by a successful change-validation exit code. Test packages are specific enough to fail the confirmed bad paths; native/reporter hypotheses remain labeled and require reproduction. The scope is cross-cutting because Issue #6 is cross-cutting, but shared primitives are narrow and current surface shells/schedulers remain in place.

## Implementation update — local video lifecycle (2026-10-30)

User scope clarification: cloud sync is not part of this delivery. The proposed protocol/server expansion was removed, and existing optional sync code is unchanged. Local metadata, reviews, full database backups, and collection archives are the supported paths. No cloud propagation is claimed. The user's future merge preference (latest committed schedule, retain receipts, no grade replay) is recorded in D10a only.

Tasks 8.1–8.5 are complete for this local scope:

- Migration `133_video_extract_lifecycle` adds nullable seen fields and an immutable operation receipt table without rewriting historical review aggregates. Receipts survive extract deletion. The native command returns the canonical record plus receipt; repeated operation/payload returns the original receipt and conflicts fail.
- The browser adapter uses IndexedDB version 6 and one transaction for event/counter/schedule writes. It no longer needs the prior HTTP service for extract CRUD/seen/ratings. Playback confirms seen only on a playing sample inside the selected segment; failure/navigation cancels the intent. The shared review controller retains operation IDs across uncertain responses, blocks duplicate activation, and advances once.
- Ordinary lists expose independent ratings, New/Seen/Not reviewed/Reviewed and separate Due state; dedicated sessions include never-rated extracts under existing new/review limits. Event reconciliation prevents old list responses from overwriting a committed review. Content edits cannot overwrite a concurrent grade.
- Full database backups preserve IDs, seen state, schedules, counters, and receipts. Collection archives use a version-2 marker when they contain lifecycle data so older importers reject the file instead of silently dropping history. Version-1 payloads remain importable with absent-field defaults. Full restore preserves IDs; merge-as-new-collection follows the existing ID-remapping contract for copied records. Browser preflight rejects invalid lineage before clearing existing data. A namespace JSZip import in Anki export blocked real browser collection export and was corrected to a default import.

Actual checks:

| Check | Result | Retained log |
|---|---|---|
| `cargo test --lib video_ --no-fail-fast` | 15 passed, 0 failed, 1779 filtered; includes 5 new real-SQLite lifecycle/rollback/independence/backup/archive tests | `/tmp/issue6-video-local-verified-rust.log` |
| `npm run test:visual -- src/visual/issue6-video-lifecycle.visual.spec.ts` | 2 passed against the real command adapter and IndexedDB, including archive export/restore/reopen | `/tmp/issue6-video-archive-browser-final.log` |
| Focused lifecycle, list, playback and viewer Vitest suites | 22 passed in 4 files | `/tmp/issue6-video-ui-final.log` |
| Existing card/editor/cloze/priority regression suites | 61 passed in 6 files | `/tmp/issue6-video-regressions.log` |
| Arena archive provenance plus lifecycle/controller/playback suites | 12 passed in 3 files (overlaps the runs above) | `/tmp/issue6-video-archive-vitest.log` |

The initial native backup test incorrectly used an in-memory source: in this driver configuration, `VACUUM INTO` did not create an output file, with either a bound filename or a literal. A small SQLx probe confirmed that the file-backed source does create the file and retain rows. The rehearsal now uses `issue6_repository_at` with a file-backed fixture and the production BackupManager SQL pattern, asserting the snapshot exists before reopening. The failed rehearsal is retained in `/tmp/issue6-video-rust-final.log`; it is not reported as passed.

A pre-archive production frontend build passed. The final full build, benchmark gate, broad suites, and real native platform acceptance remain phase-10 requirements. Ripwire's scoped quality report still flags SQL/command/list duplication, and its static test gate reports unmodelled/untested reach; neither is reported as a green overall gate. Browser/SQLite evidence does not establish phone, WebKitGTK, WebView2, WKWebView, or native-provider acceptance.
