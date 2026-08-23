# Design: extend AI capability architecture

## Architecture

Keep:

```text
feature → AITask / domain service → router → AIProvider | PlatformMlProvider
```

Add a **capability surface** beside generative providers, not a second brain:

| Surface | Implementations later |
|---|---|
| `GenerativeProvider` (`AIProvider`) | Android Nano, cloud, future Apple FM, future LiteRT-LM |
| `SpeechProvider` | ML Kit Speech, whisper/sherpa, Groq |
| `VisionScanProvider` | ML Kit scanner+OCR, existing file import |
| `LanguageIdProvider` | ML Kit Language ID, undetermined |
| `TranslationProvider` | **Existing** `src/lib/languageTranslation` (add ML Kit adapter in G) |
| `SemanticRetriever` | `ai_learning` SQLite (SoT), optional AppSearch (C) |

Features call these interfaces. Google/Apple types never appear in React components.

## Native APIs

None. This change is TypeScript/settings/contracts.

## API maturity / version / hardware

N/A.

## Capability detection

`AIModelCapabilities` stays for generative models. New `PlatformCapabilityDescriptor`:

```text
id, available, ready,
requiresDownload, downloadSizeBytes?,
onDevice, networkRequired, foregroundOnly,
supportsStreaming, supportsImages, supportsStructuredOutput,
supportedLanguages[], modelName?, modelVersion?,
privacy: "on-device" | "may-leave-device"
```

Live detection only. `available && !ready` is **not** `UnsupportedDevice`.

States the UI must distinguish:

- ready
- supported, downloading / downloadable
- initialization incomplete (AICore configs)
- unsupported hardware/OS/feature/language
- quota / battery quota / busy
- foreground required
- permission denied

## Provider integration

- `AIProvider.kind` becomes `"ondevice" | "cloud" | "local-model"` (`local-model` unused until H).
- `resolveAiPath` remains the generative resolver. Platform ML uses `resolvePlatformCapability(id)`.
- Fallback policy enum (settings, default `prefer-on-device-no-cloud`):

```text
on-device-only
prefer-on-device   // cloud only if allowCloudFallback === true or consent
use-configured-provider
```

Cancellation never clouds. `ModelDownloading` never clouds silently.

**Unify:** `allowCloudFallback()` MUST be `settings.ai.allowCloudFallback === true` (same as `requestCloudFallback`).

## TypeScript contract

New modules (names indicative):

- `src/lib/ai/capabilities/types.ts` — descriptors
- `src/lib/ai/capabilities/speech.ts` — `transcribeAudio` / `transcribeLiveAudio`
- `src/lib/ai/capabilities/vision.ts` — `scanDocument` / `recognizeText`
- `src/lib/ai/capabilities/language.ts` — `identifyLanguage`
- `src/lib/ai/capabilities/search.ts` — `SemanticRetriever` wrapping existing rag hits
- `src/lib/ai/capabilities/fakes.ts` — FakeSpeech/Vision/Search/Translation/LanguageId
- `src/lib/ai/enrichmentPolicy.ts` — cheap/moderate/expensive

Transcript DTO (generic; optional fields):

```text
segments[]: { id, text, startMs?, endMs?, confidence?, speaker?, words?: { t, startMs, endMs }[] }
```

Scan result DTO:

```text
pages[]: { imageAssetId, width, height, ocrText?, blocks? }
document payload uses existing document create APIs
```

## Native contract

None. Later plugins implement these TS interfaces.

## Data model

- No new domain card/tag types.
- Provenance continues in `ai_provenance` with `provider`, `model`, `generatedAt`, `sourceIds`.
- Settings: `ai.fallbackPolicy` (or map existing two booleans onto the enum without breaking persistence: `preferOnDevice` + `allowCloudFallback` remain source of truth; policy is a derived view plus docs).

**Decision:** do not add a third overlapping boolean. Document mapping:

| preferOnDevice | allowCloudFallback | Policy |
|---|---|---|
| true | false | on-device-only when on-device ready, else configured cloud if any, else none — **and on-device failure does not retry cloud** |
| true | true | prefer on-device, explicit cloud retry |
| false | * | use configured provider |

## UX

- Command palette: Summarize / Explain / Generate cards / Ask this document / Ask my library / Translate selection / Scan document / Record lecture — **action names**.
- On-device indicator: one chip on the **run** (sheet header, studio footer, Ask answer header), not on every card line. Copy: “On-device” when `privacy === on-device` and providerKind is ondevice/local-model. If cloud fallback occurred, the chip MUST change (existing toast remains).
- Download UX: reuse `OnDeviceAiPanel` patterns; A only specifies a shared progress type.

## Privacy

- Never log document body, prompts, transcripts, OCR, cards.
- Diagnostics remain capability hashes, error categories, latency buckets, fallback used.
- No silent cloud.

## Offline / background / resources

- Offline: `ready && onDevice` works; `requiresDownload` explains missing asset.
- Background: generative + GenAI speech marked `foregroundOnly: true`. Indexing, file copy, SQLite writes may continue.
- Enrichment: import never auto-runs expensive generation. Cheap: language ID (when G lands), parse, index, Smart Tagging **tier 1**. Moderate: Smart Tagging tier 2 if generative ready **and** foreground **and** user has not disabled it. Expensive: summary/cards/concepts **on request** (or an explicit “Enrich” action).

Lightweight job policy (not a full scheduler):

```text
interactive  // user-waiting
normal       // generate N cards
maintenance  // index, tier-1 tags
```

At most **one** native GenAI inference at a time (already true in Kotlin). A documents this as a cross-plugin invariant: platform plugins must not start a second GenAI client while B’s queue is active if they share AICore.

## Fallback / errors / cancellation

Extended `AIErrorCategory` (additive):

```text
Busy, QuotaExceeded, BatteryQuotaExceeded, ForegroundRequired,
PermissionDenied, ModelDownloadRequired, ResourceExhausted
```

Map Kotlin codes (once B wires TS):

| Native | Category |
|---|---|
| busy | Busy |
| battery_quota_exceeded | BatteryQuotaExceeded |
| background_use_blocked | ForegroundRequired |
| safety_blocked | SafetyBlocked |
| queue_full | ResourceExhausted |
| model_downloadable | ModelDownloadRequired |

Cancellation: AbortSignal throughout new interfaces.

## Migration

Additive TS types and settings mapping. Existing `preferOnDevice` / `allowCloudFallback` persist. No DB migration required unless provenance columns are missing (they exist).

## Security

- Untrusted document containment remains mandatory for generative tasks.
- Platform ML interfaces MUST validate max text length, image dimensions, audio duration **in later native plugins**; A defines the limits constants (e.g. prompt 4k tokens already; scan page cap; audio session).
- No tool-calling privileges from model output (existing agent bounds).

## Accessibility

- Progress and cancel controls must be named for TalkBack (implementation in feature OpenSpecs).
- Generated content becomes ordinary documents/cards (already accessible).

## Tests

- Unit: fallback helper `=== true`; every new error category mapping table; fakes drive `runTask` unchanged; enrichment policy rejects expensive auto-import; capability descriptor `ready` vs `unsupported`.
- Eval fixtures stay out of default CI (existing `*.eval.test.ts` pattern).

## Cross-platform

Apple Foundation Models are **out of scope** but MUST be able to implement `AIProvider` + the same speech/vision/search interfaces later. Do not name Gemini in the shared types.

## Plugin guidance (for other agents)

Prefer **focused Tauri plugins** matching `plethora-android-tts` / `folder-import`:

- keep `plethora-android-genai`
- add speech, vision, nlp, search plugins later

Do **not** create `plethora-android-intelligence` mega-plugin (merge conflicts).
