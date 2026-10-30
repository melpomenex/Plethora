## 1. Reproduction, baselines, and specification compatibility

- [x] 1.1 Capture the implementation-start revision, current overlapping OpenSpec changes, issue screenshots, and an isolated fixture database; verify every traceability row has an evidence classification and retain before-state records for priority, source links, due dates, memory, and counts (R00).
- [x] 1.2 Repair only the malformed main-spec wrapper in `openspec/specs/priority-vector-improvements/spec.md` by adding Purpose and changing its delta heading to Requirements while preserving its current requirement; verify `openspec validate priority-vector-improvements --type spec --strict` and this change's archive preflight have no structural blocker before behavior implementation.
- [x] 1.3 Add the deterministic issue-6 fixture builder described in verification.md with fixed clock, stable IDs, all card types, sectioned sources, video extract, playlist, and provider mocks; verify fixture counts/provenance and clean database recreation (R00).
- [x] 1.4 Reproduce keyboard priority commits with the actual configured `doc.priority` command, EPUB forwarding, Enter and Apply, and independent persisted reads; record whether the reported failure remains on current native builds without replacing the already-working shortcut path blindly (R08).
- [x] 1.5 Reproduce S04/S09/S10 and the confirmed extract-namespace card-create path using real command/repository boundaries, then compare S12 with pinned selection and empty outline-node content; verify failure signatures distinguish identity, persistence, refresh, and provider errors (R03/R04/R06/R13/R14).

## 2. Scheduling and canonical priority evidence

- [x] 2.1 Extend queue/ranking feature assembly in Rust models/commands and frontend adapters with canonical positional P, explicit-set semantics, source kind, last-review timing, and complete available memory evidence; batch-load one priority population snapshot and verify 0/25/50/75/100 direction, ties, filters, singleton, invalid legacy rows, parent inheritance, and playlist 1–10 adaptation (R01/R02).
- [x] 2.2 Implement the pure explicit-clock temporal/M policy from D2, stable exponential overdue transformation, validation/defaults, and per-type routing in the existing ranking algorithm layer; verify the exact boundary matrix and independent M slope .2 with no manual input in T (R01).
- [x] 2.3 Migrate document, extract, video-extract, learning-card, playlist, and other supported queue producers plus Engaging selection to canonical ranking evidence; remove document decay/manual multiplier/stability-difficulty rank bonuses and the `item.priority` evidence fallback; verify ranking/priority operations leave every schedule/history field unchanged (R01/R02).
- [x] 2.4 Make SRS-only comparator and adaptive ranking consume the same captured clock/features, retain due/new/future buckets, and apply deterministic due/identity tie-breaking; verify input permutations, date boundaries, and unchanged eligibility policies (R01).
- [x] 2.5 Update `src/utils/reviewUx.ts`, its vector/legacy preset/session/filter consumers and queue explanation UI to D4's compatibility mapping; preserve preset names and already-ranked/list/custom session order, remove priority-bearing secondary ranking, and verify every preset counts T and P once (R02).
- [x] 2.6 Add Rust deterministic/property-style matrix tests plus frontend diagnostic parity tests for missing/invalid/extreme memory/dates, future/new documents, Unicode identities, manual-zero legacy flags, equal-state ordering, and bounded monotonic results; verify each original mathematical counterexample fails under the old policy and passes under the new one (R01/R02).
- [x] 2.7 Deliver fixed 1k/10k before/after ranking reports with top-20 overlap, order displacement, priority/new/due exposure and finite-pool drain; verify all D2/D3 acceptance judgments including important-new versus modest overdue and low-priority-old versus high-priority-future (R01).

## 3. Canonical card loading and presentation

