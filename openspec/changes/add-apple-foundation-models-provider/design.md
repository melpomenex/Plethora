## Context

Plethora's generative features already execute through `runTask` (`src/lib/ai/tasks/runTask.ts`) against `AIProvider` (`src/lib/ai/providers/types.ts`). Android is adapted by `OnDeviceProvider` wrapping `onDeviceAI.ts` and Gemini Nano. Change A splits routing so multiple on-device providers can appear in `getRoutingProviders()`, registers crate `src-tauri/plugins/plethora-apple-intelligence/`, and extends errors — but does not call `SystemLanguageModel`.

Apple Intelligence Foundation Models (August 2026 conservative boundary in `openspec/planning/ios-on-device-ai-openspecs.md`):

- Min OS: iOS/iPadOS/macOS **26.0**; Apple Intelligence eligible hardware + enabled + model ready.
- Offline once the system model is downloaded.
- Guided `@Generable` structured output; `Availability` includes `available`, `deviceNotEligible`, `modelNotReady`, and other cases (disabled / unsupported).
- iOS **26.4** adds `contextSize` / `tokenCount`.
- WWDC26 Private Cloud Compute is **cloud-class** and is a **non-goal** here.
- Languages follow Apple Intelligence's published set at implementation time; libraries are not assumed English.
- Simulator: typically unavailable / not ready — mock in CI.
- App min deploy: iOS **14.0** (`src-tauri/gen/apple/project.yml`, `project.pbxproj`).

Binding decisions this change implements: D-Apple-1 (no parallel stack), D-Apple-2 (one plugin, `FoundationModelsBridge`), D-Apple-3 (id `ondevice-apple-foundation`), D-Apple-4/5 (panel + privacy indicator), D-Apple-9 (smart tagging is the existing task), D-Apple-13 (error mapping), D-Apple-14 (one heavy FM inference).

## Goals / Non-Goals

**Goals:**

- Ship a production `AppleFoundationProvider` that features already call via `runTask` / `runAiAction` / `askLibrary`.
- Native bridge: availability, generate (structured + text), stream, cancel, count tokens / context, warm-up; request IDs + event channel patterned on Android genai.
- Guided schemas aligned with `src/lib/ai/schemas/{smartTagging,learningMaterial,libraryAnswer}.ts` and on-device flashcard records consumed by `cardValidator.ts` / `parseGenerated.ts`.
- Honest availability UX (eligible / not eligible / disabled / model not ready / unsupported OS / unsupported language) without nagging users who never opened the panel.
- Long-document handling via `chunkTextByTokens` + map-reduce or merge+dedupe inside the Apple adapter.
- Deterministic Vitest coverage with `FakeAppleFoundationProvider`; documented physical-device matrix.

**Non-Goals:**

- Private Cloud Compute, or any silent off-device Apple generation.
- Raising `IPHONEOS_DEPLOYMENT_TARGET` above 14.0.
- Rewriting task prompts, inventing a second tagging/RAG/card system, or putting product prompt policy in Swift `Instructions`.
- Spotlight donations, SpeechAnalyzer, Vision document scan, NL embeddings, Core AI `.aimodel` (C/E/F/G/H).
- React `if (Platform.OS === 'ios') session.respond()`.
- Adding Apple to the OpenRouter/Ollama provider list.
- Whole-library retrieval (D); this change only **generates** when retrieval already supplied context.
- Vision / image parts on FM in v1 (`vision: false` unless a later change proves a stable API).
- Tool calling except as consumed later by D (`toolCalling` may be advertised true only when `SpotlightSearchTool` wiring exists; v1 of B may report `toolCalling: false` until D lands).

## Decisions

### 1. Apple is an `AIProvider`, not a Swift product layer

`AppleFoundationProvider` implements:

| Field / method | Contract |
|---|---|
| `id` | `"ondevice-apple-foundation"` (constant `APPLE_FOUNDATION_PROVIDER_ID`) |
| `kind` | `"ondevice"` |
| `getCapabilities()` | Live snapshot from `apple_fm_availability`; never assumed from device name |
| `generateStream` | Text and structured; respects `AbortSignal`; streams via plugin events |
| `countTokens?` | Native `tokenCount` when OS ≥ 26.4 and API present; else heuristic consistent with `estimateTokens` in `chunkTextByTokens.ts` |
| `warmUp?` | Foreground session prep, no completion |
| `cancel?` | Cancels native in-flight + queued work by `requestId` |

