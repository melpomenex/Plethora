## Context

Incrementum's SM-20 path already evaluates five competitors on every review: SM-2, SM-15, SM-19, SM-20, and FSRS. It stores adaptive weights and exposes aggregate weights, losses, and the R-Metric through `get_sm20_arena_stats`. The active review UI only shows the blended interval, and `ReviewTransparencyPanel` renders the weights as a dense sentence. `reviewStore.submitRating` optimistically removes the card and advances before `submit_review` finishes, so there is currently no point at which a user can inspect and confirm the five proposed schedules.

The reference SuperMemo dialog proves that the data can support interval choice, but it also exposes the problems this design must avoid: a rainbow heatmap without semantic meaning, tiny overlapping markers, multiple disconnected action rows, ambiguous "used" versus "selected" values, and a fixed desktop layout. Incrementum should preserve the informed choice while making the interaction feel native to a fast review session.

This design builds on the existing SM-20 ensemble and the active `fix-sm20-activation` work. It does not invent a second Arena or change the five scheduling models. The canonical surface is the Review tab's flashcard / learning-item session.

Design read: a focused learning-product interaction for serious self-learners, with a cinematic scientific-instrument feel. The visual dials are variance 7, motion 7, and density 5. Motion communicates algorithm divergence and selection state, while the primary action remains reachable immediately.

## Goals / Non-Goals

**Goals:**

- Make each model's proposed next interval understandable at a glance.
- Let the user choose the weighted recommendation, an individual model, or a custom interval without losing the context of the reviewed answer.
- Keep the default path nearly as fast as today's grade-and-advance loop.
- Deliver one interaction model that feels excellent with pointer, keyboard, touch, screen reader, light theme, and dark theme.
- Ensure preview is non-mutating and commit is atomic, auditable, syncable, and safe to retry.
- Preserve the Arena's statistical integrity when the user chooses a schedule other than its recommendation.

**Non-Goals:**

- Reimplementing or retuning SM-2, SM-15, SM-19, SM-20, FSRS, weight adaptation, or the R-Metric.
- Offering the Arena for documents, Queue reading mode, cram reviews, non-SM-20 schedulers, Pure M4 mode, or review widgets outside the canonical Review tab.
- Turning the Review tab into a long-form analytics dashboard.
- Adding a new animation or component library.
- Automatically choosing an interval after a timeout in the normal visual review flow.
- Treating model spread as a statistical confidence interval. The UI calls it the "Arena range" and describes it as the span of current proposals.

## Decisions

### Decision 1: Add an explicit review phase instead of a modal

The review session becomes a small state machine:

```text
question -> answer -> grading -> arena-loading -> arena-ready -> committing -> next-card
                         |              |
                         +-- back -------+
```

`arena-loading` and `arena-ready` exist only when all eligibility rules are true:

- the item is a flashcard / learning item in the Review tab;
- the session is normal scheduled review, not cram;
- the active algorithm is `sm20`;
- Pure M4 is off;
- scheduling updates are enabled.
- the user's Arena review mode is `choose` rather than the default `automatic`.

SM-20 exposes one persistent, explicit choice called **After each rating**. **Automatic** is the recommended default: Arena commits its authoritative weighted recommendation with `schedule_source = arena` and advances without showing the decision stage. **Show the Arena** pauses after each eligible grade and opens the full Memory Horizon. Both modes run and train the same five collection models; the preference changes interaction only, never scheduler capability. The choice is presented as two descriptive radio cards in Learning settings and as a compact two-option control next to the SM-20 rating controls, so it can be understood during setup and changed in context.

The answer remains visible. On desktop, the lower rating region expands across the review workspace into the Arena stage. On mobile, the answer compresses to a scrollable context area above a thumb-reachable Arena stage. This is an in-place state transition, not a dialog or route change. The right transparency rail becomes a collapsible "Why this interval" detail inside the stage while the Arena is active.

The existing optimistic advance is removed for eligible reviews. Session counts, queue removal, feedback celebrations, sync publication, and undo snapshots occur only after commit succeeds. Pressing Escape in `arena-ready` returns to the answer and rating controls without mutating scheduling data. Leaving the Review tab with a pending grade asks whether to discard it.

Alternative considered: submit the grade first, then reschedule after selection. Rejected because a crash or navigation between the two writes could leave the user with an interval they never accepted, and Arena/model state would be advanced twice if a retry were mishandled.

### Decision 2: Use a Memory Horizon rather than a heatmap or card grid

The main visualization is the **Memory Horizon**, a horizontal logarithmic time axis. A log scale keeps hours, days, months, and multi-year proposals legible in the same component:

`x = log(1 + intervalDays) / log(1 + visibleMaxDays)`

Ticks are generated from human units that fall inside the current domain, such as 1 hour, 1 day, 1 week, 1 month, 3 months, 1 year, and 5 years. Labels never expose raw decimal days. Every selectable proposal includes both relative time and the local calendar date.

```text
Choose when this returns                           Good remembered

                         5 years, 11 months
                          18 June 2032
                    Arena Pick - 42% weighted pull

Now        1 month          1 year                         10 years
|-------------|---------------|--------------------------------|
       SM-2         SM-15   SM-19      [ ARENA ]       FSRS  SM-20
                     <---------- Arena range ---------->

Arena Pick   SM-2   SM-15   SM-19   SM-20   FSRS   Custom
[ Schedule for 5 years, 11 months ]
```

The weighted Arena recommendation is preselected and receives the only accent color. Competitors remain neutral and are distinguished by persistent labels, marker shapes, order, and focus state rather than by a rainbow palette. Marker emphasis and a visible percentage communicate weight, but text always carries the exact value. The Arena range spans the minimum and maximum candidate proposals; it is not labeled as confidence.

When markers would overlap, the horizon fans their stems into compact vertical lanes and exposes a combined cluster target. Selecting or focusing the cluster cycles its members, while the textual candidate rail below always gives each model a separate target. This prevents precision tapping from becoming a requirement.

The selected interval is the visual headline. Changing selection moves one vertical "time lens," updates the relative value and due date, and refreshes a short explanation such as "FSRS proposes the latest return" or "Arena Pick blends all five using your current weights." The primary button repeats the exact interval to prevent ambiguity.

Alternative considered: five equal algorithm cards. Rejected because it hides the most meaningful relationship, the distance between the proposed times, and becomes a repetitive horizontal carousel on mobile.

### Decision 3: Preview all native grades on card load and reveal one after grading

The existing SM-20 interval preview already runs the full five-model ensemble for all six native grades. Extend that scratch computation to return raw, finalized competitor intervals rather than running a second expensive pass after the grade.

`PreviewIntervals` gains an optional `arena` payload for SM-20:

```ts
interface SM20ArenaPreviewSet {
  schema_version: 1;
  preview_id: string;
  item_revision: string;
  arena_revision: string;
  generated_at: string;
  model_order: ["sm2", "sm15", "sm19", "sm20", "fsrs"];
  grades: SM20ArenaGradePreview[]; // exactly six, indexed 0-5
}

interface SM20ArenaGradePreview {
  grade: 0 | 1 | 2 | 3 | 4 | 5;
  recommendation: ArenaIntervalChoice;
  candidates: ArenaModelCandidate[];
  range: { min_days: number; max_days: number };
  custom_bounds: { min_days: number; max_days: number };
}

interface ArenaModelCandidate {
  model_id: "sm2" | "sm15" | "sm19" | "sm20" | "fsrs";
  label: string;
  interval_days: number;
  due_at: string;
  weight_percent: number;
  personalized: boolean;
}
```

The backend finalizes each raw slot with the same forgetting-index, lapse, and minimum-growth policy used by the ensemble, with stochastic dispersal disabled. The recommendation is the existing deterministic weighted ensemble result. This makes every displayed value comparable and stable across renders.

The Arena payload is prefetched with the next card's normal interval preview, so grading usually produces an immediate transition. A shape-matched skeleton covers cold storage or slow-device cases. The preview operation clones collection state and MUST NOT update model state, matrices, weights, review history, or due dates.

Alternative considered: call a separate five-candidate endpoint after the user grades. Rejected because it adds visible latency and duplicates work already performed for grade previews.

### Decision 4: Make selection fast, explicit, and difficult to misread

Normal entry behavior:

- The Arena stage opens only when the persistent review mode is **Show the Arena**. Automatic mode commits Arena Pick immediately without presenting a transient chooser.
- Arena Pick is selected by default.
- Enter or Space confirms the selected schedule.
- Left/Right moves through candidates sorted by time.
- Keys 1-5 select the five models in the documented model order.
- `A` selects Arena Pick; `M` enters Custom mode; Escape returns to grading.
- The confirm button always reads `Schedule for <relative interval>`.

The first eligible review shows a compact, non-modal two-step coach mark: first identify Arena Pick as the fast default, then identify the five model alternatives. It never blocks the confirm control, is dismissible, and is not shown again after completion or dismissal.

