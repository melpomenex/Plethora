# Design: Extend DAQE Learning Orchestration

## Context

The existing DAQE implementation (`src-tauri/src/algorithms/daqe/{ranker.rs, terms.rs, goal_alignment.rs}`, `src-tauri/src/commands/queue_daqe.rs`, `src/stores/daqeRankingClient.ts`) is pure, deterministic, non-mutating, and fast (150 ms top-10 budget). It computes a composite score `S(i)` from `TermBreakdown::score()` and preserves `QueueOrderingMode::StrictManual` vs `Adaptive`.

To orchestrate a unified personal learning OS without violating these invariants, we extend DAQE with a **two-stage pure pipeline**:
1. **Candidate Providers** gather bounded, normalized `ActivityCandidate` records across heterogeneous learning sources.
2. **Orchestrator** scores every candidate deterministically using documented normalized `[0, 1]` factors parameterized by a **Session Focus Profile**, applies **Time-Budget Packing**, evaluates **Overload & Deadline Balance**, and emits structured **"Why am I seeing this?"** explanations—all strictly read-only.

## Goals / Non-Goals

- **Goals:**
  - Unify heterogeneous activity selection under one pure, deterministic Rust + TS-mirrored DAQE orchestrator.
  - Preserve `QueueOrderingMode::StrictManual`, `rank_queue`, and the 150 ms top-10 latency budget.
  - Guarantee honest missing-signal semantics (`TermValue::unavailable()`) and deterministic explainability.
  - Provide actionable, non-coercive overload detection and deadline balancing.
- **Non-Goals:**
  - Mutating FSRS-7 review intervals or auto-postponing items without explicit user action.
  - Contacting remote LLMs during the 150 ms first-pass orchestration or for score explanations.
  - Accessing `health/health.db`.

## Architecture & Contracts

### 1. Heterogeneous Candidate Providers

Each provider implements a pure/bounded query contract returning `Vec<ActivityCandidate>` (capped per provider, e.g., `MAX_PER_PROVIDER = 200` before merging) mapped to `LearningActivity`:

| Provider ID | Source Repository / Store | Produced `LearningActivityKind` | Default Inclusion |
|---|---|---|---|
| `srs_due_pool` | `queue::due_candidate_pool` (docs, extracts, flashcards) | `srs_review`, `incremental_read` | Always enabled |
| `learning_goals` | `learning_goal_repository` + `study_plan_repository` | `study_workspace`, `incremental_read` | Enabled when active goals exist |
| `guided_trails` | `study_trail_repository` | `guided_reading` | Enabled when active trails exist |
| `remediation` | `learning_evidence_repository` (`learning_gaps` / `learning_remediations`) | `remediation`, `practice_check` | Enabled when unresolved gaps exist |
| `exam_prep` | `assessment_blueprint_repository` + `exam_session_repository` | `exam_attempt`, `practice_check` | Enabled for scheduled/resumable exams |
| `smart_feeds` | `rss_smart_feeds` / `smartFeedsStore` | `exploration_feed` | Optional exploration only; never creates SRS obligations |

**StrictManual Mode:** When `orderingMode === "strict_manual"`, DAQE bypasses adaptive profile weights and ranks candidates strictly by manual priority descending, then due instant, entity type, and ID—matching `rank_strict_manual` in `ranker.rs`.

### 2. Documented Normalized Scoring Factors

All factors are normalized to `[0.0, 1.0]` and wrapped in `TermValue` (`Measured(v)`, `Defaulted(v)`, or `Unavailable`). Unavailable factors are excluded from both numerator and denominator (honest weight renormalization) rather than fabricated as `0.0`:

| Factor Key | Range | Polarity | Source & Formula |
|---|---|---|---|
| `srs_urgency` | `[0, 1]` | Positive | Existing `terms::srs_urgency` (`0.8 * T + 0.2 * P` using FSRS-7 retrievability `1 - r`, overdue ratio, and canonical priority). |
| `goal_relevance` | `[0, 1]` | Positive | Existing `terms::goal_relevance` (active Learning Goal match, `local_goal_alignment`, cluster boost, or optional second-pass `ModelInput.goal_alignment`). |
| `deadline_pressure` | `[0, 1]` | Positive | Smooth bounded ramp from goal/exam deadline feasibility ratio: `clamp(requiredDailyMinutes / availableDailyMinutes / 1.5, 0, 1)` when a deadline exists; `Unavailable` when no deadline is set. |
| `competency_gap_priority` | `[0, 1]` | Positive | From Phase 1 5D Learner Model: severity of targeted dimension deficit (`comprehension`, `retention`, `application`, `transfer`) for remediation/curriculum items; `Unavailable` for casual items. |
| `energy_fit` | `[0, 1]` | Positive | Existing `terms::energy_fit` comparing item complexity (`1..=5`) against user's manual energy target knob. |
| `exploration_novelty` | `[0, 1]` | Positive | Freshness/unseen score for casual library items and Smart Feeds exploration candidates; `Unavailable` for due SRS reviews. |
| `interleave_penalty` | `[0, 1]` | Negative | Existing `terms::interleave_penalty` penalizing high topic similarity to recently completed activities in the session window. |
| `friction_penalty` | `[0, 1]` | Negative | Existing `terms::friction_penalty` from postponement/skip/abandonment telemetry. |

Composite score `S(i)` is computed solely by `OrchestrationBreakdown::score()` using the active profile's normalized positive/negative weights, with deterministic tie-breakers: `(score DESC, due_at ASC NULLS LAST, kind ASC, activity_id ASC)`. Two runs on identical state MUST be byte-identical.

### 3. Session Focus Profiles

