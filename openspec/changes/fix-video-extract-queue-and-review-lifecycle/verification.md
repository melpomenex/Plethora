# Verification, acceptance, and handoff

## Proposal-phase evidence

- Source inspected: current `main` working tree at the time of investigation; no production file was modified.
- Evidence classifications are recorded in `traceability.md`. No native Windows/macOS/Android/iOS runtime, no physical-device playback, and no cloud account were available.
- The prior issue #6 change is marked complete in `openspec list`, but its video spec covers seen/reviewed/receipt behavior only; it does not cover creation defaults, queue membership, queue visibility, Scroll Mode dispatch, or library discoverability.
- `openspec validate fix-video-extract-queue-and-review-lifecycle --strict --no-interactive` result is recorded at the bottom of this file after artifact creation.
- No application fix, schema, test, translation, or documentation outside this change directory is part of this proposal.

## Acceptance packages

### V01. Creation and validation

**Native (real SQLite, production migrations/FKs):**

- Add to Queue true, no date → queued, NULL `next_review_date`, immediately returned by the candidate query at `now`.
- Add to Queue false → not queued, NULL date, absent from candidates, present in `get_all_video_extracts`.
- Add to Queue true, today → queued, NULL date (eligible now).
- Add to Queue true, tomorrow → queued, date preserved, absent at today's cutoff, present at tomorrow's cutoff.
- Add to Queue false + date → typed error; past date → typed error.
- Missing parent, non-video parent, empty/whitespace title, negative start, end ≤ start, duration > 600 → error and zero rows.
- Duplicate title with different range → two rows; both listed.
- Persistence failure injection → no row, no receipt, no phantom cache entry.
- Uncertain response after a possible commit → no automatic second create; a refresh shows at most one row for the attempt.

**Browser (IndexedDB, disposable namespace):** the same matrix, including the old `addToQueue === false` inversion and title/parent validation.

### V02. Queue membership, visibility, and ordering

- `get_queue_items_from_repo` and `get_due_queue_items_from_repo_at` include a queued/NULL unreviewed extract exactly once.
- Not-queued, future, archived-parent, dismissed-parent, and reviewed-NULL rows are absent.
- Default collection includes legacy/default rows; a non-default collection includes only its own rows.
- `get_queue_items(count=1)` may omit an eligible row; `get_video_extract_queue_candidates(cutoff)` still contains it. Increasing the count includes it.
- Sibling extracts from the same source survive rating/removal of one extract.
- Priority/due/ID ordering is deterministic across identical reloads; unrelated document/extract order is unchanged.
- Schedule/forecast counts include queued due video rows once and exclude not-queued/future/archived rows.
- Auto-postpone discovers queued overdue video rows but still reports them as unsupported rather than executing.
- A saved/custom queue holding a video-extract ID drops it after removal from the queue and restores the same stable ID after re-add; no duplicate row appears.
- Browser `get_queue` and `get_due_queue_items` return the same eligible set and DTO fields as native for the shared fixture.

### V03. Discovery, cache, and UI reconciliation

- Create while the source video is open → card appears immediately in the source panel; no reopen.
- Create → card appears in the library-wide Extracts tab and the per-document Extracts view.
- Create with queue eligibility → queue representation refreshes without restart.
- Status line: New / Seen · Not reviewed / Reviewed and Not in queue / Queued · due / Queued · scheduled are correct.
- Add to queue / Remove from queue from the card round-trips and updates the queue.
- "Review now" on a future-scheduled card makes it eligible immediately without changing memory/counts.
- Play opens the source tab focused on the extract segment.
- Delete removes the row from the source panel, library, per-document view, and queue; receipts remain.
- Deferred pre-mutation list/queue responses cannot restore the old list or remove the new card.
- Empty, loading, error/retry, and archived-source states render without a blank panel.
- App restart loads the persisted rows exactly once.

### V04. Review correctness through the real queue path

