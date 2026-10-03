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
- [x] 3.6 `npm run bench:check`. Both DAQE baselines PASS consistently and the suite runs the bundle-budget leg as its final step. One pre-existing benchmark fails per run, alternating between `precision-scheduler/review-sequence` and `kp-timeline/sample-sweep-phone` as each crosses its tolerance boundary; both were verified failing without these changes. See 10.2

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
- [x] 7.4 `TermBreakdown` surfaced in the queue item popover — `queueStore.applyRankSnapshot` projects the snapshot into `rankBreakdowns`, and `ItemDetailsPopover` renders `DaqeScoreBreakdown` above the scheduling section at both call sites. Omitted entirely when there is no entry, so no surface can show a bare total. Eight `useQueueStore` test fixtures were extended with the field: `rankBreakdowns` is a derived cache, and a fixture that omits it is modelling an older store — five term values, applied weights, the recent-history window behind the interleave penalty, and `available`/`defaulted` flags; no bare total score anywhere
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

## 9b. Follow-up surfaces (added after review)

### 9b.A Correction to an earlier finding

- [x] 9b.0 **Correction.** I previously reported that Jev, Laya and Clef "have no client in this codebase" and declined to offer them. That was wrong. All three are real deployments of one protocol — `POST /v1/systemone` with `choice` / `score` / `noul` question types — which is exactly the shape the Rust `DecisionModelProvider` trait was modelled on. OpenRouter serves the same protocol under a `decisions` modality. The old test asserting these names were absent has been **deleted and inverted**: `decisionModelOptions.test.ts` now asserts they are present, so nobody removes them again on a false premise.

### 9b.B One protocol client

- [x] 9b.1 `lib/daqe/systemOne.ts` — the System One client: request builder, response reader, and validators for every documented limit (8 questions, 8 000-char state, 1 800-char instructions, 2 000-char criteria, 2–20 choice options, 2–10 score levels). 44 tests
- [x] 9b.2 All three DAQE primitives asked in **one** request per item — the protocol bills `state` once and shares it across questions, so three calls would triple the cost for identical information
- [x] 9b.3 Error mapping: 401 / 402 / 422 / 429 / 502 distinct and classified, retryable flagged, timeout distinguished from unreachable, and every failure throws rather than returning a partial shape (so the ranker can never mistake a failed call for a weak answer)

### 9b.C Real providers

- [x] 9b.4 `decisionModelOptions.ts` rewritten: **Jev** (hosted, `jevmodel.org`, `$0.042`/M in, output free), **Laya** (Convai, Apache 2.0, local), **Clef** (Cloudflare, Apache 2.0, Workers AI), **OpenRouter decisions** (`inception/mercury-decide:free`, `liquid/d1`, `upstage/solar-decide`, `togethercomputer/tev1-4b-experimental`), plus the existing spine and a generic endpoint. 24 tests
- [x] 9b.5 OpenRouter decision ids hardcoded on purpose — they are **absent from OpenRouter's public `/api/v1/models` list** and only reachable via `/models/{id}/endpoints`, so a catalogue-driven picker would come up empty
- [x] 9b.6 Per-provider endpoint and model-name resolution in one place, so a wrong default is one bug rather than one per call site

### 9b.D Download

- [x] 9b.7 `HfRuntime::LayaDecision` + `LayaDecisionAdapter` in `models/hf/adapters.rs`, registered in `all_adapters()`, `adapter()`, `tag()` and `from_tag()`. Detection is narrow on purpose: safetensors + a tokenizer, and a weights-without-tokenizer repo is **refused** rather than installed inert
- [x] 9b.8 `RunContract::ExternalEndpoint` — a decision checkpoint is served by a `laya-serve` the user runs, not a bundled engine, so the contract carries **no engine-relative paths**. `paths_contained()` has nothing to check, which is the safe outcome rather than an unchecked one, and the STT route returns `NotTranscription` rather than a whisper path
- [x] 9b.9 No new downloader. The install goes through the existing `useHfModelStore.install` with the same resume, retry, cancellation, SHA-256 verification and licence capture that speech models get
- [x] 9b.10 `lib/daqe/decisionModelDownloads.ts` — a fixed checkpoint list rather than a repo id, because `models/hf/security.md` fails closed on unpinned artifacts and a free-text repo field would let a user route around that gate

