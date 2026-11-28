# Proposal: Extend DAQE Learning Orchestration

## Why

Plethora's Dynamic Adaptive Queue Engine (DAQE) in `src-tauri/src/algorithms/daqe/{ranker.rs, terms.rs, goal_alignment.rs}`, `src-tauri/src/commands/queue_daqe.rs`, and `src/stores/daqeRankingClient.ts` already provides a pure, deterministic, explainable 5-term ranker with `StrictManual` vs `Adaptive` ordering modes and a 150 ms top-10 latency budget. However, DAQE currently only ranks `due_candidate_pool` (documents, extracts, and flashcards). It cannot assemble heterogeneous `LearningSession` plans across Learning Goals, Study Plan nodes, Guided Reading Trails, remediation items, exam prep, or Smart Feeds exploration, nor can it adapt to session focus profiles, explicit time budgets (5–120 min / unlimited), or SRS/deadline overload.

## What Changes

- Extend DAQE with pluggable, pure **Candidate Providers** that project due SRS items, active Learning Goals / Study Plan nodes, Guided Reading Trail segments, targeted remediation items, scheduled exam prep, and optional Smart Feeds exploration items into canonical `LearningActivity` candidates.
- Document and implement normalized `[0, 1]` orchestration scoring factors that build cleanly on DAQE's existing `TermBreakdown` contract (`srs_urgency`, `goal_relevance`, `energy_fit`, `interleave_penalty`, `friction_penalty`) plus provider-supplied `deadline_pressure`, `competency_gap_priority`, and `novelty_exploration` signals—always reporting absent signals honestly via `TermValue::unavailable()`.
- Add six **Session Focus Profiles** (`balanced`, `free_exploration`, `memory_retention`, `exam_prep`, `deep_study`, `custom`) with persisted user preferences and clean mapping onto `DaqeKnobs` + provider quotas.
- Add **Time-Budgeted Session Assembly** supporting 5–120 minute budgets and `unlimited`, packing heterogeneous activities deterministically to fit the budget without exceeding it unnecessarily.
- Add a deterministic **Overload Advisor** and **Deadline Balancer** that detect SRS backlog saturation or infeasible deadline crunch and surface non-coercive, user-selectable relief options without silently mutating FSRS schedules.
- Expose deterministic **"Why am I seeing this?"** explainability cards derived strictly from `TermBreakdown` and candidate provider provenance—never fabricated by an LLM.
- Preserve `QueueOrderingMode::StrictManual` vs `Adaptive`, existing `rank_queue` backward compatibility, and the 150 ms top-10 latency budget.

## Capabilities

### New Capabilities

- `daqe-learning-orchestration`: Heterogeneous candidate providers, normalized orchestration scoring, session focus profiles, time budgeting, overload advisor, deadline balancing, and deterministic explainability.

### Modified Capabilities

- None (existing `rank_queue` and `add-dynamic-adaptive-queue-engine` contracts remain backward-compatible; new orchestration commands extend the DAQE surface additively).

## Dependencies

- `unify-learning-activity-runtime` (Phase 2): Provides the canonical `LearningActivity` and `LearningSession` types assembled by DAQE.
- `unify-learning-goals-and-study-plans` (Phase 1): Supplies active Learning Goals, Study Plan nodes, and deadline feasibility metrics.
- `establish-persistent-learner-model` (Phase 1): Supplies 5-dimension competency projections and gap priorities for remediation/curriculum candidates.
- `unify-learning-state-and-events` (Phase 1): Supplies recent activity history for interleaving diversity and duplicate-work exclusion.

## Non-Goals

- Mutating FSRS-7 stability, difficulty, retrievability, or due dates during ranking or overload relief (FSRS-7 remains sole authoritative item scheduler).
- Replacing `StrictManual` ordering or breaking legacy `rank_queue` callers and `src/lib/daqe/snapshot.bench.ts`.
- Using an LLM to generate or embellish "Why am I seeing this?" score explanations.
- Reading raw Health Vault (`health/health.db`) tables inside DAQE rankers.
- Forcing casual users to configure goals, exams, or custom weights before getting a useful queue.

## Privacy & Security

- **Health Vault Isolation:** DAQE MUST NEVER query `health/health.db`. Optional energy target defaults remain user-controlled manual knobs (`DaqeKnobs`); no wearable/sleep records enter DAQE candidate pools, snapshots, or remote prompts.
- **Local-Only & AI-Excluded Filtering:** Candidates marked `is_local_only` or `is_ai_excluded` are ranked locally using deterministic Rust/TS signals and MUST be strictly excluded from any optional second-pass remote decision-model call (`rank_queue_with_decision`).
- **Offline & Zero-AI Guarantee:** All six focus profiles, time budgeting, overload advice, deadline balancing, and deterministic explanations MUST function 100% offline with zero AI providers configured.

## Migration & Backward Compatibility

- Adds a lightweight, additive SQLite table (`daqe_session_profiles` / preference columns in a transactional migration following `171_learning_activity_runtime`) for persisting custom focus profile presets and default time budget.
- Existing `rank_queue`, `get_last_queue_snapshot`, `rank_queue_with_decision`, `DaqeKnobs`, and `QueueOrderingMode::StrictManual` remain fully intact and backward-compatible.
- `StrictManual` mode bypasses adaptive profile weighting and orders candidates strictly by manual priority descending, then due instant, type, and ID.

## Performance

- **150 ms Top-10 Budget:** First-pass deterministic candidate collection, scoring, and top-10 session assembly MUST complete within 150 ms on a 5,000-item library (`TOP_N = 10` budget preserved from `ranker.rs`).
- Candidate providers MUST bound per-provider SQL queries (e.g., pre-filtered top-K per provider) and reuse `HashMap` signal indexes so orchestration stays `O(n log n)` with zero `O(n^2)` scans.
- Add a Vitest benchmark (`src/lib/daqe/orchestration.bench.ts`) and update `scripts/perf-baselines.json` per repository benchmark rules.

## Rollback & Recovery

- If any non-core candidate provider fails or times out (e.g., Smart Feeds store unavailable), DAQE logs a structured warning, skips that provider, and still returns a valid ranked session from the remaining providers (always falling back cleanly to `due_candidate_pool`).
- Removing or disabling the orchestration command falls back transparently to existing `rank_queue`.

## Impact

- **Backend (Rust/Tauri):** `src-tauri/src/algorithms/daqe/{orchestrator.rs, providers.rs, profiles.rs, budget.rs, overload.rs, explain.rs}`, `src-tauri/src/commands/queue_daqe.rs`, `src-tauri/src/models/daqe.rs`.
- **Frontend (TypeScript):** `src/stores/daqeRankingClient.ts`, `src/lib/daqe/{profiles.ts, explainability.ts, overloadAdvisor.ts}`, `src/stores/queueStore.ts`, `src/components/settings/search/{settingsSearchCatalog.ts, settingsSearchCoverage.ts}` (registering default focus profile and time budget settings).
- **Tests & Benchmarks:** Rust deterministic ranking/profile/budget/overload tests, Vitest client & explainability tests, and `orchestration.bench.ts`.