Fixture: one parent video document with known `stability`, `difficulty`, `next_reading_date`, `date_last_reviewed`, `reps`, `priority`, `total_time_spent`; one extract with independent memory/count/date; one sibling extract.

Test through `QueueScrollPage` (the actual Scroll Mode rating control and keyboard path), not only `VideoExtractCard`. The Reading Queue list is a browse/open surface today; Scroll Mode is where queue rating is dispatched. If the implementation adds a row-level rating control to the Reading Queue, it must call the same dispatch branch and add the same assertions.

- Press/click Good → exactly one `rate_video_extract` call, one receipt, extract `review_count +1`, `reps +1`, `last_review_date` updated, `next_review_date` updated, memory updated, queue advances once.
- Parent document snapshot before/after is semantically unchanged for every scheduling/history/priority field; no `rateDocumentEngaging` call and no parent activity row created by the rating call. If the test actually plays media, the DocumentViewer's separate reading-session tracker may accrue source-video reading time; snapshot around the rating and do not attribute that pre-existing behavior to the rating.
- `ratedVideoExtractIds` prevents the extract from reappearing on rebuild; sibling extract and parent remain present.
- Double-click, key repeat, and pending-state activation → one event, one advance.
- Failed rating → current item remains, no advance, no parent mutation, retry reuses the same operation ID.
- Different rating while an intent is pending is rejected until retry/cancel.
- Postpone → only extract date changes; Details delete → only extract row; Dismiss/remove → membership only; none of these mutate the parent.
- Keyboard `1`–`4` and the mobile `onRate` callback reach the same branch.

### V05. Playback and Seen

- Local extract: open from Queue → source opens at start, active end bound is enforced, playback starts or is ready; Seen written once after confirmed playing media.
- YouTube extract: same, with the existing player and embed host.
- Autoplay blocked → still seeked/ready; Seen remains absent until the user plays.
- Missing local file / YouTube player error / source mismatch → unseen, no review, recoverable error, source navigation available.
- The segment banner shows the extract title and time range; "View full video" clears segment focus without changing queue/history state.
- Selection alone, opening the source panel, or fetching the transcript never marks Seen.
- Reopening after a successful segment shows Seen · Not reviewed and retains the parent video.

### V06. Native/browser parity

Use the same conceptual fixture in Rust SQLite and browser IndexedDB:

- creation defaults and date boundaries;
- queue status/eligibility/collection;
- New/Seen/Reviewed labels;
- queue DTO identity/title/time fields;
- rating increments and parent invariance;
- seen persistence;
- remove/re-add history preservation;
- restart persistence;
- v8→v9 IndexedDB upgrade and old-archive normalization.

Assert the semantic values and dates, not byte-identical JSON where the adapters legitimately differ (e.g. generated IDs/timestamps).

### V07. Migration, backup, restore, rollback

- Apply the new migration to a database with dated-unreviewed, dated-reviewed, NULL-unreviewed, NULL-reviewed, future, archived-parent, and receipt rows. Assert all values unchanged except the new status/collection fields and known dates retained.
- Assert dated rows become queued, NULL rows not queued, collection from parent/default, CHECK rejects a third status, and no row is deleted.
- Full-database backup → restore → reopen: status, collection, seen, memory, counts, dates, receipts equal.
- Collection archive v1 (no status/collection/format version) → restore infers membership/collection.
- Collection archive v2 → exact round trip.
- Invalid archive lineage → aborts before clearing live data.
- Older binary rollback rehearsal: additive columns remain; document the NULL-date old-client limitation; no destructive down migration.

### V08. End-to-end regression (deterministic fixture)