### 9b.E Mobile reachability

- [x] 9b.11 `AdaptiveRankingSettings` registered as its own `SettingsPage` tab. `SettingsPage` is rendered identically by the desktop tabs and by `MobileNavigation`'s gear button, so this is the whole of the mobile work: **no mobile-specific code**. Verified: `src/components/mobile/` contains no settings files, and the gear button activates a `"settings"`-type tab.
- [x] 9b.12 i18n for every new string across all six locales
- [x] 9b.13 **Mobile queue score breakdown — wired.** `QueueItemActionSheet` is already shared by three surfaces (`MobileQueueView`, `ReviewQueueView`, `routes/queue.tsx`), so the breakdown was added **there**, once, rather than as a mobile-only affordance. It renders *above* the actions, so "why is this here?" is answered before "what can I do about it?", and the whole section is omitted when there is no breakdown — a queue with ranking off shows the sheet it always did.
- [x] 9b.14 All three call sites pass `rankBreakdown` and `configuredEnergyTarget`, and read `rankBreakdowns` from the queue store. The effective-vs-configured energy target is included so a fatigue downshift reads as "we lowered this because you slowed down" rather than as a number the user never set.
- [x] 9b.15 **Not a nested disclosure inside the row.** A row already has tap, long-press, and two swipe gestures; adding an expandable inside the row `<button>` would nest interactive content inside interactive content and fight the swipe handler. The long-press sheet is the existing affordance for "tell me about this row".
- [x] 9b.16 `src/__tests__/daqeBreakdownReachability.test.ts` — 12 source-level assertions guarding that no surface is *forgotten* (the failure mode this is most likely to hit), that the section is guarded on the prop, that it precedes the actions, and that it is not nested in the row button. Render tests would mostly re-assert that React passes props down; what matters is coverage across three call sites.



- [x] 9b.1 DAQE section inside `SessionCustomizeModal` (the "Customize Session" dialog): enable toggle, `DaqeKnobPanel`, `DaqeDecisionModelSettings`, plus an explicit note that ranking changes apply immediately and Cancel does not roll them back
- [x] 9b.2 `DaqeDecisionModelSettings` — the provider picker, which **did not exist** before this pass. `decisionModelProviderId` and `decisionEngine` were declared and defaulted but no UI ever wrote them
- [x] 9b.3 `lib/daqe/decisionModelOptions.ts` — the option list, with a module comment stating plainly that the PRD's **Jev** and **Laya** have no client in this codebase (they exist only as string literals in the registry's unit tests) and so are deliberately absent from the picker; **Clef** does not exist at all. Offering either would be a dropdown entry that resolves to nothing
- [x] 9b.4 Remote opt-in gate moved into the picker, with the consequence spelled out: without it the outbound payload builder is unreachable and the setting does nothing
- [x] 9b.5 i18n for every new string across all six locales

### 9b.F Where the decision-model API keys live — and a bug found while answering that

- [x] 9b.17 **Settings → Adaptive Ranking → Decision model.** Choose a provider, then enter its key in the field that provider's fields reveal. On mobile: the gear icon in the bottom nav, then **Adaptive Ranking**. The same picker is also reachable from the Queue's Customize Session dialog, which shows the knobs and points here for provider configuration.
- [x] 9b.18 **Keys go in the OS keychain, not in settings.** "Save to keychain" writes through `set_api_key` → `AIKeyStore`; the UI reads back a *masked* value (last four characters) and offers "Remove key". Only the boolean `settings.daqe.decisionApiKeySet` is persisted — enough for the picker to render a provider as configured, useless for calling anything.
- [x] 9b.19 **Bug found and fixed: the key was in localStorage.** The first implementation stored `decisionApiKey: string` in `settings.daqe`. That store persists to localStorage under `plethora-settings`, so a metered credential — Jev bills per input token, OpenRouter likewise — would have sat in plaintext, readable by any script reaching the page. Replaced with the keychain path above, and the settings field removed rather than left nullable.
- [x] 9b.20 **Pre-existing allowlist drift fixed at the root.** `set_api_key`, `get_masked_api_key` and `remove_api_key` each carried their own inline provider allowlist and had already diverged — `set` accepted `deepseek` while `get` and `remove` did not, so a DeepSeek key could be written but never displayed or deleted. Replaced by one `API_KEY_PROVIDERS` list and a shared `api_key_provider()` guard; `jev` and `clef` added there.
- [x] 9b.21 **One OpenRouter key, two uses.** OpenRouter decisions resolve to the same keychain slot as chat completions, so a user who already configured OpenRouter for chat models is not asked to paste the same key twice.
- [x] 9b.22 `src/__tests__/daqeApiKeyStorage.test.ts` — 11 assertions guarding that no plaintext key field returns to settings, that no surface reads a secret, that the draft is dropped after the write, that OpenRouter is not duplicated, and that the three keychain commands share one allowlist.
- [x] 9b.23 i18n for the keychain strings across all six locales, reusing the existing `aiProvider.*KeyStored` phrasing so the two surfaces read identically.