Features keep calling `runTask`. Swift must not define "summarize" / "generate cards" product commands.

*Alternative rejected:* Native commands per feature (`apple_fm_smart_tag`, etc.). Duplicates TS prompts and makes every wording change a device test.

### 2. One bridge file, namespaced commands, no StoreKit/folder-import

Implement `FoundationModelsBridge.swift` inside `plethora-apple-intelligence`. Commands (A-reserved names; implement only these — do **not** revive `apple_fm_status` / `apple_fm_prompt`):

- `apple_fm_availability`
- `apple_fm_generate`
- `apple_fm_generate_stream` (or generate with `stream: true` + events `apple-fm://text|complete|error`)
- `apple_fm_cancel`
- `apple_fm_count_tokens`
- `apple_fm_warmup`

TS: `src/lib/ai/apple/foundation.ts` invokes `plugin:plethora-apple-intelligence` via A’s `src/lib/ai/apple/plugin.ts`. Non-Apple OS: typed `platform_unsupported` without linking FoundationModels.

*Alternative rejected:* Separate crate per Apple API. Multiplies stubs/CI. Binding D-Apple-2.

### 3. Availability mapping (never SKUs)

Map `SystemLanguageModel.default.availability` (and equivalent disabled/not-enabled cases Apple documents at implementation time):

| Native / derived state | `AIModelCapabilities` | `AIErrorCategory` if a generate is attempted |
|---|---|---|
| `available` and Apple Intelligence language supported for this request | `textGeneration: true`, `offlineAvailable: true`, `downloadState: "downloaded"`, `structuredGeneration: true` when `@Generable` path is live | n/a |
| `modelNotReady` (downloading / not installed) | `textGeneration: false`, `downloadState: "downloading"` or `"downloadable"` | `ModelDownloading` |
| `deviceNotEligible` | `textGeneration: false`, `downloadState: "unavailable"` | `UnsupportedDevice` |
| Apple Intelligence off / not enabled | `textGeneration: false` | `FeatureDisabled` |
| OS < 26 | `unsupported_os` / `platform_unsupported` | `UnsupportedDevice` (A’s frozen mapping; not `FeatureDisabled`) |
| Request locale not in Apple Intelligence language set | capabilities may still be true for *other* languages | `UnsupportedLanguage` for that request |
| Non-Apple OS | no plugin call from desktop unit tests if A already short-circuits; else `platform_unsupported` | `CapabilityUnavailable` |

`reasoning: false`. `embeddings: false`. `prefixCaching`: true only if the session API documents reusable instructions; otherwise false. `streaming`: true when the event channel is implemented. `contextTokens`: Decision 5.

On-device panel (A’s `OnDeviceAiPanel.tsx`, conceptually "On-device intelligence"): show Apple row on iOS/macOS 26+ hosts. One-shot actionable copy **only** if the user explicitly selects Apple while unavailable. Do not nag. Do not add Apple to `AIProviderSettings` cloud list.

*Alternative rejected:* Hard-coded iPhone 15 Pro / 16+ lists. Binding §1.6.

### 4. Guided `@Generable` schemas match existing TS schemas

Swift types (names may be prefixed `AppleFm…` internally) must round-trip these wire shapes. `AIRequest.schemaName` uses existing `nativeName` values:

| `schemaName` / `nativeName` | TS source | Fields (normative) |
|---|---|---|
| `smartTagging` | `src/lib/ai/schemas/smartTagging.ts` | `existingTags[{tag, confidence, reason}]`, `proposedNewTags[{name, confidence, reason}]` |
| `learningMaterialProposal` | `src/lib/ai/schemas/learningMaterial.ts` | Same envelope as `LEARNING_MATERIAL_SCHEMA` / Kotlin contract (knowledge type, card candidates, caps enforced in TS validators) |
| `libraryAnswer` | `src/lib/ai/schemas/libraryAnswer.ts` | `answer`, `sourceRefs[{refId, quote}]`, `evidenceLevel` ∈ `supported\|weak\|none\|conflicting` |
| `generatedFlashcards` | New Generable aligned with `InternalOnDeviceFlashcard` in `src/lib/ai/cardValidator.ts` | `cards[{question, answer, card_type: qa\|cloze, tags, evidenceQuote, sourceChunkIndex}]` — TS still runs `deduplicateOnDeviceCards` / `toGeneratedFlashcards` |

