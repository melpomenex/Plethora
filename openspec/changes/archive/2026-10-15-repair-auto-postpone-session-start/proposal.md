## Why

Auto-Postpone currently behaves as a prompt-only option, and the current mobile and desktop Queue/Schedule startup paths bypass the prompt entirely. Users can enable the setting, restart Plethora, and still see the same overdue backlog; the setting's name and description promise behavior that the app does not perform.

## What Changes

- Run automatic postponement once for the active collection after a new app session has both hydrated settings and a ready backend, regardless of which tab or schedule surface opens first.
- Detect candidates from persisted scheduling data, exclude unscheduled and inactive content, and distinguish date-only/local-calendar semantics from invalid or missing dates.
- Plan a bounded future workload distribution and apply due-date-only updates through a type-aware batch operation with per-item outcomes.
- Preserve manual postpone controls independently and replace the automatic blocking prompt with a nonblocking completion summary.
- Keep the user-visible Learning Settings value as the source of truth; retire the unused, separate Rust auto-postpone toggle/decision path.
- Update the existing postpone specifications, translated setting descriptions, and user-facing documentation.

## Capabilities

### New Capabilities
- `postpone-session-orchestration`: Session-start lifecycle, persisted candidate detection, idempotent batch execution, scope, failure reporting, and automatic feedback.

### Modified Capabilities
- `postpone-engine`: Define overdue recovery dates, bounded workload distribution, and scheduling-state invariants.
- `postpone-settings`: Define automatic behavior and settings hydration/persistence expectations.
- `postpone-ui`: Replace the automatic confirmation prompt with a nonblocking result summary while retaining manual controls.

## Impact

Affected areas include the application shell and startup coordinator; queue and schedule APIs/stores; the TypeScript postpone planner; Rust queue and repository commands for candidate loading and batch persistence; settings and translations; schedule feedback; and frontend/Rust regression tests. The change preserves active-collection scoping and existing manual single-item postpone behavior while making the automated path independent of visible queue rows.