1. Create the source video document with a known scheduling snapshot.
2. Create a titled extract with a valid range and Add to Queue enabled.
3. Commit and assert a durable row with queued status and canonical fields.
4. Assert it appears immediately in the source video's Extracts view.
5. Assert the Documents root grid gains no duplicate document row.
6. Assert it is eligible in the Queue exactly once.
7. Open it from the Queue; assert the correct source and segment start.
8. Confirm bounded playback; assert Seen and an unchanged review count.
9. Rate Good; assert one receipt, independent FSRS update, and parent invariance.
10. Assert it leaves the current due set and the session advances once.
11. Assert sibling extracts and the parent video remain available.
12. Restart the app/store; assert title, range, status, seen timestamps, counts, memory, and next date.
13. Advance the test clock to the next due date; assert eligibility again.
14. Rate again; assert exactly one additional event and counter increment.
15. Remove from queue; assert not queued and absent from all queue modes.
16. Assert content/history remains in the library and source panel.
17. Re-add; assert queued, history unchanged, and the retained date reused.
18. Delete; assert the extract is absent, receipts remain, and the parent video still exists.
19. Repeat the create/queue/rate/seen assertions in the browser adapter with the same fixture values.
20. Confirm no live LLM, network, YouTube fetch, or remote service is required for the scheduling/persistence portions.

### V09. Repository gates

Run and retain logs for:

```bash
# Frontend focused
npm run test:run -- \
  src/components/video \
  src/components/__tests__/VideoExtracts.rating.test.tsx \
  src/pages/__tests__/QueueScrollPage.video-extract.test.tsx \
  src/hooks/useVideoExtractPlayback.test.tsx \
  src/components/tabs \
  src/lib/__tests__/browserBackendVideoExtracts.test.ts \
  src/lib/i18n

# Rust focused
cd src-tauri
cargo test --lib video_
cargo test --lib queue
cargo test --lib issue6_

# Type/lint/build
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build

# Full relevant regression
npm run test:run
npm run test:scripts
cargo test --lib

# Browser persistence / visual (disposable namespace only)
npm run test:visual -- src/visual/issue6-video-lifecycle.visual.spec.ts

# Performance gate only if the shared queue payload benchmark is affected
npm run bench:check
```

A passing mocked component test does not substitute for the native repository test, the real IndexedDB test, or the Queue-path test. Record unrelated pre-existing failures separately; do not call a red gate passed.

## Platform matrix and limitations

| Platform | Planned verification | Proposal-phase limitation |
|---|---|---|
| Linux Tauri | Full Rust repository/command tests, focused Queue UI, local-video playback, restart, migration | No GUI session was used for this proposal; implementation must run it |
| Windows Tauri/WebView2 | Same Rust tests; keyboard/mouse playback and local file resolution | Not available in this environment; mark pending |
| macOS Tauri/WKWebView | Same Rust tests; YouTube embed host and local media permissions | Not available; mark pending |
| Android/iOS Tauri | Same Rust/SQLite semantics; touch rating controls and native media permissions | No device/simulator run; mark pending |
| Browser/PWA (Chromium) | IndexedDB v9 upgrade, queue/creation/rating/seen/archive, Playwright visual workflow | Planned; not run during proposal |
| Browser/PWA Safari/Firefox | IndexedDB behavior and media playback | Not verified; mark pending if no harness |
| Cloud sync | Out of scope; no protocol/server change | No claim of sync parity |

## OpenSpec validation

```text
openspec validate fix-video-extract-queue-and-review-lifecycle --strict --no-interactive
```

Result:

```text
Change 'fix-video-extract-queue-and-review-lifecycle' is valid
Progress: 4/4 artifacts complete (proposal, specs, design, tasks)
```

Planning inventory at proposal completion: 5 capability deltas (1 new, 4 modified), 16 requirements, 70 scenarios, 49 unchecked implementation tasks, plus `traceability.md` and this verification file. No production source file was modified; `git status` contains only the new change directory.

## Implementation update — video-extract queue/review lifecycle

