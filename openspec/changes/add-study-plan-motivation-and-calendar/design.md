## Context

Plan Home already separates coverage, activity, and demonstrated evidence. The existing Workload Calendar and Review store provide review forecasts and history; this change adds a plan-specific presentation without altering the shared calendar.

## Goals / Non-Goals

**Goals:** Offer useful estimates and restrained, evidence-backed recognition with independent preferences.

**Non-Goals:** Automatic FSRS rescheduling, leaderboard, mandatory streak, or claims of learning gains from engagement.

## Decisions

1. **Project instead of schedule.** Persist an optional local calendar deadline and cadence/rest days per plan. Distribute remaining eligible lessons across chosen study days using the plan order; read actual due items and projections from Review. Rest days affect suggested new work only; display actual due reviews even on rest days. Surface workload overflow, missing forecast data and passed deadlines rather than fabricating precision.
2. **Derive recognition from durable events.** Use a small versioned local event projection over existing independent checked attempts, eligible delayed reviews and accepted corrections. Deduplicate by event identity and reflect reversed evidence. Use a next-step quest and compact wrap-up instead of an XP ledger; show counts only when backed by records. Weekly cadence can include rest days without a penalty.
3. **Separate evaluation from rewards.** Collect aggregate event/count data locally by default. Any network analytics require existing opt-in and omit learner text, document names, answers and raw identifiers. Report engagement separately from pre/post and delayed independent performance on new items; do not infer improvement from uptake.

## Risks / Trade-offs

- [Misleading forecasts] → Identify estimates and incomplete data, respect local date boundaries, and preserve history when the deadline passes.
- [Competing UI] → Default recognition off, allow dismissal and quiet mode, and honor reduced motion. Keep Continue dominant.
- [Preference discoverability] → If a control is surfaced in Settings, register its stable search target and coverage per `docs/settings-search.md`.

## Migration Plan

Default existing plans to no deadline and recognition off. Preferences and local recognition can be disabled or removed independently of plan, assessment and scheduler data.