On touch devices, the candidate rail uses horizontal scroll snap, but all six standard choices remain reachable without precision dragging. A short horizontal swipe advances one candidate. Tapping a marker or rail item selects it. Haptic selection feedback fires only when the selected candidate changes and respects the existing haptic preference.

Custom mode is deliberate rather than accidental. The user first activates `Custom`, then may drag the time lens on the log scale or enter a number and unit. Dragging uses pointer capture and writes a CSS custom property directly to the element between settled values, avoiding React renders on every pointer frame. Haptic ticks occur only when crossing meaningful unit boundaries. The backend-provided minimum and maximum are shown, and the exact calendar date updates before commit.

No normal review auto-confirms after a timeout. Hands-free audio auto-advance is the explicit exception: it commits Arena Pick and announces the chosen interval because stopping on an unspoken visual chooser would break the hands-free contract. The stored source remains `arena`.

### Decision 5: Validate and commit the selected interval atomically

`submit_review` gains optional Arena fields:

```ts
interface ArenaSelection {
  commit_id: string;
  preview_id: string;
  item_revision: string;
  arena_revision: string;
  source: "arena" | "model" | "custom";
  model_id?: "sm2" | "sm15" | "sm19" | "sm20" | "fsrs";
  interval_days?: number; // required only for custom
  decision_time_ms: number;
}
```

At commit, the backend reloads the item and collection state, verifies the item and Arena revisions, and deterministically recomputes the selected grade's candidates. For `arena`, it uses the recomputed recommendation. For `model`, it uses the recomputed candidate identified by `model_id` and ignores any client interval. For `custom`, it requires a finite positive value within the recomputed authoritative bounds.

`commit_id` is generated once when the grade enters the Arena and is reused for every retry. A unique nullable review-result column makes the operation idempotent: if the same commit ID already exists, the backend returns the previously committed outcome instead of grading again.

The backend then applies the grade exactly once, scores the previous review's model predictions, updates the five model states, and persists collection-wide learning. The chosen interval becomes the actual `learning_items.interval` and due date. Any internal "previous interval" fields that represent the schedule actually used are patched to the chosen value. Raw per-model slot predictions remain intact so the next recall outcome can score each competitor fairly.

Arena-active commits use the exact deterministic interval shown to the user and do not add stochastic day dispersal afterward. Direct SM-20 and Pure M4 reviews retain their existing behavior.

The learning rule is intentionally separate from selection preference. Arena weights update from predicted recall versus the observed pass/fail outcome. Choosing FSRS, SM-20, or Custom does not directly reward that choice or alter a weight.

Alternative considered: trust the interval number returned by the UI. Rejected because stale or malformed clients could schedule outside safe bounds or label a custom value as an algorithm proposal.

### Decision 6: Persist compact, exportable decision provenance

Add nullable columns to `review_results` through the next available migration:

- `schedule_source TEXT`: `arena`, `model`, `custom`, or null for legacy/direct reviews;
- `schedule_model_id TEXT`: present only for a model choice;
- `arena_commit_id TEXT`: unique when present, used for idempotent retry;
- `arena_recommended_interval REAL`;
- `arena_decision_time_ms INTEGER`;
- `arena_snapshot TEXT`: versioned JSON containing the five model IDs, intervals, weights, selected grade, revisions, and preview schema version.

`new_interval` remains the authoritative chosen interval. Keeping the snapshot makes the decision auditable and allows later analytics such as preference drift or regret analysis without attempting to reconstruct historical model weights. Old rows remain valid because every new column is nullable.

The same optional fields are added to synced review events, collection archive export/import, and review-results APIs. Older peers ignore unknown fields; newer peers treat absent fields as a legacy direct schedule.

### Decision 7: Treat the simulation as progressive enhancement with full semantic parity

The horizon is visually rich but not the only operable representation. Its semantic core is a radiogroup containing Arena Pick, five algorithms, and Custom. Each option's accessible name includes algorithm, relative interval, exact date, and weight where applicable. Selection changes are announced through a polite live region; commit success uses the existing review feedback system.

Responsive layout rules:

- At 768px and above, the stage spans the review workspace with the answer retained above and explanation details at the right edge of the stage.
- Below 768px, it is a strict single column. The answer occupies at most roughly one third of the dynamic viewport, the candidate rail snap-scrolls, and the Arena body is the sole vertical scroll region. The persistent confirmation dock occupies a reserved flex row above `env(safe-area-inset-bottom)` rather than overlaying the horizon, so selected-trajectory and marker content can never pass beneath the action.
- Every target is at least 44 by 44 CSS pixels. The stage uses `min-height` with dynamic viewport units, never fixed `100vh`.
- Zen mode uses the same decision state and data with reduced chrome, not a separate scheduling path.

