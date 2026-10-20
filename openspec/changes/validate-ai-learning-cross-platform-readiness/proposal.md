## Why

P2: native and configured-provider paths differ materially across platforms. Source code and mocked tests cannot establish production readiness; releases need reproducible platform evidence and explicit unsupported behavior.

## Current Verified Behavior

The task registry includes Android, Apple, Windows, Foundry and configured endpoints. Rust installs Android and iOS native embedding bridges; desktop embedding routes include configured Ollama/cloud and lexical fallback. Native availability is conditional. Unit, component, Playwright, Rust and iOS device harness commands exist; no complete AI-learning platform evidence matrix was found in the audited material. This audit executed no physical-device inference. See [audit](../../planning/ai-learning-completion-audit.md).

## What Changes

- Define per-feature/provider/platform evidence, reproducible synthetic-fixture protocols and release blockers.
- Exercise actual entry points, schemas, citations, approval, persistence, retrieval, offline/cancel/failure/consent and upgrades.
- Measure CPU, memory, reader responsiveness and bounded inference against repository gates and explicit proposed device budgets.
- Separate deterministic automation, mocked integration, emulator and physical-device outcomes; unsupported combinations must degrade honestly.

## Capabilities

### New Capabilities

- `ai-learning-release-readiness`: platform evidence, performance qualification and release-blocking criteria.

### Modified Capabilities

None; this verifies existing contracts rather than rewriting providers.

## Scope and Non-goals

Android, Linux, Windows, macOS and expected iOS behavior. No universal on-device model assumption, architecture replacement, invented benchmark result or new CI release policy. Local `bench:check` remains the performance gate specified by AGENTS.md.

## Impact

Test fixtures/harnesses, native plugin validation, release evidence and implementation-status documentation. Production fixes must be confined to failures with reproducers and owned by the relevant feature change where possible.

## Dependencies

Protocol/fixture work can start immediately. Final qualification requires the five implementation changes, shared contracts and real hardware/provider availability for every advertised combination.

## Compatibility Risks

Simulator availability does not prove model readiness; model/schema support differs by provider. Existing memory baselines include interim Linux targets and cannot be copied into mobile acceptance numbers. Pending hardware evidence blocks that advertised combination until tested or explicitly disabled.

## Definition of Done

Every advertised matrix cell has reproducible passing automated and relevant physical-device evidence for the release commit; unsupported cells pass graceful-degradation checks. All blockers have explicit closure evidence, no stale capability claims remain, and measured performance stays within approved budgets.