### 9b.G Consolidating the two settings tabs into one

- [x] 9b.24 **The duplication, stated plainly.** Adaptive ranking and Smart Queues were both settings tabs doing the same job: the ranking section appeared in both, including a *second* copy of the remote opt-in. Worse, they disagreed — each wrote a different preset field, so a reader who configured a provider in one place saw different state in the other with no way to tell which was true.
- [x] 9b.25 `AdaptiveRankingSettings.tsx` **deleted**, and with it the `SettingsTab.AdaptiveRanking` enum member, its nav entry, its lazy import and its render branch. `settings.adaptiveRanking` label removed from every locale.
- [x] 9b.26 Ranking is now a *section* of `SmartQueuesSettings`, alongside the auto-refresh poller it never had anything to do with. That tab was already the one reading `queueStrategyPreset` for the Queue toolbar's dropdown, so the surviving home is the one that had to keep the state.
- [x] 9b.27 Search keywords for "decision model", "jev", "laya", "clef", "openrouter" and "download model" moved onto the surviving tab, so nothing became undiscoverable by deleting the other one.
- [x] 9b.28 **One stored copy of the preset.** `daqe.activePreset` is gone — it was a second field for a fact `smartQueue.queueStrategyPreset` already holds. Whether the knobs still *exactly* match is derived per render by `detectActivePreset(knobs)`, so it cannot disagree with the knobs it describes. `DaqeKnobPanel`'s `activePreset` prop went with it; the panel already derived internally and used the prop only for a note that re-printed the scope note when you diverged, so diverging was effectively silent. It now says so.
- [x] 9b.29 The decision-model configuration is **one component**, `DaqeDecisionModelSettings`, absorbing the keychain handling from the deleted file. Mounted from Smart Queue Settings and the Customize Session dialog; asserted absent from the third queue surface so a fourth copy cannot appear.
- [x] 9b.30 The knob panel's re-rank callback in this surface was a no-op `() => {}`, so moving a slider here changed nothing until a reload. Now wired through `applyRankSnapshot`, reading knobs back from the store so it ranks the values the user just chose rather than the ones from a render ago.
- [x] 9b.31 `src/__tests__/queueSettingsConsolidation.test.ts` — 13 assertions: no second tab, no second component on disk, ranking and auto-refresh both still present, the rerank is wired, the search terms survive, one stored preset, no surface passes the removed prop, one decision-model component, and no settings surface writes a credential.
- [x] 9b.32 `daqeApiKeyStorage.test.ts` repointed at the new home of the keychain logic, so the plaintext-key guard keeps guarding after the file it named was deleted.

### 9b.H Knowing whether the decision model is actually working

The question asked after the API keys were wired, and it exposed a real gap:
`setupGaps` can only tell whether a field is **non-empty**. That is a
configuration check, not a connection check, and the difference is the whole
point — a revoked key, a wrong account id, or a model id the endpoint does not
serve all looked exactly like a good one. Nothing would have looked broken. The
queue would have reordered happily while every model-derived term silently fell
back to a per-item-type default.

