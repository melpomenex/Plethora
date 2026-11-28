# Unified Personal Learning Operating System — Program Overview

**Initiative:** Evolve Plethora into a cohesive, general-purpose personal learning operating system combining SuperMemo incremental learning, competency-based adaptive pathways, modern learning science, and local-first privacy.

**Audit Reference:** [unified-learning-os-audit.md](../../../docs/architecture/unified-learning-os-audit.md)  
**Execution Ledger:** [IMPLEMENTATION-LEDGER.md](./IMPLEMENTATION-LEDGER.md)

---

## 1. Coordinated OpenSpec Workstreams & Dependency Graph

| Phase | OpenSpec Change ID | Priority | Depends On | Primary Architectural Responsibility |
|---|---|---|---|---|
| 1 | `unify-learning-state-and-events` | P0 | — | Canonical versioned `learning_events` contract, transactional emission, idempotency, cross-surface state sync across Review/Scroll/Queue/Study/Exams. |
| 1 | `establish-persistent-learner-model` | P0 | `unify-learning-state-and-events` | 5-dimension competency model (`exposure`, `comprehension`, `retention`, `application`, `transfer`), provenance-backed evidence, correlated-card damping, invalidation, Knowledge Atlas integration. |
| 1 | `unify-learning-goals-and-study-plans` | P0 | `unify-learning-state-and-events`, `establish-persistent-learner-model` | Composable `learning_goals` (exploration, retention, mastery, deadline, skill, continuous, language) with optional Study Plan curriculum, deadline feasibility, goal evolution, zero-duplication sharing. |
| 2 | `unify-learning-activity-runtime` | P0 | Phase 1 changes | Typed `LearningActivity` contract, persisted resumable heterogeneous `LearningSession`, adapters for existing readers/reviewers/exams/trails, duplicate-work prevention, exam isolation. |
| 2 | `extend-daqe-learning-orchestration` | P0 | `unify-learning-activity-runtime`, `unify-learning-goals-and-study-plans` | DAQE heterogeneous candidate providers, session focus profiles, time budgeting, overload advisor, deadline balancing, deterministic "Why am I seeing this?" explanations. |
| 2 | `redesign-today-learning-dashboard` | P1 | `extend-daqe-learning-orchestration`, `unify-learning-activity-runtime` | Actionable **Today** workspace: Start Learning launcher, Today's Priorities, Learning Goals, Continue Where You Left Off, Explore Freely, privacy-isolated Learning Insights, progressive disclosure. |
| 3 | `implement-competency-based-adaptive-curricula` | P1 | `establish-persistent-learner-model`, `unify-learning-goals-and-study-plans` | Rich typed conceptual relationships, uncertainty/provenance metadata, non-blocking bypass, optional diagnostic, non-destructive adaptive progression reusing prior evidence, grounding recovery. |
| 3 | `unify-assessment-evidence-and-remediation` | P1 | `establish-persistent-learner-model`, `unify-learning-activity-runtime` | 8-purpose assessment taxonomy, grade correction/invalidation recomputation, dimension-targeted remediation (recall vs comprehension vs application), anti-loop safeguards. |
| 3 | `consolidate-learning-navigation-and-workspaces` | P1 | `redesign-today-learning-dashboard`, `unify-learning-activity-runtime` | Cohesive primary navigation (`Today`, `Library`, `Learn`, `Review`, `Discover`, `Knowledge`, `Insights`), universal Study workspace entry from any activity, contextual Assistant, power-user compatibility. |
| 4 | `implement-personal-learning-coach` | P2 | Phase 2 & 3 changes | Deterministic coaching opportunity detector (12 signal types), optional AI explanations, non-mutating boundary, 5 proactivity levels, dismissal/snooze, Settings search registration. |
| 4 | `extend-learning-activity-types` | P2 | `unify-learning-activity-runtime`, `unify-assessment-evidence-and-remediation` | Extensible `LearningActivityRegistry` with capability negotiation, 13 complete activity implementations + subject templates, offline degradation, explicit sandbox boundary for future code execution. |
| 4 | `implement-optional-motivational-systems` | P2 | `unify-learning-state-and-events`, `unify-learning-goals-and-study-plans` | Optional daily/weekly targets, idempotent XP (strictly separated from mastery outcomes), rest-day-safe streaks, milestones, achievements, full disableability, Settings search registration. |
| All | `validate-unified-learning-experience-end-to-end` | P0 | All above | Automated E2E verification of Scenarios A–O, migration & sync tests, large-library benchmarks, privacy/Health Vault/local-only audits, documentation & OpenSpec reconciliation. |

```text
Phase 1: unify-learning-state-and-events
           ├──> establish-persistent-learner-model ──┐
           └──> unify-learning-goals-and-study-plans <┘
                        │
Phase 2:        unify-learning-activity-runtime
                        │
                extend-daqe-learning-orchestration
                        │
                redesign-today-learning-dashboard
                        │
Phase 3:   ┌────────────┼────────────┐
           v            v            v
    adaptive-curricula  assessment-  navigation-and-
                        remediation  workspaces
           │            │            │
Phase 4:   ├──> personal-learning-coach
           ├──> extend-learning-activity-types
           └──> optional-motivational-systems
                        │
All:    validate-unified-learning-experience-end-to-end
```

---

## 2. Non-Negotiable Architectural Boundaries

1. **Single Authoritative Item Scheduler:** FSRS-7 (`src-tauri/src/algorithms/fsrs7/` & `src/algorithms/fsrs7/`) remains sole authority for item stability, difficulty, retrievability, due dates, and review intervals.
2. **Pure, Non-Mutating DAQE:** DAQE selects and ranks activities; it never mutates SRS schedules or fabricates LLM explanations for deterministic scores.
3. **Evidence-Driven Competency:** Page views produce `exposure` only; unverified AI chats never raise mastery; correlated flashcards are damped; insufficient evidence renders explicitly as `unknown` / `insufficient-evidence`.
4. **Privacy & Isolation:** `is_local_only` and `is_ai_excluded` documents never reach cloud AI or cloud embeddings; `health/health.db` stays physically isolated and never leaks into learning events, learner model, sync payloads, or AI prompts.
5. **Progressive Disclosure & Agency:** Casual readers can read immediately with zero AI, zero goals, zero assessments, and zero gamification. Every recommendation can be skipped, postponed, overridden, or disabled.
6. **Non-Destructive Migrations:** New SQLite migrations start at `168_*` in `src-tauri/src/database/migrations.rs`, transactional, idempotent, and preserve all existing documents, extracts, flashcards, review history, Study Plans, exams, and saved queues.
