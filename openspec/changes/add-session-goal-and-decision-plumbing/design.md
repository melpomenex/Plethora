## Context

Three seams below the UI are open, and this is the constraint that shapes everything below.
The goal must cross all three, and they have very different cost profiles.

The ranker is Rust and is **latency-gated**: `algorithms/daqe/ranker.rs:899` asserts top-ten
over a 5 000-item pool completes in ≤150 ms, with a companion test for the fallback path and a
linear-not-quadratic scaling test. Everything in the ranking pass is synchronous arithmetic.

The provider layer is not. `ProviderRegistry::DEFAULT_TIMEOUT_MS` is 8 000 ms — two orders of
magnitude past that budget. So the transport and the ranking pass cannot be the same call.

Also relevant to the frontend work, established by reading the existing code:

- `SessionCustomizeModal` holds **zero local state**. Every keystroke calls `props.onChange`
  straight into `ReviewQueueView`'s `useState`. DAQE state is the deliberate exception: the modal
  writes knobs and presets directly into `settings.daqe` via `updateSettingsCategory`, and
  `onScheduleRerank` re-reads them from the store (`useSettingsStore.getState()`) rather than
  from the render closure, with a comment saying exactly why.
- `Apply Customization` and `Cancel` are currently the **same function** — both
  `setCustomizeModalOpen(false)`. There is no draft/commit split, and there is no `invoke` on
  the Apply path. The only Tauri call the modal can trigger is `onScheduleRerank`.
- `Reset to Defaults` is `onChange(DEFAULT_CUSTOMIZATION)` inline, where `DEFAULT_CUSTOMIZATION`
  is a shared module-level object handed by reference.
- `Goal relevance` is not a slider defined in this modal. It is the second entry of the
  `DAQE_KNOBS` data array (`lib/daqe/knobs.ts`), rendered by `DaqeKnobPanel`.

Existing constraints to respect, from `AGENTS.md` and the test suite: `npm run bench:check`
gates `src/**/*.bench.ts` against `scripts/perf-baselines.json`, and an intentional perf change
must update that file with a reason. `queueViewControls.test.ts` and
`queueSettingsConsolidation.test.ts` assert on the modal's **source text**, and
`ReviewQueueView.test.tsx` locates the modal via `.closest(".fixed")`.

## Goals / Non-Goals

**Goals:**

- One goal string, one source of truth, flowing UI → settings → `rank_queue` payload →
  `RankContext.goal` → goal-relevance term.
- The term derives a real normalized score with **no provider configured**, so the feature is
  useful offline and the slider is never dead.
- The provider path is additive: with no provider configured, ranking cost and output are
  byte-identical to today.
- The 150 ms budget is preserved by construction, not by hope.

**Non-Goals:**

- Not changing the five-term composite formula, the term count, or the `adaptive-queue-ranking`
  spec. `goal_relevance` keeps its existing normalization contract (`[0,1]`, `unavailable`
  rather than fabricated); only the *source* of its input changes.
- Not building an ARIA combobox. There is no combobox primitive, no `<datalist>`, and no
  `role="combobox"` anywhere in `src`. One is a separate change.
- Not instantiating `algorithms/daqe/learning.rs` or wiring the energy downshift, both of which
  are also scaffold-only. They are not on this path.
- Not touching the knobs' existing styling defects (below), except where the goal field shares
  the affected code.

## Decisions

### D1 — The goal lives in `settings.daqe`, written directly from the modal

`SessionCustomization` gets no new field. The modal writes `sessionGoal` into `settings.daqe`
via `updateSettingsCategory("daqe", …)`, exactly as `setDaqueKnobs` does, and
`onScheduleRerank` reads it back from `useSettingsStore.getState()` for the same reason the
knobs do — a stale render closure must not re-rank with the previous value.

*Alternative rejected:* adding `sessionGoal` to `SessionCustomization`. That would make the goal
transient like duration and max-items, which loses it on unmount while ranking still reads it on
every re-rank — and it would give the field two homes (`sessionCustomization` and `settings`),
which is how `itemTypes` already ended up with a `sessionItemTypesCustomized` flag to paper over
being persisted from two places.

### D2 — Two names, deliberately: `sessionGoal` in settings, `goal` on the wire

TS settings key is `sessionGoal` (the `session` prefix distinguishes it from other DAQE state in
the same block). The `rank_queue` payload field is `goal`, because Tauri auto-converts
camelCase to the Rust snake_case parameter and `RankContext.goal` is the established name — as
are `DaqeDecisionInput.goal` and `GoalContext.statement`. Introducing `session_goal` at the
boundary would mean renaming a Rust field that already exists.

### D3 — `goal_relevance` resolves its input from three tiers, and `defaulted` reports which

`goal_relevance` currently reads only `ItemSignals.relevance`, which
`repo.daqe_relevance` fills from a **tag-affinity-only** call. Two new inputs, both on
`ItemSignals`:

- `goal_alignment: Option<f64>` — the provider's verdict for this item.
- `local_goal_alignment: Option<f64>` — computed locally from the goal and the item's own text.

