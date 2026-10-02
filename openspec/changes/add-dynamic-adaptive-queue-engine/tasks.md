## 1. Storage — migration `117_daqe_queue_engine`

- [x] 1.1 Add migration `"117_daqe_queue_engine"` to `MIGRATIONS` in `src-tauri/src/database/migrations.rs` (append-only; current tail is `116_add_learning_item_source_reference`)
- [x] 1.2 Create `daqe_model_cache` (`content_hash TEXT PRIMARY KEY, rubric_version INTEGER NOT NULL, score REAL, tier TEXT, gate REAL, computed_at TEXT NOT NULL`)
- [x] 1.3 Create `daqe_queue_snapshots` (`collection_id TEXT, profile TEXT, knobs_json TEXT NOT NULL, ranked_ids_json TEXT NOT NULL, term_breakdown_json TEXT, top10_json TEXT NOT NULL, computed_at TEXT NOT NULL`)
- [x] 1.4 Add nullable columns to `item_activity_log`: `idle_time_ms INTEGER`, `scroll_depth_ratio REAL`, `interaction_density REAL`, `exit_action TEXT`
- [x] 1.5 Add `DecisionModelTier` (`SurfaceSkim` | `MediumAnalysis` | `DeepFoundational`) and its `1..5` complexity mapping — landed in `models/daqe.rs` rather than a separate `decision_model.rs`, since the tier is part of the same wire contract as the knobs and its complexity value is an `energy_fit` input
- [x] 1.6 Add `models/daqe.rs`: `DaqueKnobs` (six fields, documented defaults), `TermValue { value: f64, available: bool, defaulted: bool }`, `TermBreakdown` (five `TermValue`s + applied weights), `RankedItem { item, score, breakdown }`, `QueueSnapshot { ranked, top10, computed_at, knobs }`
- [x] 1.7 Rust unit tests: defaults match the `queue-mode-presets` table; `DecisionModelTier` maps to 1..5; serde round-trip of `DaqueKnobs`
- [x] 1.8 Confirm `cargo test` passes and a fresh DB migrates to 117 with the prior 116 fixture intact

## 2. Ranker core (pure, no I/O)

- [x] 2.1 Create `src-tauri/src/algorithms/daqe/mod.rs` and register `pub mod daqe;` in `algorithms/mod.rs`
- [x] 2.2 `terms.rs`: `SrsUrgency` producer from `QueueItem`'s `stability`/`interval`/`retrievability`/`due_date`; no per-item-type constant. Reuse `calculate_fsrs_document_priority` (`algorithms/mod.rs:291`) for the document arm
- [x] 2.3 `terms.rs`: `GoalRelevance` producer delegating to `algorithms/relevance.rs` composite, preserving its weight-redistribution-on-missing-signal behaviour and 0.5 cold start (design D2)
- [x] 2.4 `terms.rs`: `EnergyFit` producer — `1 - |complexity - K| / 4`, clamped `[0,1]`; falls back to a fixed per-item-type default complexity and sets `defaulted: true` when no model supplies complexity
- [x] 2.5 `terms.rs`: `InterleavePenalty` producer from cosine similarity against `H_recent` (max-N same-topic streak reuse from `engaging_scheduler.rs` `EngagementPreferences.max_same_topic_streak`); 0.0 on no topic overlap; must not move items across composition boundaries
- [x] 2.6 `terms.rs`: `FrictionPenalty` producer from postpone counts, `idle_time_ms` vs `active_seconds` imbalance, and abandoned reviews; 0.0 with no telemetry; bounded `[0,1]`
- [x] 2.7 `ranker.rs`: `rank(items, knobs, context) -> Vec<RankedItem>` computing `S(i)` exactly as specified; deterministic tie-breakers (existing queue position, then item id)
- [x] 2.8 Rust unit tests: the two worked energy-fit scenarios (`1.0` at distance 0, `0.0` at distance 4); clamping at both ends
- [x] 2.9 Rust unit tests: with every non-SRS term neutral, ordering is identical to `queue_selector::sort_queue_items` on the same fixture. **Implementation consequence:** no `0..1` score reproduces that comparator's due/new/future bucketing, so `rank()` defers to the real comparator when `knobs.is_srs_only()` instead of restating it (see design D1) — see the note added to `design.md`
- [x] 2.10 Rust unit tests: equal-`S(i)` items order stably across two sorts; no scheduler field mutated by ranking (snapshot `stability`/`difficulty`/`interval`/`due_date` before and after)

