## Context

The [closure plan](../../planning/issue-6-final-closure-plan.md) reconciles current evidence and the focused changes. Existing visual and golden harnesses have different discovery and persistence boundaries. A result must identify which boundary was crossed.

## Goals / Non-Goals

Collect reproducible release evidence for the exact reported paths. Preserve subsystem ownership, data contracts, and the C8 golden oracle. Scope covers qualification and handoff, with feature changes routed to their owners.

## Decisions

- Run existing tests first and record reproducible baseline failures. Add a single Issue #6 entry point or manifest that composes the owner suites. Report unit, browser, native IPC/SQLite, visual, physical and provider evidence separately. A monolithic test would make failures hard to diagnose and re-run.
- Use synthetic seed data, temp native profile/database and separate browser origin/context. Exercise app entry points and compare real persisted snapshots after restart. Use test-only hooks for time, deterministic provider transport and inspection. Test-only writes after setup would bypass the user's workflow.
- Store a release evidence table keyed by issue ID and gate, with SHA, OS/build/webview, fixture, command, assertion, outcome, and sanitized artifact link. Record any explicit limitation alongside the affected advertised surface. Use a separate report for external provider model IDs, consent, token/cost and latency.
- Require two matching normalized C8 runs and preserve actual source, scheduler and answer visibility invariants. Avoid comparing wall-clock timestamps or generated IDs directly.

## Risks / Trade-offs

- Historical screenshots have user content. Build synthetic visual fixtures with matching geometry/state and keep screenshots linked at source.
- Native/mobile/media/provider coverage requires real environments. Record named blockers and carry unresolved P1s forward.
- Baseline failures can hide Issue #6 regressions. Re-run individually on baseline and candidate, compare assertions, and route confirmed failures to the owning change.

## Migration Plan

No schema change in this qualification change. Exercise the owning migrations and rollback/restore claims against a populated copy. Use isolated user-data roots throughout.