Resolution order: provider verdict → local lexical → `TermValue::unavailable()`. The local tier
is reported with `defaulted: true`, which the `TermValue { value, available, defaulted }` struct
and the energy-fit term's existing "measured vs defaulted" tests already model, so the UI can
distinguish "a model judged this" from "this was derived locally" without a new concept.

Keeping the two in **separate fields** rather than merging them into `relevance` is the load-
bearing part. `relevance` is a four-signal blend owned by `algorithms/relevance.rs` with weight
redistribution, and `terms.rs` carries an explicit comment warning that re-deriving any of it
there "would fork the scoring and let the two drift." Overwriting `relevance` with a goal score
would also make the breakdown unattributable, which the ranker's inspectability requirement
forbids. Two fields keeps the term explainable: the UI can say whether goal alignment came from
the model or from lexical overlap.

No existing test regresses: `ranker.rs:495` drives the term from `ItemSignals.relevance` under
`RankContext::bare()` (goal `None`), and `terms.rs:441` asserts unavailability for signals with
no relevance — both still hold, because with no goal there is no local tier either.

### D4 — The local lexical alignment is Rust, in a new small module

A self-contained scorer under `algorithms/daqe/` (`goal_alignment.rs`): token overlap between the
goal statement and the item's title, tags and text, normalized to `[0,1]`, deterministic, no I/O.
Called from `collect_signals`, which already holds the candidate pool.

*Alternatives rejected.* (a) Reuse `src/utils/semanticRelations.ts::scoreFocalTopic` — it is the
same idea, but it is TypeScript, and calling it from the Rust ranking pass would mean a Tauri
round-trip per item. (b) Extend `algorithms/relevance.rs` — that module's redistribution
contract is about DB-derived signals, not goal text; folding goal overlap in would change what
`relevance` means for every other caller. (c) Compute it in TypeScript and ship it via
`ModelInput` — this puts ranking arithmetic on the UI thread for the whole pool, and contradicts
the existing comment at `queue_daqe.rs:166` ("Relevance is Rust's to compute (design D2)").

### D5 — Two-phase ranking: the composite stays synchronous, the provider is an opt-in second pass

This is the decision that keeps the 150 ms budget honest.

**Phase 1** is today's path, unchanged: `build_snapshot` → `collect_signals` (local tiers only)
→ `rank_with_top_n` → publish. No provider is contacted. Cost identical to today.

**Phase 2** is opt-in and fires only when a provider is configured *and* reachable *and* the
remote opt-in permits it. It consults the provider for the top **N = 20** candidates from phase
1 only — not the pool — then re-orders and publishes a second snapshot. It can only change
**order**, never membership, which is what keeps the existing
`daqeRankingClient.test.ts:230` "ranking never widens session membership" guarantee intact even
though phase 2 is asynchronous.

N = 20 is bounded deliberately: it is the region where a model judgement can plausibly change what
the user sees next, and it is small enough that one bounded round of concurrent calls stays inside
the provider timeout rather than scaling with pool size.

*Alternative rejected:* evaluating the provider for all candidates before ranking. It would make
every re-rank take seconds and fail the budget outright, and it would make the queue unusable
whenever the provider is slow — the exact failure mode the bounded-failure requirement exists to
prevent. *Second alternative rejected:* a separate background job that re-ranks on its own
schedule. It needs a lifecycle and a cancellation story for a modal-driven interaction, and it
would reorder a queue the user is not currently looking at.

Debounce: phase 2 does not fire on every keystroke. It fires once, ~400 ms after the last change
to goal, knobs or provider config.

### D6 — Provider config rides the `rank_queue` payload; the secret never does

There is no Rust mirror of the settings store — settings are TS-owned and persisted to
localStorage, so a second Rust copy would be a second source of truth that drifts. The payload
therefore gains a `decision: Option<DecisionConfig>` block carrying provider id, base url, model,
cloudflare account id, the remote opt-in boolean, and the timeout.

`DecisionConfig` carries **no API key**. `daqe_probe.rs:243-249` already resolves the credential
from `AIKeyStore` via `key_slot(provider)`, and the settings store already persists only the
boolean `decisionApiKeySet`. The ranking path reuses that, which is what satisfies the
keychain requirement without a new mechanism.

`focusTags` also rides the payload, sourced from the modal's existing `filters.tags` — the only
existing expression of "tags the user has focused this session", and the natural source for
`GoalContext.focus_tags`.

### D7 — Extract, do not re-derive, the provider transport

`resolve_url`, `build_body`, `unwrap_envelope` and `key_slot` currently take `&DaqeHttpRequest`,
a `#[tauri::command]`-adjacent DTO. Add `impl From<&DecisionConfig> for DaqeHttpRequest` in
`daqe_probe.rs` so both paths call the **same functions**. That is a type conversion with no
behavior change.

*Alternative rejected:* a second `resolve_url` for the ranking path. The Clef case is the reason
this matters — it is the only provider that is not System One and the only one that puts the model
in the path, and it already has 18 tests around its resolution. A second copy would be the
guaranteed-drift case, and the spec requires the two paths to agree on the endpoint.