- [x] 9b.33 `lib/daqe/decisionModelProbe.ts` — a real round trip: one tiny, unambiguous `choice` + `noul` over a state with exactly one true reading. Costs a few dozen input tokens, and the UI says so, because it is not free.
- [x] 9b.34 A stable `idempotency-key` per endpoint, so pressing the button twice in a session settles against the same billing record instead of charging twice.
- [x] 9b.35 Four distinct outcomes rather than a boolean: `ok`, `answered-unexpectedly` (reachable, transport fine, answer wrong — the signature of a wrong model id), `no-answer` (reachable but not a decisions endpoint), and `failed`. A well-formed answer to a nonsense question is a **warning, not a failure**: calling it a failure would teach readers to ignore the result.
- [x] 9b.36 The probe **returns** failures rather than throwing, so no call site needs a try/catch and the interesting outcome is a value.
- [x] 9b.37 "Test connection" in the picker, reporting outcome, latency, the model the endpoint said it resolved, the failure reason translated, and what the call was billed.
- [x] 9b.38 Previous results discarded when the provider changes — a result describing the previous endpoint would be worse than none.
- [x] 9b.39 `components/queue/daqeDecisionClient.ts` — endpoint resolution lifted out of the component so the picker and the queue status line cannot resolve an endpoint differently.
- [x] 9b.40 `DecisionModelStatusLine` — the **effective** state, stated in the ranking section above the knobs. `degraded` says plainly what is being used instead, because a configured-but-failing model is the one state where nothing else looks wrong.
- [x] 9b.41 Thirty-minute expiry on a green tick. Providers go down, and a success badge that outlived an outage would be worse than admitting we do not know.
- [x] 9b.42 14 unit tests on the probe and the live-state reduction, plus `daqeConnectionTest.test.ts` — 11 source-level assertions that the test exists, reports more than pass/fail, that the status line precedes the knobs, and that the probe cannot drift into becoming a second, cheaper ranking path.
- [x] 9b.43 i18n for 23 new keys across all six locales.
- [x] 9b.44 **Honest ceiling, stated in the code:** the status line reports the last *probe*, so between probes it is up to thirty minutes stale. The per-term degradation is still visible in the score breakdown, which marks an unavailable term "not measured" rather than showing a fallback as a measurement.

### 9b.I Clef: "Could not reach the endpoint" — three bugs, one of them structural

Reported after configuring a Cloudflare account id and token. The probe was the
thing that surfaced it, which is the argument for having built it first.

- [x] 9b.45 **Bug 1 — Clef's endpoint was built wrong.** The code assembled `https://api.cloudflare.com/client/v4/accounts/{id}` and appended `/v1/systemone`. Workers AI's actual endpoint is `POST /client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef` — the model is addressed in the **path**, and it is not a System One path at all. The wrong URL 404s while looking exactly like a wrong account id.
- [x] 9b.46 **Bug 2 — the model name was wrong in the body.** Clef's body `model` field matches `^(clef|clef-flash)$`. The code sent `@cf/cloudflare/clef-flash` there — the *path* form in the *body* field — which is a 422, not a model name. Now stripped to the bare name.
- [x] 9b.47 **Bug 3 — and this is the one that produced the error text.** "Load failed" is WebKit's generic network-failure message, and on Linux this app runs WebKitGTK. A `POST` with `content-type: application/json` plus an `Authorization` header triggers a CORS preflight; `api.cloudflare.com` does not answer preflight for browser origins, so **the request never left the renderer**. My probe reported that as "could not reach the endpoint" — indistinguishable from a dead host, and wrong: the endpoint was fine, the transport was not.
- [x] 9b.48 **Fix: `commands/daqe_probe.rs`.** The decision HTTP moved to Rust, where CORS does not exist and where every other paid AI call in this repo already happens. Endpoint assembly lives there too, so the frontend cannot invent a URL — which is what made bug 1 possible. `resolve_url` handles Workers AI's path form, refuses to double-append a fully-specified override, and requires an account id rather than emitting `/accounts/` with nothing after it.
- [x] 9b.49 `classify_transport` distinguishes timeout from connect from request, so "wrong address" and "too slow" stop reading identically. It takes the three signals rather than a `reqwest::Error`, which is both testable and the reason the original wording could not distinguish anything.
- [x] 9b.50 The picker prefers the backend route and falls back to a direct call only when there is no backend, so a browser build reports an environment limit rather than blaming the reader's credential.
- [x] 9b.51 18 Rust tests: every provider's URL, the Clef body-name stripping, the no-`model` field for a local server, the status→reason mapping, the transport classification, and the wire-name round trip.
- [x] 9b.52 **`daqeNamingGuard.test.ts`.** Three separate build sessions produced pairs of identifiers that render identically and differ by one letter — `Daque`/`Daqe`/`daqe`. The compiler caught each one, but only after the mistake and with a "Did you mean X?" pointing at an identically-spelled name. The guard now fails the build on any two exports that differ by case or one inserted letter, and on any `Daque` prefix, so the class of bug cannot merge.

