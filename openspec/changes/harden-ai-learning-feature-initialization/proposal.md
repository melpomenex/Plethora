## Why

P1: Enable All currently changes flags without establishing readiness. A fresh or upgraded installation needs truthful, recoverable feature activation that keeps model downloads, indexing and paid/private-content operations separately authorized.

## Current Verified Behavior

`AIProviderSettings.tsx:270` writes eleven flags to true. `settingsStore.ts:1512` defaults the main AI flags to true; freeform occlusion remains false. `AiIndexPanel` already provides paid-consent-aware backfill, charging preference, polling, pause/resume/cancel/reset. Provider snapshots and `useAiAvailability` exist, but there is no unified per-learning-feature readiness contract. See [audit](../../planning/ai-learning-completion-audit.md).

## What Changes

- Introduce a small declarative learning-feature registry that composes existing provider/model/index/consent services.
- Separate enabled preference, dependency readiness and last operational evidence.
- Replace Enable All's implied success with per-feature activation outcomes and explicit setup actions.
- Reconcile persisted settings without overwriting intentional false values or silently starting workloads; register new Settings search destinations.

## Capabilities

### New Capabilities

- `ai-learning-feature-readiness`: registry, dependency resolution, safe activation and restart recovery.

### Modified Capabilities

None; existing task/provider and paid-operation requirements remain binding.

## Scope and Non-goals

No provider registry replacement, parallel index, forced model installation or blanket privacy consent. Feature preference changes alone do not enqueue work. Expensive setup remains an explicit user operation through existing controls.

## Impact

AI Settings, settings migrations/search, readiness selectors and adapters over current platform providers, model panels and `src/api/ai-learning.ts`. Production actions consume the same readiness contract. No persisted readiness cache is authoritative.

## Dependencies

Task 1.1 is an early foundation for the other changes. Setup UI and Enable All implementation can land later; diagnostics observations are optional input rather than a circular dependency on diagnostics UI.

## Compatibility Risks

Zustand default merging must preserve explicit false preferences. A configured endpoint or compiled schema is not execution evidence. Provider kind does not establish local/private status; bulk activation must not accidentally trigger indexing observers.

## Definition of Done

Fresh, legacy, interrupted and upgraded installs show accurate independent feature states; activation displays partial readiness and offers working recovery routes. Tests prove zero downloads, indexing or inference from mounting, searching or enabling flags, and separately test every authorized setup action.