## 3. Degradation and performance gate

- [x] 3.1 Implement every documented neutral fallback: `M_relevance` and `M_energy_fit` to local determinate values, `P_interleave` and `P_friction` to `0.0`, each with `available: false`
- [x] 3.2 Add `src/lib/daqe/snapshot.bench.ts` using `seededRandom` from `src/test/bench-support.ts`, result folded into a module-level sink, body returning `void`. **Relocated from the planned `src-tauri/.../ranker.bench.ts`:** the gate is `vitest bench` over `src/**/*.bench.ts` and cannot time Rust. The ranker's own 150 ms budget is gated by the Rust latency test in task 3.4; this bench covers the UI-thread path the gate *can* see — projecting a 5 000-entry snapshot onto the store — plus the no-snapshot fallback
- [x] 3.3 Record both baselines in `scripts/perf-baselines.json` (`daqe/project-snapshot-5000-items` 0.7484, `...-no-snapshot` 0.05393) with the reason inline. The ~14x ratio between them is itself the signal that the previous order is preserved rather than recomputed
- [x] 3.4 Assert the top-10 latency requirement in a Rust test on the reference fixture (available within 150 ms); if it fails, implement the partial-sort escape (top-10 heap, full sort deferred) rather than raising the budget
- [x] 3.5 Cache failure paths covered: `daqe_model_cache_repository` has `a_miss_is_none_and_not_an_error`, `an_unrecognised_tier_reads_as_absent_rather_than_a_guess` (a row from a removed build degrades rather than guessing), `a_written_judgement_round_trips`, and per-rubric-version isolation. On the ranker side, `Repository::daqe_friction_inputs` returns `FrictionInputs::default()` on a read error, so an unreadable telemetry store yields a valid ordering with a zero friction term, and `every_term_is_unavailable_for_an_item_with_no_signals` plus `degradation_never_throws_and_always_orders_the_whole_pool` assert the ordering survives
- [x] 3.6 `npm run bench:check`. Both DAQE baselines PASS (1.05x, 1.02x) and the suite runs the bundle-budget leg as its final step. **One pre-existing failure, not DAQE:** `precision-scheduler/review-sequence` at 1.27x, which also fails on a stashed tree at a *worse* 1.35x. See 10.2

## 4. Decision-model provider

