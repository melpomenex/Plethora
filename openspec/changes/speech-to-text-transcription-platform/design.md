## Context

Plethora already has partial transcription infrastructure:

- **Tauri local engine** (`src-tauri/src/transcription/`): Whisper/sherpa-onnx sidecars, `model_manager.rs` pinned catalog, job queue, auto-queue for media documents
- **HF model manager** (`src-tauri/src/models/hf/`): Download, integrity verification, install/remove, `HfRuntime` adapters (WhisperCpp, SherpaOnnxStt, SherpaOnnxTts), SQLite registry
- **Groq cloud** (`src/api/groqTranscription.ts`): Chunked upload, free-tier limits
- **Transcription service layer** (`src/services/transcription/`, partially implemented): `TranscriptionService`, `TranscriptionRouter`, OpenRouter providers, reconciliation, config-driven model IDs
- **UI hook** (`useTranscriptionService.ts`): Migrating to service layer
- **Transcript sync** (`transcript-karaoke-sync` spec): YouTube-focused karaoke highlighting

Gaps vs PRD:

- No Nemotron local model in HF manager or native ASR runtime
- Settings use mode enum (Auto/Fast/Enhanced/Offline) but PRD also requires explicit Provider + Model UX (Automatic, Local, OpenRouter, Premium)
- No dynamic OpenRouter STT model discovery
- No mobile capability gating or performance classification
- Local provider wraps legacy Whisper, not unified Nemotron identity across cloud/local
- No multi-agent adversarial implementation gates documented

## Goals / Non-Goals

**Goals:**

- Single `TranscriptionService` API for all speech features
- Provider categories: Automatic, Local, OpenRouter, Premium (plus legacy mode mapping during migration)
- Shared logical model identity: Nemotron 3.5 ASR 0.6B available as cloud (OpenRouter) and local (HF install)
- Nemotron installable through existing Local Models UX—extend `HfRuntime`, not a parallel manager
- Native local runtime: React → Tauri → Rust ASR → Nemotron GGUF; backend auto-selection (CUDA/Vulkan/Metal/CPU)
- Capability-driven feature code (no `if (provider === "gemini")` checks)
- Resumable chunked jobs, transcript reconciliation, normalized errors/results
- Local-first automatic routing when installed + performant
- Offline-only guarantee: never upload audio
- Android/iOS local Nemotron on supported devices with install gating
- Multi-agent adversarial implementation with explicit phase gates

**Non-Goals (initial phases):**

- Training or fine-tuning ASR models
- Medical/legal-grade transcription guarantees
- Perfect diarization
- Supporting every OpenRouter audio model on day one
- Separate Nemotron installer UI
- Requiring Python/PyTorch/Conda/system dependencies for local ASR

## Decisions

### 1. Extend HF model manager for ASR (not a new manager)

**Decision:** Add `HfRuntime::NemotronAsr` (or equivalent) adapter, pinned Nemotron catalog entry with ASR capability metadata (`capability: "asr"`, `supportsStreaming`, `languages`, `sizeBytes`, license). Reuse download/progress/verify/remove flows from `manager.rs`.

**Rationale:** PRD mandates no duplicate model management. Existing `useHfModelStore` and Local Models UI surface ASR models alongside LLM/TTS.

**Alternatives rejected:** Separate `AsrModelManager` (violates PRD); bundling Nemotron in app binary (too large).

### 2. Shared model family identity

**Decision:** Introduce logical model key `nemotron-3.5-asr-0.6b` mapped to:
- Cloud: `openrouter:nemotron-3.5` → `nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b`
- Local: `local:nemotron-3.5` → `hf:nemotron-asr:...` registry id

Settings UI shows one display name; router resolves execution target from provider category + install state.

### 3. TypeScript service layer + Tauri native runtime

**Decision:** `TranscriptionService`/`TranscriptionRouter` in TS. Local Nemotron inference in Rust via new `nemotron_asr` module invoking GGUF through Plethora's embedded runtime (same pattern as whisper-cpp/sherpa-onnx adapters). TS `LocalTranscriptionProvider` invokes Tauri commands; never ship multi-hour PCM across JS bridge.

