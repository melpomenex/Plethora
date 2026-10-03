## Why

The Customize Session modal exposes a **Goal relevance** ranking slider (`goalRelevance`,
labelled `w_goal` in the composite score) but gives the user no way to say what the goal
actually *is*. The goal-relevance term is therefore driven by tag affinity alone: it never
sees a single character of the user's stated objective, so the weight the user dials in has
no objective to weight against.

The fix is not only a text field. Three seams below the UI are open, and shipping the field
alone would produce a knob that looks load-bearing and changes nothing:

- `RankContext.goal` is declared and documented as *"the user's active goal statement, if
  any"* (`src-tauri/src/algorithms/daqe/mod.rs:109`), but `rank_queue` hard-codes `goal: None`
  (`src-tauri/src/commands/queue_daqe.rs:119`) and **no producer has ever read it**.
- `terms::goal_relevance(signals, _knob_w)` (`src-tauri/src/algorithms/daqe/terms.rs:176`) does
  not take a context at all, so there is no code path by which a goal string could affect a score.
- `DecisionModelProvider` has **zero production implementations** — the only impl is a
  `#[cfg(test)] StubProvider`. The `queue-decision-model` spec already requires a provider
  contract and already has the *Session-dependent judgement is not cached* scenario, but the
  layer that would satisfy them is unreachable from the app.

The user-facing surface is the visible part; the reason to do it now is that the DAQE ranking
panel has shipped with a dead slider, and every further DAQE work inherits that defect.

## What Changes

- **Goal input in the modal.** A Session Goal text field in the Adaptive Ranking section of
  `SessionCustomizeModal`, styled with the modal's existing token classes, with a placeholder,
  helper microcopy, and a quick-select chip row of recently used goals.
- **Persistence.** `settings.daqe` gains `sessionGoal: string` and `recentGoals: string[]`
  (capped, most-recent-first). The goal survives reload because ranking reads it on every
  re-rank — a deliberate exception to the rest of `SessionCustomization`, which is transient.
- **Payload.** `rank_queue` gains `goal: Option<String>`, threaded into `RankContext.goal`
  rather than hard-coded `None`.
- **The term consumes it.** `goal_relevance` gains a goal-aware path: a deterministic lexical
  relevance between the goal statement and the candidate's own text, so the term works with
  no provider configured. The term's existing contract (normalized `[0,1]`, `unavailable`
  rather than fabricated when there is nothing to score) is unchanged.
- **A real provider.** A production `DecisionModelProvider` implementation for the configured
  provider id (`jev` / `clef` / `openrouter-decisions` / `openai-decisions` / `system-one`)
  that reaches `evaluate_score` with the `GoalContext` already declared on the trait. It reuses
  the endpoint assembly in `daqe_probe.rs::resolve_url` and the `AIKeyStore` keychain slot, and
  it instantiates `DaqeModelCacheRepository`, which is registered but never constructed.
- **Reset semantics.** `Reset to Defaults` clears the goal back to empty, which is explicitly
  a real state change rather than an incidental one.

Non-goals: no arrow-key/ARIA combobox widget (there is no combobox primitive in the repo and
building one is a separate change); no change to the five-term composite formula or the
`adaptive-queue-ranking` spec; no provider round-trip inside the 150 ms top-ten budget — the
provider path is opt-in and budget-guarded, with the local lexical term as the always-available
default.

## Capabilities

### New Capabilities

- `session-goal-plumbing`: The explicit session goal as a first-class, persisted user input —
  where it lives in the modal, how it survives reload, how it crosses the Tauri bridge, and how
  the goal-relevance term derives a normalized score from it. Covers the `goalRelevance` slider's
  missing input, not the term's existing normalization contract (that stays with the ranker spec).
- `queue-decision-model`: Adds the production provider implementation and cache activation that
  the existing provider contract requires — goal-aware `evaluateScore`, endpoint resolution
  shared with the probe, keychain credential reuse, the remote opt-in gate on the ranking path
  (not only the probe path), and content-hash caching with session-dependent judgements excluded.

### Modified Capabilities

None. `queue-strategy-persistence` covers the queue *strategy preset*, not session
customization state, and this change does not alter what that preset persists.

## Impact

- **Backend (Rust):** `commands/queue_daqe.rs` (`rank_queue` gains `goal`, `build_snapshot`
  stops hard-coding `None`), `algorithms/daqe/terms.rs` (`goal_relevance` goal-aware path),
  `algorithms/daqe/decision_model/` (new production provider; reuse `resolve_url`, `unwrap_envelope`,
  `build_body` from `commands/daqe_probe.rs` rather than re-deriving them), `database/daqe_model_cache_repository.rs`
  (first real instantiation).
- **Frontend:** `components/review/SessionCustomizeModal.tsx` (field + chips + microcopy +
  reset), `components/review/ReviewQueueView.tsx` (owns the persisted goal, passes it to re-ranking),
  `stores/settingsStore.ts` (`DaqeSettings.sessionGoal` / `.recentGoals`), `stores/daqeRankingClient.ts`
  (`goal` in the `rank_queue` payload), `lib/daqe/` (any new lexical-relevance helper and its
  tests), and all six locale files (`en`/`de`/`es`/`fr`/`ja`/`zh`).
- **Tests:** existing guards to keep green — `src/__tests__/queueViewControls.test.ts` and
  `src/__tests__/queueSettingsConsolidation.test.ts` both assert on the modal's source text, and
  `ReviewQueueView.test.tsx` locates the modal via `.closest(".fixed")` and clicks `Apply Customization`.
- **Perf:** a network-capable provider inside a ranking pass is the one genuine risk to the
  150 ms top-ten budget gated by `algorithms/daqe/ranker.rs`. `npm run bench:check` and
  `scripts/perf-baselines.json` are in scope per the repo's benchmark gate.