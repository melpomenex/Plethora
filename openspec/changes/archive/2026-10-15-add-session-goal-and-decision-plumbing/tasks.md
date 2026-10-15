## 1. Settings: persist the goal and its history

- [x] 1.1 Add `sessionGoal: string` and `recentGoals: string[]` to the `DaqeSettings` interface in `src/stores/settingsStore.ts`, with defaults `""` and `[]`, and verify existing persisted localStorage state loads without migration errors
- [x] 1.2 Add a commit helper that trims the goal, refuses a value over the configured max length instead of truncating it, treats a whitespace-only value as no goal, and prepends the goal to `recentGoals` deduped case-insensitively and capped at 5 most-recent-first; verify with vitest unit tests covering trim, refuse-not-truncate, whitespace-only, dedupe and cap
- [x] 1.3 Confirm no migration is needed by running the settings store's existing tests plus `npm run test:run src/stores` and verifying a pre-existing persisted settings blob still reads `sessionGoal` as empty

## 2. Tauri bridge: carry the goal, focus tags and provider config

- [x] 2.1 Add `goal: Option<String>` and `focus_tags: Option<Vec<String>>` parameters to `rank_queue` in `src-tauri/src/commands/queue_daqe.rs`, thread `goal` into `RankContext.goal` in place of the hard-coded `None` at line 119, and verify with a Rust test asserting the context receives the supplied goal and that absence stays `None` rather than `Some("")`
- [x] Define `DecisionConfig` in `src-tauri/src/commands/daqe_probe.rs` next to `DecisionProvider` (provider id, base url, model, cloudflare account id, remote opt-in boolean, timeout, `deny_unknown_fields`) and deliberately no API key field. It rides the **second-pass** command rather than `rank_queue`: design D5 keeps `rank_queue` synchronous inside the 150 ms budget, so a provider-config parameter there would have had no consumer. Verified by serde tests that the camelCase round-trip works and that a payload carrying `apiKey` is rejected outright rather than silently dropped
- [x] 2.3 Extend `rankQueue` in `src/stores/daqeRankingClient.ts` to send `goal`, `focusTags` and `decision`, and update the payload assertion at `src/stores/__tests__/daqeRankingClient.test.ts:77` to cover the new fields without loosening the existing `knobs` and `modelInputs` assertions
- [x] 2.4 Run `cargo check` in `src-tauri/` and verify zero errors, then run `npm run test:run src/stores/__tests__/daqeRankingClient.test.ts` and verify it passes

## 3. Local lexical goal alignment (Rust)

- [x] 3.1 Create `src-tauri/src/algorithms/daqe/goal_alignment.rs` with a deterministic scorer producing a value in `[0,1]` from the goal statement against an item's title, tags and text, and returning `None` when there is no goal or no comparable content
- [x] 3.2 Write Rust tests for that module: identical input gives an identical score, a goal matching an item's tags outscores one that does not, an empty goal returns `None`, the result is always within `[0,1]`, and the scorer is monotonic in the number of matched tokens
- [x] 3.3 Add `local_goal_alignment: Option<f64>` to `ItemSignals` in `algorithms/daqe/terms.rs` and populate it from `collect_signals` in `queue_daqe.rs` only when a goal is present; verify with a test that no goal leaves the field `None` and that `collect_signals` does no work in that case

## 4. Make the goal-relevance term consume the goal