- Native migration `136_video_extract_queue_membership` applies additively and preserves dates, counts, seen fields, memory, and receipts. Real-SQLite migration test passes.
- Native candidate policy, creation intent, membership, postpone, queue DTO fields, forecast/auto-postpone filters, and Scroll Mode identity/rating dispatch are implemented.
- Browser v8→v9 upgrade, creation/membership/postpone/candidate commands, queue inclusion, and archive `formatVersion` normalization are implemented; the Playwright v8 upgrade and browser queue tests pass.
- `npm run test:visual -- src/visual/issue6-video-lifecycle.visual.spec.ts`: **4 passed** (lifecycle/receipts, archive restore, browser queue membership/future/creation defaults, v8→v9 upgrade).
- Focused Vitest: `src/components/__tests__/VideoExtracts.rating.test.tsx`, `src/hooks/useVideoExtractPlayback.test.tsx`, `src/components/tabs/__tests__/ExtractsTab.test.tsx`, viewer source tests, and `src/pages/__tests__` — **140+ passed**, 0 failed.
- Focused Rust: `cargo test --lib video_` — **20 passed**; `cargo test --lib issue6_` — **11 passed, 1 ignored**; queue video tests pass.
- Full `cargo test --lib` is **not green for two pre-existing/unrelated tests**: `algorithms::daqe::ranker::latency::the_fallback_path_is_also_inside_the_budget` (timing budget) and `database::document_privacy::tests::recording_privacy_checks_every_derived_source_and_private_deletion` (pre-existing source-index assertion). Neither touches video-extract code; they are recorded rather than called passed.
- `src/lib/i18n/__tests__/i18n-completeness.test.ts` reports four pre-existing missing keys in `LearningCardsList`/`ReviewCardContent`; the new video/queue keys resolve in all six locales.
- Browser bulk move/suspend/lifecycle for video extracts is explicitly unsupported in this change: video rows are excluded from row selection/select-all and the action sheet omits select/suspend. Per-item remove/postpone/delete are supported.

### Final implementation gate results (2026-11-01)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **passed** |
| Focused ESLint on changed files | **0 errors**, warnings only (mostly pre-existing unused/empty blocks) |
| `npm run build` | **passed** |
| `npm run test:visual -- src/visual/issue6-video-lifecycle.visual.spec.ts` | **4 passed** |
| `npx vitest run` on video/list/playback/tabs/viewer/pages suites | **142+ passed**, 0 failed |
| `cargo test --lib video_` | **20 passed** |
| `cargo test --lib issue6_` | **11 passed, 1 ignored** |
| `cargo test --lib video_queue_respects...` | **passed** |
| `npm run test:run` (full frontend) | 8974 passed, 39 failed across 22 files. Failures are unrelated surface/timeout/settings/i18n tests (AudiobooksTab timeouts, Settings search arrival, pre-existing i18n keys, ReviewSession edit, etc.). `QueueScrollPage.rebuild.test.tsx` failed only in the full parallel run and passed 12/12 when run alone; recorded as a suite-level flake, not called green. |
| `cargo test --lib` (full Rust) | 1800 passed, 2 failed: DAQE ranker latency budget and document-privacy cross-source assertion; neither touches video-extract code. Recorded, not called green. |
| `npm run test:scripts` | Linux environment cannot satisfy the macOS RAM fixture (`memoryBenchMacOs.test.mjs`); unrelated to this change. |

The 8.5 acceptance workflow is exercised at the browser persistence boundary (create/queue/seen/rate/parent invariance/remove/re-add/restart/advance cutoff/rate again) and at the native repository/queue boundary. A full interactive GUI run of the 20 visual steps on Linux/Windows/macOS/Android/iOS remains a platform acceptance item, not a claim made here.

Task checklist: **49/49 complete**. No production data was migrated outside test fixtures; the migration runs on application upgrade. The implementation touched only the video-extract lifecycle, queue routing/visibility, the existing Extracts IA, browser persistence, tests, translations, and the relevant handbook section.

## Current Issue #6 acceptance

V01 and V02 → task 8.9. Existing queue membership, independent receipt and playback semantics are the implementation to exercise. Use three distinct observable states (New, Seen, Reviewed), unchanged parent sentinel, and native plus supported browser persistence after restart. Historical targeted passes do not cover the final advertised platform matrix. Track current wider-suite failures through the shared closure register.