Six built-in profile presets parameterize factor weights and provider soft quotas (minimum/maximum share of session budget):

| Profile ID | Label | Primary Weight Emphasis | Provider Mix Characteristics |
|---|---|---|---|
| `balanced` | Balanced | `srs_urgency` (0.35), `goal_relevance` (0.25), `deadline_pressure` (0.15), `competency_gap_priority` (0.15), `energy_fit` (0.10) | Mixes due SRS, active goal progress, and remediation; caps exploration at 15%. |
| `free_exploration` | Free Exploration | `exploration_novelty` (0.45), `energy_fit` (0.25), `goal_relevance` (0.15), `srs_urgency` (0.15) | Prioritizes unread documents, extracts, and Smart Feeds; zero forced assessments or goals. |
| `memory_retention` | Memory Retention | `srs_urgency` (0.65), `competency_gap_priority` (0.15), `energy_fit` (0.10), `interleave_penalty` (0.10) | Focuses heavily on due/overdue FSRS flashcards and extracts; suppresses new exploration. |
| `exam_prep` | Exam Prep | `deadline_pressure` (0.35), `competency_gap_priority` (0.30), `goal_relevance` (0.20), `srs_urgency` (0.15) | Prioritizes exam blueprints, weak-dimension remediation, and goal-aligned reviews; respects exam isolation. |
| `deep_study` | Deep Study | `goal_relevance` (0.40), `competency_gap_priority` (0.25), `energy_fit` (0.20), `srs_urgency` (0.15) | Favors sustained `guided_reading`, `study_workspace`, and `incremental_read` blocks (15–45 min) with low context-switching. |
| `custom` | Custom | User-configured normalized weights persisted per profile | Respects explicit user knob overrides and provider toggles. |

### 4. Time Budgets (5–120m / Unlimited) & Session Packing

- Supported budgets: explicit integer minutes in `[5, 120]` (quick presets: `5`, `15`, `25`, `45`, `60`, `90`, `120`) or `null` (`unlimited`).
- Each candidate carries a deterministic `estimatedMinutes` (e.g., flashcard micro-batch = `1–5m`, extract = `3m`, guided trail segment = `8–15m`, document reading block = `10–20m`, exam attempt = blueprint duration).
- **Greedy Budget Packer:**
  1. Iterates candidates in ranked order, enforcing `dedupeKey` uniqueness and profile provider caps.
  2. Accepts candidate if `accumulatedMinutes + candidate.estimatedMinutes <= budgetMinutes` (or always if `unlimited`).
  3. Always includes at least 1 top candidate if the pool is non-empty and the smallest eligible item exceeds a tiny budget (e.g., 5m budget with a 10m document), annotating the session with `budgetOverflowMinutes` so the user is informed honestly.
  4. Re-applies lightweight interleaving diversity across selected slots so consecutive items do not cluster redundantly unless in `deep_study`.

### 5. Overload Advisor & Deadline Balancing

The pure `evaluate_overload(pool_stats, goals, budget_minutes)` analyzer runs deterministically alongside ranking:

- **Triggers:**
  - `srs_backlog_overload`: Due SRS minutes exceed `2.0x` the user's rolling 7-day average daily study time (or `> 90 min` due with no history).
  - `deadline_crunch`: One or more active Learning Goals have `deadlineFeasibility === "at_risk" | "infeasible"`.
  - `budget_mismatch`: Requested session time budget is `< 25%` of urgent due + deadline work.
- **Non-Coercive Relief Options (Advisory Only):**
  - `focus_retention_triage`: Switch this session to `memory_retention` capped to the chosen time budget.
  - `pause_new_introductions`: Exclude new/exploration items for this session only (does not alter FSRS settings).
  - `focus_single_deadline`: Filter session scope to the most urgent goal.
  - `keep_as_is`: Dismiss advisor for the current session.
- **Deadline Balancing:** When both overdue SRS and an approaching goal deadline compete under `balanced`, DAQE reserves at least 30% of the budget for critical FSRS retention (`retrievability < 0.75`) so exam crunch does not silently destroy long-term memory, while `exam_prep` explicitly allows the user to prioritize deadline readiness.

### 6. Deterministic "Why am I seeing this?" Explainability

Every ranked activity carries a structured `ActivityExplanation`:

```ts
export interface ActivityExplanation {
  providerId: string;
  profileId: string;
  orderingMode: "adaptive" | "strict_manual";
  primaryReason: string; // Deterministic template, e.g. "Due for review (retrievability 68%) and aligned with 'Linear Algebra'"
  factors: Array<{
    key: string;
    label: string;
    state: "measured" | "defaulted" | "unavailable";
    normalizedValue: number | null;
    weight: number;
    signedContribution: number;
  }>;
  totalScore: number;
}
```

- `primaryReason` is generated deterministically from the top 1–2 highest positive `signedContribution` factors (or manual priority rank in `StrictManual` mode).
- No LLM call is ever used to fabricate or rewrite score explanations.
- Every number shown in the UI matches `OrchestrationBreakdown::score()` identically.

## Risks / Trade-offs

- **Risk: Provider fan-out threatens the 150 ms top-10 latency budget on large libraries.**
  - *Mitigation:* Each provider runs an indexed, bounded SQL query (`LIMIT 200`), and scoring runs in pure Rust over a pre-indexed `HashMap` in a single pass. `orchestration.bench.ts` enforces regression checks via `npm run bench:check`.
- **Risk: Over-complex UI controls overwhelm casual users.**
  - *Mitigation:* Casual users default to `balanced` (or `free_exploration` if they have no goals/due cards) with one-click launch; advanced weights (`custom` profile) and factor breakdowns are progressively disclosed behind a compact "Why?" popover and Settings.