**Rationale:** Matches existing split; cloud HTTP in TS, heavy compute in Rust.

### 4. Provider + Model settings layered on mode enum

**Decision:** Add `sttProvider: 'automatic' | 'local' | 'openrouter' | 'premium'` and `sttModel: 'automatic' | string` to settings. Map to existing `TranscriptionMode` internally for router compatibility. Migration: old `provider: 'local'` → `sttProvider: 'local'`; `provider: 'groq'` → `sttProvider: 'openrouter'` + legacy Groq fallback in chain.

### 5. OpenRouter dynamic discovery with curated filter

**Decision:** Fetch OpenRouter model catalog periodically; filter models where metadata indicates audio/transcription input. Maintain `OPENROUTER_ASR_CURATED` override list (Nemotron, Qwen 0.6B/1.7B) for incomplete metadata. Default model from config JSON (`stt.openrouter.defaultModel`).

### 6. Local-first automatic routing

**Decision:** When `sttProvider === 'automatic'` and `preferLocal === true` and Nemotron installed and `deviceCapability >= Usable`, router prefers `local:nemotron-3.5` before cloud chain. Configurable; respects explicit cloud-only override.

### 7. Device capability classification

**Decision:** Rust-side `DeviceCapabilityService` evaluates arch, RAM, storage, backend availability. Optional post-install micro-benchmark (10s sample). Map realtime factor to Excellent/Good/Usable/Slow/Unsupported. Gate install UI on Unsupported; warn on Slow.

### 8. Job persistence extends existing queue

**Decision:** Extend `transcription_queue` with `processedDurationMs`, `providerId`, `modelId`, `sttProvider`, checkpoint fields. `TranscriptionJobManager` in TS orchestrates; Tauri handles decode chunks.

### 9. Premium providers as registered stubs until implemented

**Decision:** Gemini Transcribe, Gemini Live, Deepgram register capabilities; `transcribe()` returns `PROVIDER_UNAVAILABLE` until Phase 8. Router never silently substitutes premium without user consent.

### 10. Multi-agent adversarial implementation workflow

**Decision:** Each PRD phase uses paired agents with mandatory adversarial gates before merge to next phase:

| Agent role | Responsibility |
|------------|----------------|
| **Builder** | Implements phase tasks; writes/updates tests |
| **Security/Privacy adversary** | Attempts to find offline leaks, credential exposure, audio upload in local mode, BYOK mishandling |
| **Routing adversary** | Attempts to break fallback chains, cost escalation, silent model substitution, privacy override bypass |
| **Architecture adversary** | Flags duplicate abstractions, Nemotron-specific branching in feature code, parallel model managers |
| **Test adversary** | Writes failing cases for edge conditions builders missed; property tests for reconciliation |

**Gate protocol:** Phase N is not complete until builder fixes all adversarial findings rated P0/P1. P2 documented as follow-ups. Run `bugbot` + `security-review` subagents at each gate (already used in tasks 10.3).

## Module Structure

```
src/services/transcription/          # (partially exists)
  TranscriptionService.ts
  TranscriptionRouter.ts
  types.ts, errors.ts, config.ts
  reconciliation.ts, pricing.ts, usage.ts
  providers/
    LocalTranscriptionProvider.ts    # extend: Nemotron + legacy Whisper
    OpenRouterTranscriptionProviderAdapter.ts
    OpenRouterNemotronProvider.ts
    OpenRouterQwenProvider.ts
    GroqTranscriptionProvider.ts
    stubs/...
  jobs/TranscriptionJobManager.ts
  audio/AudioChunker.ts

src-tauri/src/
  models/hf/
    adapters/nemotron_asr.rs         # NEW: HfRuntime adapter
    manager.rs                       # pinned Nemotron catalog entry
  transcription/
    nemotron/                        # NEW: load, infer, streaming session
    device_capability.rs             # NEW: classify device
    engine.rs                        # extend routing to Nemotron
  commands/transcription.rs          # expose local ASR invoke surface

src/components/settings/
  SpeechToTextSettingsPanel.tsx      # NEW: provider/model/language UX
```