### D8 — Quick-select chips: recent goals only, hand-rolled in the modal's own idiom

`recentGoals` in `settings.daqe`, capped at 5, most-recent-first, deduped case-insensitively on
commit. No derivation from tags, categories or notebook names — inventing suggestions is
explicitly out of scope, and `availableTags`/`availableCategories` shrink with the loaded queue,
so derived chips would appear and vanish.

Chips and input are hand-written in the modal's existing class idiom (the pill string at
`SessionCustomizeModal.tsx:320-324` and the section header pattern at 310-313), **not** the `md3`
primitives. `md3/Chip` and `md3/TextField` exist and are good, but their variants are tuned to
md3 tokens, and this dialog is built from raw semantic tokens — importing md3 would put two
visual languages inside one dialog. Reuse the class strings, not the components.

Placement: inside the DAQE section, below the enable toggle and above `DaqeKnobPanel`. The DAQE
section is gated on `daqeEnabled`, so the field inherits that gate and does not appear when
ranking is off. No new scroll container — the dialog is already `max-h-[90vh] overflow-auto` with
sticky header and footer, and this grows content inside the existing one.

### D9 — Reset gets an explicit handler

`Reset to Defaults` must now also clear `settings.daqe.sessionGoal`, because the goal is not in
`DEFAULT_CUSTOMIZATION` and the existing one-liner cannot reach it. It adds a `handleReset` that
calls both. `recentGoals` is deliberately untouched — it is a record of past sessions, not
current configuration.

`DEFAULT_CUSTOMIZATION` is a shared module-level object passed by reference; the reset path must
keep using immutable spreads and must not mutate it.

## Risks / Trade-offs

- **Phase 2 makes the queue reorder after the user has already read it.** → Confine phase 2 to
  order only, never membership; debounce so a burst of knob drags yields one re-rank; and keep
  phase 1 publishing immediately so the queue is never empty or waiting.
- **`goal_alignment` reaching the UI is a new field in every breakdown.** →
  `lib/daqe/snapshot.ts::TermBreakdown` and the Rust `TermBreakdown` must move together;
  `snapshot.ts.test.ts` and `models/daqe.rs` tests both cover these structs.
- **A network-capable provider inside the ranking path can stall Tauri.** → Phase 2 is a
  separate command, not a phase of `rank_queue`; it carries the registry's own bounded timeout;
  failure is counted once per pass and recorded, never retried per item.
- **Lexical alignment is crude and will occasionally rank badly.** → It only runs when no
  provider is configured, is marked `defaulted` so the UI can label it as derived rather than
  measured, and the term stays `unavailable` (not zero) when there is nothing to score.
- **`daqeRankingClient.test.ts:77` asserts the exact `rank_queue` payload and will fail** when
  `goal` and `decision` are added. Update it deliberately rather than loosening the assertion.
- **Source-text tests on the modal may trip.** `queueViewControls.test.ts` asserts the modal
  source contains none of `blockTimeBudgets`, `maintenanceBlock`, `explorationBlock`,
  `overdueRescue`, `focusBlock`; `queueSettingsConsolidation.test.ts` asserts the modal does not
  pass `activePreset=`. Neither should be affected, but they are the first thing to run.
- **Pre-existing styling defects in the touched section.** `DaqeKnobPanel` uses
  `accent-[var(--color-accent)]` and `border-accent`/`bg-accent/10`, but `--color-accent` is
  never defined in `index.css` `@theme` and `ThemeContext.applyThemeToDOM` never sets it, so
  those resolve to nothing; and `index.css:360-363` sets `background-color:
  var(--color-background) !important` on every `input`, which defeats the knob fill gradient
  entirely. → Out of scope to fix wholesale, but the new goal field uses only defined tokens
  (`border-border`, `bg-background`, `text-foreground`, `ring-primary`) so it is unaffected. File
  the knob defect separately; do not bundle it here.
- **`npm run bench:check` may flag a change.** Adding `goal_alignment` to every breakdown widens
  the object projected per visible item. → Run the gate; if it moves, update
  `scripts/perf-baselines.json` with the reason, per `AGENTS.md`. Do not widen the tolerance.

## Migration Plan

No database migration. The settings store is TS-owned localStorage with its own defaulting, so
`sessionGoal` and `recentGoals` are added as defaulted fields on `DaqeSettings` and existing
persisted state simply reads them as empty. The `daqe_model_cache` table already exists
(`migrations.rs:4795` constrains its content hash) — D5 instantiates its repository for the first
time; it is a new reader/writer of an existing table, not a new table.

Rollback: revert the frontend field and the payload fields. `goal_alignment` is additive and
`Option`, so a snapshot written by the new code still deserializes under the old one with the
extra fields ignored.

## Open Questions

- Whether the UI should surface `local_goal_alignment` distinctly in the existing breakdown
  tooltip now that `defaulted` carries it. Display-only; does not change the specs, the approach,
  or the task breakdown.
- Whether the recent-goals cap should be 5 or higher, and whether an explicit "clear history"
  affordance is wanted. Both are tuning within a spec that only requires a bound.