- [x] 3.1 Replace partial `any` LearningItem fabrication in QueueScrollPage with bounded full-card hydration by persisted identity; normalize backend field/type casing once, preserve custom non-due eligibility, and verify metadata/type/ranges/source identity survive queue conversion and relaunch (R03).
- [x] 3.2 Extend `src/utils/cloze.ts` into the shared validated parser/projection with marker precedence, hints, simplified/legacy/multiline formats, collision-safe indexes, validated range-only legacy data, Unicode offset handling, formatting, and typed invalid results; verify all shared C01–C12 fixtures (R03/R04).
- [x] 3.3 Extract content-only `ReviewCardContent` and use it from ReviewCard/FlashcardScrollItem while keeping existing layouts/gestures/assessment controls; verify identical hidden/revealed basic and cloze fixtures in Review, queue-list Scroll and Optimal modes (R03/R05).
- [x] 3.4 Route review headers, listing previews, automatic speech, accessibility labels and auxiliary explanations through safe canonical prompt/source content; verify no hidden answer/raw marker DOM leak, no type-label-as-source explanation, and no pre-reveal explanatory answer disclosure (R03).
- [x] 3.5 Extract/reuse Review's occlusion content primitive with metadata-based routing, actual-image coordinate box, opaque/authored masks, target/all reveal, and responsive constraints; verify QA-with-occlusion metadata and tall/wide/multi-region cases across every mode (R05).
- [x] 3.6 Share existing asset resolution in the content primitive, add loading/missing/corrupt/invalid-geometry repair states and stale-load guards, and suppress redundant unmasked images/grading; verify local/imported assets, failures, navigation races, resize and scrolling at desktop/mobile sizes and DPR 1/2 (R05).

## 4. Shared editing and atomic content persistence

- [x] 4.1 Extend `update_learning_item_content_with_version` and repository edit transaction with optional tags/canonical cloze fields, complete prior-content version, existing sync journal/revision and canonical return; verify injected failure at version/content/tags/journal stages leaves no partial edit and preserves every excluded scheduling/priority/source field (R04).
- [x] 4.2 Introduce the narrow per-entity mutation coordinator over existing API/store operations; own busy/revision/error state there and reconcile committed canonical records into each active cache by ID; verify stale completions cannot overwrite another card or newer state (R04/R06).
- [x] 4.3 Update InlineCardEditor with lossless range-to-markup editing projection, real hidden/revealed preview, raw source access, marker-free warning/repair behavior, retry-preserved draft and atomic save; verify legacy ranges, changed markers, blank answer, Unicode/HTML and tag/content failure cases (R04).
- [x] 4.4 Wire Review, Scroll, Optimal, document-linked LearningCardsList and compatible deck entry points to the same editor/mutation lifecycle; remove browser prompt editing, retain complex-type Studio handoff and Cmd/Ctrl+E, and verify activation, focus return, correct identity and position across modes/native runtimes (R04).
- [x] 4.5 Extend content version serialization/restore for cloze source/ranges/tags while preserving absent fields in old snapshots; verify restoring both old and new versions never changes memory/scheduling/source/manual priority (R04).

## 5. Session lifecycle and refresh reconciliation

- [x] 5.1 Extract a pure identity-based transition/reconciliation helper used by ReviewStore and QueueScrollPage, with current identity, successor, reveal revision, reviewed/removed sets and refresh generation; remove independent delayed rendered-index authority and verify first/middle/last/noncurrent removal without double advancement (R06).
- [x] 5.2 Integrate existing undoable deletion results with committed deletion barriers, due/full-card cache removal, static custom queue exclusion and current-identity preservation; verify a successful delete requires no grade and an empty session completes (R06).
- [x] 5.3 Merge/ignore late refresh and hydration results using operation revisions and session generations; prevent stale edits/deletes from being reversed after tab changes and verify deferred-promise races with retained successor identity (R06).
- [x] 5.4 Integrate undo/redo/external deletion/suspension with the same transitions, restoring barriers/relative slots only after durable success; verify undo after last/only deletion, failed undo, restored schedule and no phantom/double entries (R07).
- [x] 5.5 Lock conflicting edit/delete/rating operations synchronously per entity, including same-tick double activation, and preserve the current item on failure; verify delete while rating, repeated Enter, navigation during save, and absence of synthetic review events (R06/R07).