- [x] 4.1 Change `goal_relevance` to take `&RankContext` and resolve its input in three tiers — provider verdict (`goal_alignment`), then local lexical (`local_goal_alignment`), then `TermValue::unavailable()` — reporting the local tier with `defaulted: true`
- [x] 4.2 Add `goal_alignment: Option<f64>` to `ItemSignals` as a field **separate** from `relevance`, keeping the existing DB-relevance blend and its weight redistribution untouched — merging them would both fork `relevance.rs` and make the breakdown unattributable. Neither the Rust nor the TypeScript `TermBreakdown` needed a new field: `TermValue { value, available, defaulted }` and `snapshot.ts::termStatus` already carry the tier, which is why design D3 said "without a new concept". Verified by tests that a provider verdict reads as `measured`, a local score as `defaulted`, and an absent signal as `untracked`, each surviving projection into the queue store
- [x] 4.3 Write Rust tests proving a changed goal changes the goal-relevance score and the resulting order, that no goal yields `available == false` rather than a zero, that an identical goal and pool yield an identical order, and that the existing `ranker.rs:495` and `terms.rs:441` tests still pass unchanged
- [x] 4.4 Run `cargo test` in `src-tauri/` and verify the `ranker.rs` top-ten ≤150 ms test, the linear-scaling test and the fallback-path test all still pass with the goal unset

## 5. Session Goal field in the Customize Session modal

- [x] 5.1 Add a `Session Goal` text field inside the DAQE section of `SessionCustomizeModal.tsx`, below the enable toggle and above `DaqeKnobPanel`, using only defined tokens (`border-border`, `bg-background`, `text-foreground`, `ring-primary`) and the modal's existing section-header pattern
- [x] 5.2 Bind the field to `settings.daqe.sessionGoal` via `updateSettingsCategory("daqe", …)` in the same shape as `setDaqueKnobs`, so it persists on change and stays out of `SessionCustomization`; verify the field reloads with its saved value after the modal is closed and reopened
- [x] 5.3 Add the quick-select chip row from `recentGoals`, rendering nothing when the list is empty, using the modal's existing pill class string; verify a chip click sets the field and that at most 5 chips render
- [x] 5.4 Add a placeholder and the helper microcopy explaining that the objective is what decision models rank against, both sourced from the locale files
- [x] 5.5 Confirm the field inherits the `daqeEnabled` gate and does not render when adaptive ranking is off, and confirm the dialog still scrolls without clipping the lower ranking sliders — verify with a viewport screenshot at the dialog's `max-h-[90vh]`
- [x] 5.6 Run `npm run test:run src/components/review/__tests__/ReviewQueueView.test.tsx` and verify the existing test that locates the modal via `.closest(".fixed")` and clicks `Apply Customization` still passes

## 6. Reset and re-rank wiring

- [x] 6.1 Replace the inline `onChange(DEFAULT_CUSTOMIZATION)` on `Reset to Defaults` with an explicit `handleReset` that also clears `settings.daqe.sessionGoal` while leaving `recentGoals` untouched, and verify `DEFAULT_CUSTOMIZATION` is still only spread and never mutated
- [x] 6.2 Read the goal from `useSettingsStore.getState()` in `onScheduleRerank` in `ReviewQueueView.tsx` for the same stale-closure reason the knobs already are, and pass `focusTags` from `customization.filters.tags`
- [x] 6.3 Verify the existing `daqeRankingClient.test.ts:230` "ranking never widens session membership" test still passes after a goal change, and add a case asserting a goal change alters order without altering membership

## 7. Share the provider transport with the ranking path

- [x] Extract the provider identity into a private `ProviderEndpoint` and give `resolve_url` (probe) and `resolve_provider_url` (ranking) two thin entry points over **one** copy of the match arms, so Clef's Workers AI path cannot drift between them. `key_slot` and `unwrap_envelope` are reused directly. A `From<&DecisionConfig> for DaqeHttpRequest` impl was rejected during implementation: it would have forced the ranking path to reuse `build_body`, i.e. the probe's `state`/`questions` payload shape. Verified all 21 pre-existing `daqe_probe.rs` tests still pass unchanged
- [x] 7.2 Add a test asserting the probe and the ranking path resolve the same URL for every provider id, including Clef's Workers AI `ai/run` path and the OpenAI `/v1/decisions` path
- [x] 7.3 Resolve the provider credential from `AIKeyStore` via the existing `key_slot` at call time, never from settings, and verify by test that `DecisionConfig` cannot carry a secret and that no secret appears in the settings store