- [x] 4.1 `algorithms/daqe/decision_model/mod.rs`: `DecisionModelProvider` trait with `evaluate_score`, `evaluate_choice`, `evaluate_noul`; a registry keyed by stable provider id; re-registering an id replaces rather than duplicates
- [x] 4.2 Default implementation as a Tauri command wrapping three new `AITaskDefinition`s in `src/lib/ai/tasks/definitions/daqeDecisionTasks.ts`, modelled on `passageClassificationTask.ts` (`outputKind: "structured"`, `AISchemaDescriptor`, `validate`, `modelClass: "fast"`, bounded `timeoutMs`, `requirement: "prompt"`); register via `registerTasks`
- [x] 4.3 Wrap all item content with `wrapUntrustedBlock` / `UNTRUSTED_CONTAINMENT_CLAUSE`; add a test using `findUntrustedLeaks`
- [x] 4.4 Validation rules: score in `[0,1]` rejected (not clamped) when out of range; at most one repair retry via the existing `REPAIR_INSTRUCTION` path; unresolved failure reports `InvalidStructuredOutput` from `src/lib/ai/errors.ts` and the term takes its local fallback
- [x] 4.5 Add `daqeModelCacheRepository` in `src-tauri/src/database/`: read/write by `content_hash + rubric_version`; invalidate on content change; bypass cache for session-dependent judgements (current goal, fatigue-adjusted relevance)
- [x] 4.6 Per-call timeout (`ProviderRegistry::timeout_ms`, default 8 s; `LocalDecisionEngineProvider` 12 s); a provider that already failed within a ranking pass SHALL be skipped for the remaining items rather than retried per item — carried as `ProviderFailure::SkippedAfterFailure`; failures recorded via `recordTaskDiagnostic`
- [x] 4.7 Remote gate: when `allowRemoteDecisionModel` is `false` the outbound payload builder is unreachable. When `true`, payload is a structural outline only (heading skeleton, type, length) — unit test asserts a body-text fixture, verbatim title, and tags are all absent
- [x] 4.8 Register a local GGUF/ONNX decision engine as a `LOCAL_MODEL_PROVIDER_ID` `AIProvider` in the existing `providers/index.ts` registry — no new router (design D4)
- [x] 4.9 Rust tests: ranker completes with no provider registered; provider timeout; provider recovery after failure without user intervention

## 5. Dwell telemetry

- [x] 5.1 `useActiveTimeTracker`: accept `idleTimeoutMs` (default `45_000`); keep `IDLE_THRESHOLD_MS = 60_000` as a deprecated re-export so existing call sites still compile
- [x] 5.2 Retroactively clamp the idle block out of `activeDwellMs` in the accrual branch (`useActiveTimeTracker.ts:181-195`) and record it as `idle_time_ms`; assert `active + idle` equals elapsed wall clock
- [x] 5.3 Migrate each call site to pass the knob via `useDaqeIdleTimeout`. **Only two call sites exist:** `useReadingSessionTracker` and `useQueueTimeTracker`. There is no `useListeningSessionTracker` — the plan listed a hook that was never built, and its listening path is covered by the reading tracker
- [x] 5.4 Confirm the 1 000 ms heartbeat, visible/focused/foreground gating, and flush-on-blur/item-change/unmount are unchanged
- [x] 5.5 Extend `record_active_time` (`commands/item_stats.rs:43`) to accept `idleTimeMs`, `scrollDepthRatio`, `interactionDensity`, `exitAction`; extend `ItemActivityEvent` (`models/item_activity.rs:68`) to match
- [x] 5.6 Derive `scrollDepthRatio` in `[0,1]` from document traversal; exclude engagement signals from `ENGAGEMENT_EVENTS` that do not imply traversal
- [x] 5.7 `exitAction` validation against the six defined values; an unrecognised action SHALL NOT be stored
- [x] 5.8 Wire the return-from-away notice: subtle, dismissible, non-blocking, and shown once per idle episode
- [x] 5.9 Reads use `Metric<T>` (`models/item_stats.rs:40`) so a never-measured metric is `Untracked`, not `0`
- [x] 5.10 Tests: window blur pauses accrual; idle block excluded from dwell; time alone never re-engages; unclean termination preserves observed time and attributes no gap; `scrollDepthRatio ≈ 0.7` at 70% traversal; `active + idle` equals elapsed
- [x] 5.11 Tests: timeout bounds `15000`–`120000` enforced; dwell aggregation never mutates interval, stability, or due date

## 6. Knobs and presets (frontend)