## 6. Priority commits across input methods

- [x] 6.1 Reuse existing mobile draft/commit/deduplication behavior to expose one typed priority commit operation across popup, PriorityControl, reader badge, and queue overlay; retain entity-specific canonical backend dispatch and verify atomic order-key/derived-field/explicit-zero persistence (R08).
- [x] 6.2 Retain `doc.priority` remapping/Alt+P, EPUB bridge and modal Enter behavior while unifying pending/error/retry/focus handling; verify latest draft commits once, Escape writes nothing, late results target the captured identity, and background rating/navigation yields to overlays (R08).
- [x] 6.3 Add keyboard/pointer/touch integration tests using authoritative read-back and close/reopen/restart cycles rather than component-state-only mocks; verify equal values and ordering for 0/25/50/75/100 and injected save failure recovery (R08).

## 7. Playlist settings and queue effects

- [x] 7.1 Give global and per-subscription forms string drafts, explicit Save/Cancel, whole-form patches, dirty/pending/saved/error state and request guards in YouTubePlaylistManager; verify normal clearing/multi-digit typing, focus retention, cancellation and delayed/failed saves with zero keystroke writes (R09).
- [x] 7.2 Enforce D9 numeric ranges in frontend and authoritative Rust/browser persistence boundaries; return canonical committed values, avoid truthiness defaults, and verify invalid direct calls/historical values do not silently replace valid state (R09).
- [x] 7.3 Seed new subscriptions from saved global defaults in the subscription creation transaction instead of hardcoded values; verify existing subscription overrides and imported document schedules/priorities are unchanged (R09/R10).
- [x] 7.4 Verify/update queue interspersion to use saved per-subscription interval, max consecutive, deterministic collision priority and once-only import priority seed; add fixed cadence/collision/relaunch fixtures (R10).
- [x] 7.5 Apply focused existing-system labels/layout/accessibility/i18n, explain defaults and interspersion, register stable Settings search target IDs/catalog/coverage/reveal rules without user titles, and verify keyboard and narrow viewport editing plus settings-search gates (R09).

## 8. Independent video-extract lifecycle

Scope clarification (2026-10-30): cloud sync and protocol/server changes are excluded per the user; preserve local persistence and backup/restore.

- [x] 8.1 Add nullable first/last seen fields through the next numbered migration, model, repository, APIs and supported browser local adapter; verify existing rows/counters remain unchanged, failed playback stays unseen, and opening records seen without scheduling (R11).
- [x] 8.2 Add retry-safe video-extract review event/operation receipt persistence and transactional schedule/counter update under the canonical rating command, reusing existing idempotency patterns; verify replay/conflict/concurrent operations, rollback, and exactly one event per intent (R12).
- [x] 8.3 Move submission ownership to the shared extract-review controller and make VideoExtractCard emit intent/results without its own competing write; verify child-parent wiring produces one call/event/advance and busy controls stop double-click/Enter (R12).
- [x] 8.4 Expose independent ratings and clear New/Seen/Not reviewed/Reviewed plus Due statuses in ordinary lists and dedicated sessions, including never-rated entries under new budgets; verify parent/extract grades affect only their own histories (R11/R12).
- [x] 8.5 Include seen fields/events in local backup/restore/absent-field compatibility and local offline persistence; verify restart, collection restore, deletion receipt behavior and adapter parity without requiring remote inference or an online media source (R11/R12).

## 9. Assistant source, generation, scope, and position