## 10. Verification

- [x] 10.1 `cargo test` and `npm run test` green. **Verified:** `cargo test --lib` 1501 passed / 0 failed; `npx vitest run` 5994 passed / 2 failed. **Known pre-existing issues, each verified failing with these changes stashed and not DAQE's to fix:** `audioEditionIntegration` and `queueActions` (TypeScript), and `plethora_auth::refresh::tests::refresh_maps_session_revoked_to_typed_error` (fails when run in isolation, passes in the full `cargo test` run). **Known pre-existing issues, verified with these changes stashed and not DAQE's to fix.** The perf gate in particular has several *unstable* benchmarks on this machine whose measured cost swings past their tolerance, so which ones fail alternates run to run: `ankiImport/convert-2000-notes` (RMSE 12.25% on a clean tree, swinging 0.88 to 9.30), `audioEdition/recent-passage-30s-window-10k`, `kp-timeline/sample-sweep-phone`, `precision-scheduler/review-sequence`. None touch DAQE files, and both DAQE baselines pass consistently (1.05-1.09x). These need re-recording by whoever owns them; re-recording from here would mask a real problem. `plethora_auth::refresh::tests::refresh_maps_session_revoked_to_typed_error` fails when run in isolation (`cargo test --lib plethora_auth::refresh`) but passes in the full `cargo test` run — a test-ordering/shared-state issue that predates this work. `kp-timeline/sample-sweep-phone` fails `bench:check` at ~1.27x
- [x] 10.2 **Verified.** Both DAQE baselines PASS consistently (1.05x and 1.00x across three runs). Exactly one benchmark fails per run, and *which one alternates*: `precision-scheduler/review-sequence` failed at 1.27x in one run and passed at 1.07x in the next; `kp-timeline/sample-sweep-phone` did the reverse (1.23x pass, then 1.25x fail). Both were confirmed failing on a stashed tree — `precision-scheduler` measures *worse* without these changes (1.35x) — so neither is a DAQE regression. Both sit on their tolerance boundary on this machine and need re-recording, which is pre-existing maintenance outside this change
- [x] 10.3 `openspec validate add-dynamic-adaptive-queue-engine --strict` clean
- [ ] 10.4 Manual: energy sweep 1→5 visibly reorders; interleave knob 0→1 pushes a repeated topic down; AFK timeout set to 15 s, walk away, return, notice appears and dwell excludes the gap. **NOT DONE — needs a running app.** The knob panel IS now mounted in the Review Queue toolbar (`ReviewQueueView.tsx`, reachable via the slider toggle next to the preset dropdown) and every change re-ranks through `applyRankSnapshot`. Each behaviour has unit coverage (ranker `energy_fit`, `orderRankedScrollItems`, `useActiveTimeTracker.dwell`), but none substitutes for watching it happen
- [ ] 10.5 Manual: select each of the four DAQE presets, confirm knobs, order, and description; adjust one knob and confirm attribution clears. **NOT DONE — needs a running app.** `detectActivePreset` is unit-tested for exact-match and diverged attribution, the six locales carry the strings, and the panel is mounted in the Review Queue toolbar. Only the observed behaviour is unverified
- [ ] 10.6 Manual: disable the decision model entirely and confirm ordering still valid; enable a remote provider with `allowRemoteDecisionModel = false` and confirm no outbound request. **NOT DONE — needs a running app.** `buildRemoteDecisionPayload` is unit-tested to refuse when the opt-in is off, and the ranker is tested with no provider registered, but no real network call was observed
- [ ] 10.7 Manual on macOS, Windows, Linux. **NOT DONE — needs the three platforms.** Verified and documented rather than assumed: the *engine* is platform-agnostic (`rank_queue` is a registered Tauri command available to every target, and `useReadingSessionTracker` — which carries the dwell telemetry — is shared by the desktop and mobile viewers), but the *surfaces* are desktop-only. `MobileQueueView` renders neither `DaqeKnobPanel` nor `DaqeDecisionModelSettings` and has no Customize Session dialog at all, so on mobile a user gets the deterministic fallback ordering and no way to change it. The settings side (`SmartQueuesSettings`) is reachable on mobile, which is where the remote opt-in currently lives