Visual rules:

- Use existing semantic theme tokens and current typography. Use the primary theme color only for the current selection and confirm action.
- Use tabular or mono numerals for time values, existing body typography for labels, and Phosphor icons only where an icon improves comprehension.
- Stage surfaces use a consistent 16px radius, controls use 12px, and status labels alone may be pill-shaped.
- Provide light and dark tokens with equivalent hierarchy and WCAG AA contrast. Color is never the only state cue.

Motion rules:

- On entry, all markers begin at Now and travel to their proposals over 320-420ms using transform and opacity. This motion communicates algorithm divergence.
- Selection moves only the time lens and related text. Confirmation collapses the chosen marker into the due-date summary before the next card appears.
- CSS animations are gated by `prefers-reduced-motion`; reduced mode renders final positions immediately. No looping glow, particle, or decorative perpetual animation is used.
- `prefers-reduced-transparency` receives solid surfaces without blur.

No new motion dependency is required. CSS transitions and existing React state are sufficient; continuous pointer position is kept out of React state.

### Decision 8: Failure states never advance or lose the user's grade

If the prefetched Arena data is unavailable, the stage shows a shape-matched skeleton, then either the Arena or an inline error with `Retry`, `Schedule automatically`, and `Back to rating`. `Schedule automatically` commits the normal weighted recommendation without a preview selection and records `schedule_source = arena` plus a fallback marker.

If commit fails, the card, grade, and selection remain pending. The primary button becomes `Retry scheduling`; queue position and session counters remain unchanged. If the preview is stale, the backend returns a typed stale-preview error. The frontend refreshes the candidates, preserves the selected source/model when it still exists, and announces any changed interval before requiring confirmation again.

An app crash or tab close during `arena-ready` leaves no partial review because preview is non-mutating. The card remains due on restart.

## Risks / Trade-offs

- **[Risk] A chooser after every SM-20 grade slows review throughput.** -> Automatic is the recommended default; users deliberately opt into the chooser, and Arena Pick remains preselected with Enter/Space confirmation for that mode.
- **[Risk] Extreme interval spread makes labels collide.** -> Use a logarithmic axis, marker lanes, cluster cycling, and an always-available textual choice rail.
- **[Risk] Users mistake spread for scientific confidence.** -> Call it Arena range, define it as min-to-max proposals, and keep losses/R-Metric in optional details.
- **[Risk] Custom choices weaken scheduler outcomes.** -> Show the Arena recommendation persistently, enforce backend bounds, store provenance, and never train weights from the fact that a user selected a model.
- **[Risk] The two-phase UI increases store complexity.** -> Model review phases explicitly and keep one pending review object keyed to the current card instead of scattering booleans.
- **[Risk] Candidate preview becomes stale across windows or synced changes.** -> Revision validation and deterministic server recomputation prevent committing mislabeled candidates.
- **[Risk] Snapshot JSON increases review-history size.** -> The payload is bounded to five compact candidates and only exists for Arena reviews; keep it versioned and omit presentation strings that can be localized later.
- **[Risk] Mobile motion or dragging causes jank.** -> Animate only transform/opacity, precompute positions, use pointer capture and CSS variables, and test on low-end Android hardware.
- **[Risk] Browser/PWA behavior diverges from Tauri.** -> Keep preview/validation types shared, implement the same deterministic candidate rules in the browser backend, and add parity fixtures.

## Migration Plan

1. Add nullable review-result provenance columns and update export/import/sync types with backward-compatible optional fields.
2. Refactor the SM-20 scratch preview to expose finalized raw candidates for all six grades while pinning current ensemble preview outputs with regression tests.
3. Add validated Arena selection to `submit_review`, preserving the current direct path when the payload is absent.
4. Introduce the review phase state machine and API types behind an internal feature flag; keep the current direct submit path available for rollback.
5. Build the semantic choice list first, then layer the Memory Horizon visualization, motion, touch gestures, and Zen/mobile layouts over it.
6. Add integration, accessibility, sync, stale-preview, and viewport tests. Validate both themes, reduced motion, keyboard-only flow, VoiceOver/TalkBack semantics, and low-end mobile performance.
7. Enable the Arena phase only for eligible SM-20 Review-tab sessions. If rollback is needed, disable the frontend flag; the additive columns and selection-aware backend remain harmless.

## Open Questions

None. The proposal makes automatic Arena scheduling the recommended default while keeping the full informed chooser one persistent, contextual selection away. Hands-free audio always preserves automatic progression even when the visual preference is **Show the Arena**.