- [x] 9.1 Introduce the typed frozen source envelope and resolve queue extract/display contexts to canonical document/extract relationships before request/tool normalization; migrate AssistantPanel/QueueScrollPage/DocumentQATab/Studio call sites and verify no display namespace reaches a document FK (R13).
- [x] 9.2 Route single/batch MCP card persistence through shared canonical creation/lineage validation, retaining collection/tree/count/outbox checks and explicit cloze source; verify valid extract-linked creation plus deleted/mismatched source, missing collection and rollback failures on real SQLite with FKs enabled (R13).
- [x] 9.3 Extend existing acceptance/proposal identities to Chat/Studio candidate retry, return accurate per-candidate attempted/saved/failed receipts, and retry only failed identities; verify partial batch success, lost response, same-candidate retry and correct saved/Open/error artifacts without raw nested DB JSON (R13).
- [x] 9.4 Preserve parser/schema validation, Chat explicit-create versus preview-only policy, Learning Agent preview/approval and selected provider privacy/local-only gates; verify malformed/unsupported candidates, provider timeout, local no-cloud-key execution and zero silent remote calls (R13/R14).
- [x] 9.5 Replace the first-node/cached-content `buildAgentSection` shortcut with asynchronous shared canonical section/passage-set resolution at submit; use current loaders/index/provenance and verify Markdown, PDF, EPUB, duplicate titles, parent/child overlap, stale/empty/wrong-owner and pinned-selection cases (R14).
- [x] 9.6 Share D12 token budgeting and scoped envelope across Chat/Agent/Q&A/Studio and local/Apple/remote adapters; remove silent character slicing and outside-section neighbors for explicit scope, and verify each provider sees actual selected bodies, disclosed truncation or zero-call failure (R14).
- [x] 9.7 Add a complete generation-to-acceptance integration test with a provider spy and real local persistence boundary; verify the selected section body, omitted unrelated sections, correct saved source IDs and no card before required agent approval (R13/R14).
- [x] 9.8 Replace unconditional Assistant message-change scrolling with conversation-keyed anchor/follow-bottom state, hydration/resize-aware restoration and Latest action; verify streaming while at bottom/scrolled up, reopening, late images, conversation/provider/tab changes and reduced motion (R15).
- [x] 9.9 Preserve reader locator/progress when Assistant opens/closes/resizes in document and queue contexts, including late hydration; verify HTML/PDF/EPUB browser fixtures and native checks show no premature zero-position save (R15).

## 10. Full-system verification and implementation handoff

- [x] 10.1 Exercise the deterministic R16 full workflow through Review, queue-list Scroll, Optimal, document-linked cards, integrations and Assistant; after each mutation assert visible state and authoritative persisted record/receipt, then recreate/relaunch the local store and repeat key reads.
- [x] 10.2 Run focused and full relevant Vitest suites, Rust algorithm/repository/command suites and script tests from verification.md; retain actual logs/counts, fix introduced failures and record unrelated failures separately without calling a red gate passed.
- [x] 10.3 Run seeded queue/card/context benchmarks and `npm run bench:check` after a production bundle build; verify no unexplained regressions, update perf/bundle baselines only for intentional measured changes with written rationale, and retain ranking/hydration complexity evidence.
- [x] 10.4 Run Playwright cross-mode hidden/revealed and interaction geometry suites plus the practical native platform matrix; verify opaque aligned occlusions, accessible edit/save/delete/priority/playlist controls and scroll retention, recording unavailable device/provider checks as pending rather than passed.
- [x] 10.5 Update handbook, priority-system feature documentation/generated help, localized UX copy, settings search guidance as needed and release notes during implementation; verify higher-means-important positional priority, separate ranking/scheduling, backlog curve examples and video seen/reviewed semantics agree with shipped behavior.
- [x] 10.6 Rehearse upgrade/backup/restore and additive-schema rollback on fixture data; verify old priorities, cloze sources, history, memory and new review receipts survive with no duplicate/missing records or silent old-client field loss (R16).
- [x] 10.7 Re-run strict change/spec validation, resolve overlapping unarchived delta conflicts, complete the traceability evidence and adversarial review in verification.md; verify every required test/platform outcome is passed or explicitly gated before declaring implementation complete or archiving.