## Routing Logic

```
User selection: sttProvider + sttModel + preferLocal + offlineOnly + allowFallback

AUTOMATIC
 ├─ offlineOnly? → local only (fail if unavailable, never cloud)
 ├─ sttModel explicit local Nemotron + installed? → local:nemotron
 ├─ preferLocal + Nemotron installed + capability >= Usable? → local:nemotron
 ├─ else cloud chain → openrouter:nemotron → qwen-0.6b → qwen-1.7b → legacy:groq
 └─ premium only if mode=enhanced/realtime and configured

LOCAL (explicit)
 └─ local:nemotron (if installed) → local:whisper/sherpa fallback → error

OPENROUTER (explicit)
 └─ selected model or automatic default → no local inference

PREMIUM
 └─ gemini-transcribe / gemini-live / deepgram (stubs until Phase 8)

Fallback guard: no silent escalation from inexpensive → premium; respect cost tier metadata
```

## Local Runtime Stack

```
React UI
  ↓ invoke
Tauri commands (transcription_local_*)
  ↓
Rust NemotronAsrEngine
  ├─ BackendSelector: CUDA > Vulkan > Metal > CPU (platform-specific order)
  ├─ ModelLoader: read from hf_installed_models path
  ├─ StreamDecoder: ffmpeg chunked PCM (reuse existing patterns)
  └─ Session: batch + optional realtime pushAudio
  ↓
Nemotron GGUF artifact (~742 MB)
```

## Mobile

- **Android:** NDK ARM64, Vulkan preferred then CPU; same registry + `LocalTranscriptionProvider`; capability gate before showing Install
- **iOS:** ARM64 Metal/CPU; lifecycle-aware job pause/resume; background restrictions documented
- Shared transcript API and normalized results across platforms

## Multi-Agent Phase Plan

| Phase | Builder focus | Adversarial focus |
|-------|---------------|-------------------|
| 1 | Core platform (done/partial) | Offline leak tests, provider boundary audit |
| 2 | OpenRouter (done/partial) | Auth handling, model ID injection, 429 behavior |
| 3 | Settings UX + provider/model selection | Migration correctness, privacy copy |
| 4 | Local Nemotron desktop | Install integrity, no cloud on local mode, OOM paths |
| 5 | Local/cloud automatic routing | preferLocal bypass, cost escalation |
| 6 | Jobs + long-form + reconciliation | Resume corruption, memory bounds |
| 7 | Android local Nemotron | Unsupported device install blocked, storage edge cases |
| 8 | iOS local Nemotron | Background suspend, thermal throttling messaging |
| 9 | Realtime + pseudo-streaming | Latency runaway, duplicate text at boundaries |
| 10 | Premium providers | BYOK isolation, premium cost guards |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Nemotron GGUF runtime immature | Spike adapter early; keep Whisper as local fallback |
| OpenRouter STT API shape changes | Isolate HTTP in adapter; mocked integration tests |
| Mobile Nemotron too slow on mid devices | Capability gate + honest UX; cloud alternative always available |
| Settings migration breaks Groq users | Explicit migration map; temporary legacy flag |
| Multi-agent overhead | Adversarial gates only at phase boundaries, not per commit |
| HF manager complexity | Single new runtime variant; reuse all install plumbing |

## Migration Plan

1. Phase 1–2 (partially complete): Service layer + OpenRouter providers
2. Phase 3: Provider/model settings UI; deprecate bare local/groq toggle
3. Phase 4: Nemotron in HF manager + desktop local runtime
4. Phase 5: Local-first automatic routing
5. Phase 6: Resumable jobs + import dialog
6. Phase 7–8: Android then iOS
7. Phase 9–10: Realtime, premium providers

Rollback: `transcription.useLegacyRouting` restores pre-migration behavior.

## Open Questions

- Exact Nemotron GGUF source URL and runtime library (verify NVIDIA/Plethora hosting at implementation)
- OpenRouter STT endpoint schema for streaming vs batch
- Whether post-install benchmark runs automatically or on-demand
- Plethora-managed OpenRouter keys timeline vs BYOK-only initially