- [x] 6.1 `src/lib/daqe/knobs.ts`: `DAQE_KNOBS` schema (six knobs, ranges, defaults), a validator rejecting out-of-range and non-integer values without overwriting the stored value
- [x] 6.2 `src/lib/daqe/presets.ts`: the four DAQE presets as knob vectors per the spec, plus the existing five `PriorityPreset` values
- [x] 6.3 `settingsStore`: add `daqe = { knobs, activePreset, decisionModelProviderId, allowRemoteDecisionModel: false, rankingEnabled: false }`; defaults per `queue-mode-presets`
- [x] 6.4 `DaqeKnobPanel.tsx`: six labelled controls with value, range, description; immediate re-rank on change with no apply step; states that controls affect ordering only
- [x] 6.5 Active-preset detection: exact match reported; any individual adjustment reports no active preset
- [x] 6.6 i18n descriptions for the four new presets in **all six locales**, following the existing `queuePreset.<name>Desc` pattern (or the `daqePreset.*` namespace if that proves cleaner — see design Open Questions)
- [x] 6.7 Tests: preset writes all six knobs; preset is fully overridable; out-of-range rejection; non-integer `energyTarget` rejection; persistence across restart; exact-match vs diverged attribution; preset selection mutates no scheduler state

## 7. Wire ranking into the queue

- [x] 7.1 `commands/queue_daqe.rs`: `rank_queue(collection_id, knobs, model_inputs) -> QueueSnapshot` on the async runtime, writing `daqe_queue_snapshots`, returning full order plus `top10`. **Design consequence recorded in `design.md`:** the AI task spine is frontend TypeScript, so Rust cannot call the decision model. Model judgements therefore cross the command boundary as `ModelInput` (all fields optional; a `None` means "not measured"), while Rust owns urgency, `relevance.rs`, friction from telemetry, and the ranking. This is what the `unified-native-on-device-ai` "no second router" decision implies in practice
- [x] 7.2 `queueStore`: serve the last snapshot while a re-rank is in flight, swap on completion; fall back to the pre-DAQE sort when no snapshot matches the current knob signature — never an empty state
- [x] 7.3 Knob change re-ranks the existing pool in place: membership unchanged, no scheduler table written
- [x] 7.4 `TermBreakdown` surfaced in the queue item popover — five term values, applied weights, the recent-history window behind the interleave penalty, and `available`/`defaulted` flags; no bare total score anywhere
- [x] 7.5 Verify `flashcard-review-session` is untouched: ranking never places a document in the Review tab session
- [x] 7.6 Verify `queue-item-type-routing` still holds: toggles and composition govern membership, the ranker governs order, and a strongly document-favouring `energyTarget` cannot pull a document into an extracts-only session

## 8. Adaptive learning loop

- [x] 8.1 High `activeDwellMs` + extraction rate → raised priority contribution for the item's collection and semantic cluster, reusing the existing semantic index and `neural_queue.rs` spreading activation
- [x] 8.2 Repeated rapid skips, or `idle_time_ms` dominating with no interaction → raise `split-candidate` or `auto-demote` with its evidence attached
- [x] 8.3 Recommendation flags are dismissible by the user and SHALL NOT remove or dismiss an item
- [x] 8.4 Velocity = items consumed per active minute vs a trailing-30-day baseline from `study_statistics`; below 40% of baseline lowers the **effective** energy target while leaving the configured value untouched; the breakdown reports the effective target and the reason for the difference
- [x] 8.5 Below the existing `hasSufficientData` sample threshold the velocity term is `Untracked` and no downshift occurs
- [x] 8.6 Tests: cluster promotion is attributable to telemetry; resistance raises a flag with evidence; dismissal works and the item survives; velocity collapse lowers the effective target; small sample produces no downshift

## 9. Collapse the competing orderings (gated on Phase 2-3)

