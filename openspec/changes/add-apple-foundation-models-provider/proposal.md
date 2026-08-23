## Why

On a supported iPhone, Plethora should summarize, tag, extract concepts, and propose flashcards **without** an API key. The task layer (`runTask`, smart tagging, Learn this, passage actions, Flashcard Studio) already does this on Android via Gemini Nano. iOS has no generation backend: `OnDeviceProvider` is Nano-only and `isOnDeviceAiSupportedPlatform()` is Android-only.

Apple’s Foundation Models framework (iOS/iPadOS/macOS 26) exposes an on-device ~3B `SystemLanguageModel` with availability detection, guided `@Generable` structured output, and (on 26.4) `contextSize` / `tokenCount`. It must become an `AIProvider` (`ondevice-apple-foundation`), not a set of React `if (ios)` calls.

## What Changes

- Implement `AppleFoundationProvider` against the existing `AIProvider` contract.
- Swift `FoundationModelsBridge` in `plethora-apple-intelligence`: session, availability, guided generation for canonical schemas, streaming events, cancellation, token counting.
- Map `SystemLanguageModel.Availability` onto the shared snapshot (`available`, `device_not_eligible`, `apple_intelligence_disabled`, `model_not_ready`, `unsupported_os`).
- Keep prompts in TypeScript task definitions; Swift owns inference + `@Generable` DTOs that JSON-encode into existing TS envelopes (`SmartTagging`, `LearningMaterialProposal`, cards, `LibraryAnswer`, passage classification).
- Never send a whole book: reuse `chunkTextByTokens` / map-reduce already used for Nano.
- **No Private Cloud Compute** in this change. On-device FM only.
- Wire existing tasks (smart tagging with baseline fallback, summaries, Learn this, studio cards, passage Q&A/explain) through routing — no duplicate tagging or card systems.
- Degrade: unavailable Apple model never breaks import, reading, review, or configured cloud/Ollama.

## Capabilities

### New Capabilities

- `apple-foundation-models`: On-device Apple Foundation Models provider, guided structured output, availability UX, chunked long-document handling, tests via `FakeLanguageProvider`.

### Modified Capabilities

- `apple-ai-capability-routing`: Stub `AppleFoundationProvider` becomes live when snapshot says available.
- `ai-task-architecture`: Same tasks; additional on-device backend.
- Smart tagging / learning-material / passage tasks: unchanged contracts, new serving provider id.

## Impact

- **Hard dep:** `extend-ai-capability-routing-for-apple`.
- **Swift:** `FoundationModelsBridge.swift`, `@Generable` types, streaming listener.
- **TS:** `appleFoundationProvider.ts` (replace stub), `apple/foundation.ts` native wrappers, tests.
- **UI:** On-device panel live status; `OnDeviceProcessingBadge` on result sheets that already show AI output; command palette actions remain existing task entry points, capability-gated.
- **Must NOT change:** Android Nano Kotlin; help Ask Plethora corpus; transcription; Vision import; Spotlight donations; Core AI.

## Owns

Foundation Models inference + provider + guided schemas + FM availability copy.

## Must NOT change

Plugin crate name, routing order (A), `errors.ts` category set (A), indexer SQL, `transcriptionProvider.ts`, `EnhancedFilePicker`.

## Dependencies

Hard: A. Soft: existing task schemas. D uses this optionally for generation.

## Parallelization Notes

B may edit `appleFoundationProvider.ts` and Swift FM files. Do not rebase `providers/index.ts` order. Coordinate `lib.rs` only to replace `apple_fm_*` stubs with forwards.

## Migration / Backward Compatibility

Users without Apple Intelligence: identical to today (cloud if configured, else no gen AI). Android unchanged. Provenance `provider: "ondevice-apple-foundation"`.

## Risks

- Context window smaller than cloud — must chunk.
- Guided generation schema drift vs TS validators — contract tests with fixtures.
- Guardrail false positives — map to `SafetyBlocked`, fail closed.
- Simulator almost never `.available` — fakes in CI, device matrix in tasks.
