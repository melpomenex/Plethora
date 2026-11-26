# Proposal: Validate Study Mode End-to-End

## Problem Statement

Study Mode spans Rust SQLite migrations, source grounding, AI task orchestration, formative/formal assessment separation, FSRS isolation, privacy boundaries, desktop/mobile UI, and optional efficacy measurement. End-to-end integration, regression, disabled-mode overhead, and opt-in efficacy measurement must be verified before release.

## Goals

1. **Opt-In Efficacy Measurement (Migration 165)**: Add optional, privacy-preserving `study_efficacy_events` (opt-in only, disabled by default) tracking comprehension, delayed recall, transfer, hint dependence, grounding failures, and usefulness.
2. **End-to-End Integration & Regression Suite**: Verify Scenarios A–L (ordinary reader, standalone learning, Study Plan learning, misconception remediation, cross-representation consistency, source revision staleness, privacy/local-only enforcement, missing provider, cancellation, exam isolation, FSRS isolation, feature-disabled).
3. **Performance & Bundle/Memory Baselines**: Verify disabled-mode zero overhead and run `tsc`, `cargo test`, `vitest`, `docs:validate`, and `check:bundle`.

## Dependencies

- All prior Study Mode changes (`consolidate-study-mode-learning-foundation` through `add-source-grounded-multimodal-learning-views`).

## Non-Goals / Out of Scope

- Mandatory telemetry or claiming unmeasured RCT efficacy improvements.