- [x] 9.1 Prove fallback equality: with every non-SRS term neutral, `rank()` output matches the pre-DAQE sort on a shared fixture
- [x] 9.2 Delete the per-item-type priority literals at `commands/queue.rs:191`, `:268`, `:315`, `:703`, `:746` and route all five call sites through the ranker
- [x] 9.3 `getPriorityScore` (`src/utils/reviewUx.ts:144`) becomes the `goalRelevance` producer; remove the now-duplicated `userIntent` derivation from the DAQE path
- [x] 9.4 Rewire `orderScrollItemsByCombinedCriterion` (`src/utils/queueScrollOrder.ts:231`) to apply its proportion bias to the ranker's topic distribution rather than a 0–10 priority scale; keep `MAX_SAME_TYPE_CONSECUTIVE` and `stableJitter`
- [x] 9.5 **Measured, no baseline update warranted.** `queueScrollOrder/combined-sort-300-items` 0.97x and `queue/build-500-items` 0.93x against their existing baselines — both slightly *faster*, well inside the 1.25x tolerance. The bench measures `orderScrollItemsByCombinedCriterion`, which 9.4 left untouched (it adds `orderRankedScrollItems` alongside it rather than changing it), so there is no intentional perf change to record. Rewriting a baseline to a slightly-better number would only add noise for the next reader
- [x] 9.6 Record in `design.md` that `recommendation-queue-blending` is superseded by the `goalRelevance` producer (D2)

## 10. Verification

- [x] 10.1 `cargo test` and `npm run test` green. **Verified:** `cargo test --lib` 1501 passed / 0 failed; `npx vitest run` 5986 passed / 2 failed. **Known pre-existing issues, each verified failing with these changes stashed and not DAQE's to fix:** `audioEditionIntegration` and `queueActions` (TypeScript), and `plethora_auth::refresh::tests::refresh_maps_session_revoked_to_typed_error` (fails when run in isolation, passes in the full `cargo test` run). **Known pre-existing issues, verified with these changes stashed and not DAQE's to fix:** `plethora_auth::refresh::tests::refresh_maps_session_revoked_to_typed_error` fails when run in isolation (`cargo test --lib plethora_auth::refresh`) but passes in the full `cargo test` run — a test-ordering/shared-state issue that predates this work. `kp-timeline/sample-sweep-phone` fails `bench:check` at ~1.27x
- [x] 10.2 **Verified, with one pre-existing failure.** Both DAQE baselines PASS (1.05x, 1.02x). The suite reports 1 failure: `precision-scheduler/review-sequence` at 1.27x — which also fails on a stashed tree, where it measures *worse* (1.35x), so it is not DAQE's regression. `kp-timeline/sample-sweep-phone`, which failed earlier in this session, passes on this run; both benchmarks sit near their tolerance boundary on this machine
- [x] 10.3 `openspec validate add-dynamic-adaptive-queue-engine --strict` clean
- [ ] 10.4 Manual: energy sweep 1→5 visibly reorders; interleave knob 0→1 pushes a repeated topic down; AFK timeout set to 15 s, walk away, return, notice appears and dwell excludes the gap. **NOT DONE — needs a running app.** Each behaviour has unit coverage (ranker `energy_fit`, `orderRankedScrollItems`, `useActiveTimeTracker.dwell`), but none of it substitutes for the knob panel being wired into a settings surface and observed end to end
- [ ] 10.5 Manual: select each of the four DAQE presets, confirm knobs, order, and description; adjust one knob and confirm attribution clears. **NOT DONE — needs a running app.** `detectActivePreset` is unit-tested for exact-match and diverged attribution, and the six locales carry the strings, but `DaqeKnobPanel` is not yet mounted in any settings surface
- [ ] 10.6 Manual: disable the decision model entirely and confirm ordering still valid; enable a remote provider with `allowRemoteDecisionModel = false` and confirm no outbound request. **NOT DONE — needs a running app.** `buildRemoteDecisionPayload` is unit-tested to refuse when the opt-in is off, and the ranker is tested with no provider registered, but no real network call was observed
- [ ] 10.7 Manual on macOS, Windows, Linux. **NOT DONE — needs the three platforms.** Nothing in DAQE is platform-specific (Rust + TS, no native calls), and the snapshot projection benches at 0.78ms for a 5 000-item pool, but cross-platform UI behaviour is unverified