When `structured === true` and `schemaName` is set, the bridge uses `@Generable` / guided generation. When structured is requested but the schema is unknown, reject with a typed error (do not free-form then pretend). When `structured` is false, return text; tasks use existing strict-JSON + one repair retry (`runTask`).

**Smart tagging:** Do not add a second tagger. Optionally switch `SystemLanguageModel.UseCase.contentTagging` when `getCapabilities` advertises it **and** the output still validates as `SmartTaggingOutput`. Otherwise default model + `smartTagging` schema. Document text remains in `<untrusted_source>` built by `smartTaggingTask.ts` — Swift `Instructions` are only the static system instruction passed from TS, never raw document concatenation.

**Prompts stay in TS.** Bridge `Instructions`/`Prompt` receive `systemInstruction` + `text` from `AIRequest`. Untrusted library/OCR/transcript text must already be inside containment blocks before crossing IPC.

*Alternative rejected:* Reimplement tag/card/library prompts in Swift. Violates D-Apple-1 and `ai-task-architecture`.

### 5. Context limits: 26.4 native metrics else 4096; chunk with `chunkTextByTokens`

- If the OS exposes `contextSize` and/or `tokenCount` (iOS 26.4+), `AIModelCapabilities.contextTokens` and `countTokens` use those values (minus a reserved output allowance supplied by the task’s `maxOutputTokens`).
- Else `contextTokens = 4096` (conservative; do not invent a larger window).
- Final native requests that still exceed the budget are **not** started; return `InputTooLarge` / `context_too_large` with measured vs limit metadata (no user content in diagnostics).
- Candidate splits use `chunkTextByTokens` from `src/lib/ai/chunkTextByTokens.ts` (paragraph → sentence → hard split). Do not introduce a second splitter.

**Map-reduce for long docs** (inside `src/lib/ai/apple/foundation.ts`, not a new task ID):

- **Plain text** (summarize/explain-style `outputKind: "text"`): hierarchical reduce — per-chunk generation then reduce concatenated intermediates until under budget or a bounded pass limit (mirror `onDeviceAI.ts` hierarchical summarize).
- **Flashcards / learning material:** per-chunk structured generate, concatenate, then existing TS dedupe/caps (`deduplicateOnDeviceCards`, Learn-this caps in validators). Do not invent a Swift merger.
- **`libraryAnswer`:** **must not** map-reduce across arbitrary slices of the library. Truncate the **list** of retrieved chunks (already `ASK_LIBRARY_CONTEXT_TOKEN_BUDGET` in `libraryTask.ts`). If a single chunk is over budget, skip that chunk rather than splitting a citation unit.

*Alternative rejected:* Always 4096 even when 26.4 reports a larger window (wastes eligible context). Always trust a large advertised window without counting the full request (instructions + prefix + content + output reserve).

### 6. No Private Cloud Compute in v1

Configure `LanguageModelSession` / `SystemLanguageModel` for **on-device** generation only. If Apple’s API cannot guarantee on-device (or the only available path is PCC), `getCapabilities().textGeneration` is false and generate returns `FeatureDisabled` with a machine-readable `pcc_required` / `off_device_unavailable` code — **never** generate and **never** call `ensureCloudAiDisclosure` as a side effect of FM (cloud disclosure remains for the existing `cloud` provider).

PCC as an explicit "Apple Private Cloud" provider is deferred (planning §6.1).

*Alternative rejected:* Silently allowing PCC when on-device assets are missing. Violates D-Apple-3 and privacy presentation.

### 7. Fallback, cancellation, concurrency, provenance

- Cloud fallback: only `runTask`’s existing path (`allowCloudFallback` default false + `requestCloudFallback` / billing consent). Provider does not implement its own OpenRouter retry.
- `Cancelled` and `SafetyBlocked` never fall back (already in `runTask.ts`).
- At most **one** heavy FM inference in flight (D-Apple-14). Queue with cancel; reuse Android `requestId` + event channel pattern. Do not build a second TS job framework.
- Provenance: when tasks record via `src/api/ai-provenance.ts`, `provider` is `ondevice-apple-foundation` and `model` is the system model identifier if advertised (else `"system-language-model"`). Diagnostics: capability, latency buckets, error category, fallback occurred — **never** documents, prompts, or completions (`src/lib/ai/diagnostics.ts` allowlist).
- Compact **On-device** indicator when `providerKind === "ondevice"` on existing Ask Library / result surfaces — do not badge every button (D-Apple-5). A may have added the indicator; B must not regress it.