## 8. Opt-in second-pass provider ranking

- [x] 8.1 Build a `ProviderRegistry` at ranking time from `DecisionConfig` and instantiate a production provider implementing `DecisionModelProvider` for `jev`, `clef`, `openrouter-decisions`, `openai-decisions` and `system-one`; verify with a test that a configured provider is reachable from the ranking path and not only from the probe
- [x] 8.2 Pass the goal statement and `focusTags` into `evaluate_score` as `GoalContext`, and verify with a test that a changed goal produces a recomputed judgement rather than a cache hit
- [x] 8.3 Enforce the remote opt-in on the ranking path before building any outbound payload, and verify with a test that ranking with the opt-in absent issues no request, and that having run a probe does not imply consent to ranking
- [x] 8.4 Keep phase 2 in a separate command from `rank_queue`, bounded by the registry timeout, evaluating only the top 20 phase-1 candidates, with failure counted once per pass; verify with tests for timeout, skip-after-failure, out-of-range verdict rejection and recovery
- [x] 8.5 Debounce the phase-2 trigger by ~400 ms after the last change to goal, knobs or provider config, and verify with a test that a burst of knob drags triggers exactly one phase-2 pass
- [x] 8.6 Confirm the outgoing payload carries the goal and the item's structural outline only — never body text, title verbatim or tags — and verify with a test that captures the serialized request body
- [x] 8.7 Instantiate `DaqeModelCacheRepository` for content-derived judgements (tier, complexity, readiness) while keeping goal-dependent judgements out of the cache; verify with tests for cache hit on repeat evaluation, invalidation on content change, and rubric-version isolation

## 9. Localization

- [x] 9.1 Add the Session Goal label, placeholder, microcopy, chip-list affordance and reset-related string to `src/lib/i18n/locales/en.ts`
- [x] 9.2 Mirror every new key into `de.ts`, `es.ts`, `fr.ts`, `ja.ts` and `zh.ts` at the corresponding `sessionCustomize` block in each
- [x] 9.3 Run the i18n audit tests and `npm run test:run` on the locale suites, verifying no key falls back to a raw translation string in any locale

## 10. Gates and regression sweep

- [x] 10.1 Run `npm run test:run` over `src/__tests__/queueViewControls.test.ts` and `src/__tests__/queueSettingsConsolidation.test.ts` and verify the modal source assertions still hold
- [x] 10.2 Run `npm run test:run` over the full DAQE suite — `src/lib/daqe/*.test.ts`, `src/stores/__tests__/daqeRankingClient.test.ts`, `src/__tests__/daqeConnectionTest.test.ts` — and verify all pass
- [x] 10.3 Run `cargo test` in `src-tauri/` for `algorithms::daqe`, `commands::queue_daqe`, `commands::daqe_probe` and `models::daqe`, verifying zero failures
- [x] 10.4 Run `npm run build:check` and verify `tsc` is clean and the bundle budget passes
- [x] 10.5 Run `npm run bench:check` and verify against `scripts/perf-baselines.json`; if `goal_alignment` measurably changes snapshot projection cost, update the baselines in the same change with the reason recorded, per `AGENTS.md`
- [x] 10.6 Verified in a real browser (Playwright + Chromium) against the real stores, via a throwaway harness that was removed afterwards. Measured: the field renders when `rankingEnabled` is on and is absent when off (`fieldCount` 1 vs 0, no page errors); the dialog is scrollable and after scrolling to the bottom all 10 range inputs including the last ranking slider remain inside the scroll region with the sticky footer visible (`lastVisible: true`); typing "Eigenvalues & Spectral Theory" and blurring stores it and prepends it to `recentGoals`; and a 260-character goal is refused with the previous goal kept, `aria-invalid="true"` and "That goal is too long — keep it under 200 characters." The full Tauri app cannot boot in a plain browser, so this mounted the modal directly rather than through the Queue view