## Why

P1: AI Diagnostics shows hardware and recent tasks, but cannot establish whether a learning feature's production workflow works. Users need dependency-specific recovery and developers need bounded, privacy-safe operational evidence.

## Current Verified Behavior

`AIDiagnosticsModal.tsx` displays Android-oriented capability badges, a compiled structured-output badge and recent task records. `diagnostics.ts:57` holds an allowlisted in-memory ring of 50 entries. Agent traces have a separate small content-free ring. There is no per-feature smoke-test runner, dependency-to-recovery view or redacted report exporter in this modal. See [audit](../../planning/ai-learning-completion-audit.md).

## What Changes

- Extend the current modal and diagnostic envelope with feature/run/stage correlation and readiness evidence.
- Distinguish static checks, dependency checks and successful bounded production-path smoke execution.
- Add explicit fixture-only smoke tests and redacted export; show last known success/error with freshness and recovery.
- Observe persistence and UI handoff failures rather than equating successful generation with successful completion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-task-architecture`: additional feature operational diagnostics, safe smoke execution and redacted export requirements.

## Scope and Non-goals

Extend existing diagnostic infrastructure; no parallel telemetry system or remote collector. No private-document probes, automatic paid tests or production learning-object writes during in-app smoke tests. Diagnostic success never grants consent or changes feature preferences.

## Impact

Existing AI Diagnostics modal, `diagnostics.ts`, narrow task metadata extensions and production workflow observers; fixture harnesses and Settings search reveal coverage. Nine required learning capabilities plus active recall are reported.

## Dependencies

Initialization 1.1 registry contract; diagnostics task 1.1 publishes the early event contract. Each feature supplies its adapter when implemented. Missing adapters report static/dependency evidence only, never operational success.

## Compatibility Risks

Free-text provider/model ids and errors can contain private values despite a field allowlist; export needs value-level normalization. In-memory history disappears on restart and must be labeled unknown afterward. Backend fixture tests cannot be claimed as real-device success.

## Definition of Done

Every feature reports enabled state, dependencies, selected provider/backend, model readiness, last known success/error, evidence level and actionable recovery. Controlled success/failure/cancel/consent tests and canary-based redaction tests pass through the existing modal. Operational success is scoped to stages actually exercised.
