## Why

Plethora already has a working AI task/provider layer (`runTask`, `AIProvider`, on-device Gemini Nano, cloud/OpenRouter/Ollama) and must not grow a second “Android AI subsystem.” Upcoming Android-native speech, scan, search, translation, and optional custom models need **shared contracts** so features request capabilities, Apple can later satisfy the same interfaces, and implementation agents do not each invent routers, errors, or fallbacks.

Without this change, parallel Android work will fork provider types, silently cloud-fallback, and leak ML Kit names into React.

## Existing behavior

- Features call `runTask` / `runAiAction` / domain services. Routing is `preferOnDevice` then cloud.
- `allowCloudFallback` defaults **false**, but `allowCloudFallback()` uses `!== false` while consent uses `=== true`.
- `AIErrorCategory` lacks Busy, quota, foreground, permission, and download-required distinctions that Kotlin already emits.
- `AIProvider.kind` is only `"ondevice" | "cloud"`. Language ID, speech, OCR, and search have no capability descriptors.
- Enrichment after import is not tiered: Smart Tagging is designed to be cheap+optional LLM, but nothing prevents stacking summarize+cards+concepts on every import.
- `FakeAIProvider` exists for generative tasks only.
- Help RAG (`askPlethoraTask`) and library RAG (`libraryTask`) are separate tasks; there is no named retriever/generator pairing type.

## Repository evidence

- `src/lib/ai/tasks/`, `src/lib/ai/providers/types.ts`, `src/lib/ai/errors.ts`, `src/lib/ai/provider.ts`
- `src/lib/ai/onDeviceAI.ts`, `src/lib/ai/__fixtures__/FakeAIProvider.ts`
- `src/stores/settingsStore.ts` (`preferOnDevice`, `allowCloudFallback`)
- `src/lib/ai/tasks/containment.ts`
- Specs: `ai-task-architecture` (from `add-ondevice-ai-learning-system`)

## What Changes

- Extend the **existing** task architecture (do not replace it) with:
  - a stable application error taxonomy covering native AI states;
  - capability descriptors for generative **and** non-generative platform ML;
  - explicit fallback policy (on-device only / prefer on-device with consent / use configured provider);
  - enrichment tiers (cheap / moderate / expensive) and a lightweight foreground job policy;
  - provider-neutral interfaces for `transcribe`, `scanDocument`, `identifyLanguage`, `translate`, `semanticSearch` **as TypeScript contracts + fakes**;
  - privacy indicator rules (when to show “On-device”, never on every sentence);
  - provenance fields aligned with existing `ai_provenance`.
- Unify cloud-fallback helpers so undefined/false never silently transmits content.
- Document Apple/iOS as a future provider of the same capabilities (no iOS implementation here).

## Capabilities

### New Capabilities
- `ai-capability-surface`: Non-generative capability descriptors, platform ML interfaces, enrichment policy, privacy indicator, fake providers for speech/vision/search/translate, retriever/generator pairing type.

### Modified Capabilities
- `ai-task-architecture`: Error taxonomy, fallback policy, provider kind union, capability snapshot fields.

## Impact

- **TypeScript:** `errors.ts`, `providers/types.ts`, `provider.ts`, `tasks/types.ts`, settings, fakes.
- **UI copy:** settings labels for fallback policy and on-device indicator; no per-token badges.
- **Native:** none in this change (stubs only).
- **Tests:** taxonomy mapping, fallback unification, fake capability providers, enrichment-tier gating.

## Non-goals

- No Kotlin/ML Kit work.
- No AppSearch, scanner, or speech implementation.
- No new flashcard/tag schemas.
- No competing router beside `runTask` / `resolveAiPath`.

## Dependencies

- Prerequisite: existing `add-ondevice-ai-learning-system` (already implemented).
- Dependents: all other Android-native AI OpenSpecs in this planning wave.

## Expected ownership (implementation fleet)

- **Agent A — AI Core** owns this change.
- Does **not** own `plethora-android-genai` internals.