*Alternative rejected:* Provider-level automatic cloud retry. Would bypass consent.

### 8. Testing: fake in CI, physical matrix out of band

`FakeAppleFoundationProvider` is an alias or subclass of change A’s `FakeLanguageProvider` in `src/lib/ai/providers/fakes.ts` (do not invent a second `AIProvider` interface). It implements `AIProvider`:

- Scriptable `getCapabilities()` snapshots (available, modelNotReady, deviceNotEligible, FeatureDisabled, UnsupportedLanguage).
- Scriptable `generateStream` returning valid/invalid structured payloads per schemaName.
- Records requests for prompt-containment assertions (untrusted blocks present; no raw PCC flag).
- `cancel` marks cancelled; subsequent chunks suppressed.
- Token counter can force `InputTooLarge`.

Vitest suites must not import FoundationModels. Playwright is not a substitute for native FM.

**Physical-device matrix** (manual / TestFlight; record in QA notes, not CI):

1. Eligible iPhone (15 Pro or 16+ class) on iOS 26+ with Apple Intelligence **available** — structured smart-tag + learn-this + text generate.
2. Eligible iPad or Mac (M-series) if the same plugin is shipped — availability `.available` path.
3. Ineligible device or Apple Intelligence **off** — panel copy, no crash, no PCC.
4. `modelNotReady` — `ModelDownloading` UX, no generate.
5. iOS 14–25 deploy-target smoke: app launches; FM types not executed.
6. Unsupported language locale (device language outside Apple Intelligence set) — `UnsupportedLanguage` + i18n.
7. Simulator — unavailable/not ready; app still usable with cloud if configured and fallback allowed.

### 9. i18n and no React `if (ios)` generation

Add keys (all six locale files) for Apple availability states, model-not-ready, device-not-eligible, intelligence-disabled, unsupported-OS, unsupported-language, and on-device privacy chip if missing. UI branches on **capability snapshots and `useAiAvailability`**, not `nativePlatform() === "ios"` inside generate handlers.

*Alternative rejected:* English-only Apple copy; platform checks in `SearchPage.tsx` / Studio to call a native session.

### 10. Registration seam with change A

Export `getAppleFoundationProvider()` from `appleFoundationProvider.ts`. A’s `getRoutingProviders()` already includes it when `textGeneration` is live (or includes the instance always and lets the router skip dead capabilities). **This change does not reorder** Nano vs Apple vs cloud.

If A left a stub module, replace the stub body only.

Optional feature flag `appleFoundationModels`: when false, `getCapabilities().textGeneration` is forced false so QA can ship iOS UI without auto-routing (planning §6.3). Default **true**.

*Alternative rejected:* B editing routing order in `providers/index.ts`.

## Risks

- **iOS 14 compile break** if 26 APIs are unguarded → `@available` + stub command implementations.
- **PCC leakage** → explicit on-device-only session; fail closed.
- **Schema mismatch** → contract tests: Swift JSON ↔ TS validators for the four schemas; invalid → `InvalidStructuredOutput`.
- **Token API absent on 26.0** → 4096 + `estimateTokens`; log model/OS in diagnostics, not content.
- **Concurrency / battery** → single-flight queue; cancel native work.
- **Language false negatives** → runtime locale check, not a hardcoded table that goes stale.
- **Conflict on `lib.rs` / `default.json`** → implement reserved commands only.

## Migration Plan

1. Land A (plugin skeleton, errors, panel, routing hook, reserved commands).
2. Add Swift `FoundationModelsBridge` behind `@available(iOS 26.0, macOS 26.0, *)` with desktop/Android stubs.
3. Add `src/lib/ai/apple/foundation.ts` + `AppleFoundationProvider` + fake; unit tests.
4. Wire guided schemas; round-trip tests against TS validators.
5. Chunking/map-reduce helper tests with over-budget fixtures (`seededRandom` not required; use fixed strings).
6. i18n keys; panel states; provenance assertion in learn-this accept test with fake provider id.
7. Confirm `preferOnDevice` false does not auto-select Apple; fallback still gated.
8. Manual device matrix on TestFlight; CI remains fake-only.

Rollback: set `appleFoundationModels` false or leave capabilities unavailable; Nano/cloud unchanged. No data migration.

## Open Questions

None. PCC deferred (planning §6.1). Language matrix is runtime-checked (planning §6.2). macOS enables FM when `.available` (planning §6.3); QA may disable via `appleFoundationModels`.
