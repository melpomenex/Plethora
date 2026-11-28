# Proposal: Implement Personal Learning Coach

## Why

Plethora now has rich local-first signals across FSRS-7 review schedules, DAQE queues, Learning Goals, Study Plans, 5-dimension competency projections, and canonical `learning_events`, yet learners still have to manually notice when they are falling into review overload, drifting off a deadline, looping on leeches, reading passively without recall, or repeating work they already mastered. At the same time, learners who prefer a quiet, self-directed environment must never be nagged, coerced, or forced to connect an AI provider.

Introducing a deterministic, privacy-respecting **Personal Learning Coach** closes this gap: it detects actionable learning opportunities purely locally from canonical SQLite state, optionally enriches explanations through Plethora's existing `runTask` AI spine when permitted, offers five explicit proactivity levels (`disabled` through `proactive`), and strictly obeys a non-mutating boundary so every concrete change requires explicit learner confirmation.

## What Changes

- **Deterministic Coaching Opportunity Detector:** Implement a pure local detector evaluating 12 well-defined learning signal types against canonical `learning_events`, FSRS-7 backlog metrics, `learning_goals`, `competency_projections`, `learning_gaps`, and session telemetry.
- **5-Level Proactivity & Anti-Nag Controls:** Introduce `disabled`, `on_demand`, `minimal`, `balanced`, and `proactive` proactivity levels with per-signal snooze/dismissal, cooldown windows, quiet hours, and surface caps.
- **AI-Optional Explanation Layer:** Render complete, localized deterministic coaching cards with zero AI dependency; optionally synthesize richer personalized rationale via `src/lib/ai/tasks/runTask.ts`, strictly gated by `enforceAssistantPrivacyAndConsent` (`src/lib/ai/assistant/privacyGate.ts`).
- **Non-Mutating Action Boundary:** Every coaching recommendation emits typed, previewable `CoachProposedAction` payloads that route through owning domain services only after explicit user confirmation — never directly mutating FSRS state, Study Plans, Learning Goals, or Competency Evidence.
- **Persistence & Settings Integration:** Add `coach_preferences`, `coach_recommendations`, and `coach_signal_dismissals` tables in SQLite migration `173_coach_and_motivation_systems` (shared migration with optional motivational systems), expose Tauri commands, wire Today/Study Mode/Command Palette surfaces, and register all new Settings controls in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`.

## Capabilities

### New Capabilities

- `personal-learning-coach`: Deterministic 12-signal learning opportunity detection, 5-level proactivity control, AI-optional privacy-gated explanations, and non-mutating previewable coaching actions.

### Modified Capabilities

- None (consumes read-only projections from `unify-learning-state-and-events`, `establish-persistent-learner-model`, `unify-learning-goals-and-study-plans`, `extend-daqe-learning-orchestration`, and `redesign-today-learning-dashboard` without breaking existing contracts).

## Dependencies

- `unify-learning-state-and-events` (canonical `learning_events` stream)
- `establish-persistent-learner-model` (5-dimension `competency_projections` & evidence)
- `unify-learning-goals-and-study-plans` (`learning_goals` & deadlines)
- `unify-assessment-evidence-and-remediation` (`learning_gaps` & remediation attempts)
- `extend-daqe-learning-orchestration` (session focus profiles & overload metrics)
- `redesign-today-learning-dashboard` (Today workspace coaching slot)
- Existing AI spine: `src/lib/ai/tasks/runTask.ts`, `src/lib/ai/assistant/privacyGate.ts`

## Non-Goals

- Autonomous background mutation of FSRS-7 intervals, review queues, Study Plans, Learning Goals, or learner competency records without explicit user confirmation.
- Requiring an AI provider (local or cloud) for any coaching signal detection or core recommendation rendering.
- Surveillance tracking, keystroke/webcam monitoring, emotional manipulation, or coercive notification spam.
- Replacing the interactive Socratic Tutor or Learning Agent in `AssistantPanel`.

## Privacy & Security

- All 12 signal detectors execute 100% locally in Rust/TypeScript over local SQLite projections; zero data leaves the device during detection.
- Optional AI explanations MUST pass `enforceAssistantPrivacyAndConsent` (`src/lib/ai/assistant/privacyGate.ts`), honoring `isLocalOnly`, `isAiExcluded`, `strictLocalOnly`, and one-time Cloud AI disclosure.
- Documents flagged `isAiExcluded` or `isLocalOnly` (when only a cloud provider is configured) automatically fall back to deterministic template explanations with redacted source excerpts.
- Raw Health Vault (`health/health.db`) tables are never queried by the Coach.
- Settings Search catalog entries never index private values, user notes, or document text (`docs/settings-search.md`).

## Migration & Backward Compatibility

- Additive SQLite migration `173_coach_and_motivation_systems` creates `coach_preferences`, `coach_recommendations`, and `coach_signal_dismissals` with safe defaults (`proactivity_level = 'balanced'`, `ai_explanations_enabled = 0` unless user opts in, or respects global AI settings).
- Existing users upgrading from v3.14.1 require zero manual migration; if the user sets `proactivity_level = 'disabled'`, all coaching surfaces hide cleanly and existing dismissals/preferences remain preserved.
- No existing Tauri commands or database tables are altered destructively.

## Performance

- Deterministic 12-signal detection MUST complete in `< 50 ms` p95 on a 10,000-item library with 50,000 `learning_events` (verified via Vitest benchmark in `src/lib/coach/*.bench.ts` and `npm run bench:check`).
- When `proactivity_level = 'disabled'`, the detector performs zero SQL queries, zero timers, and zero AI task invocations.
- Detector runs are debounced and memoized against the latest `learning_events` sequence watermark so repeated UI renders incur zero redundant computation.

## Rollback / Recovery

- Setting `proactivity_level = 'disabled'` immediately halts all coaching evaluation and hides all coaching UI surfaces without data loss.
- Because the Coach is strictly non-mutating, disabling or rolling back the feature leaves all FSRS-7 schedules, Learning Goals, Study Plans, and Competency Evidence untouched.
- Migration `173_coach_and_motivation_systems` is purely additive; rolling back application code safely ignores the new tables.

## Impact

- **Backend (Rust/Tauri):** `src-tauri/src/database/migrations/173_coach_and_motivation_systems.sql`, `src-tauri/src/database/coach_repository.rs`, `src-tauri/src/algorithms/coach/` (deterministic signal engine), `src-tauri/src/commands/coach.rs`.
- **Frontend (React/TS):** `src/lib/coach/` (signal types, action dispatcher, AI explanation task via `runTask`), `src/stores/coachStore.ts`, `src/components/coach/` (CoachCard, CoachDrawer, ActionPreviewModal), Today & Settings integrations.
- **Settings Search:** `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`, and Settings search tests.
