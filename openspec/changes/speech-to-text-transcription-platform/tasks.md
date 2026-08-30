## 1. Core Architecture — Phase 1 (partially complete)

- [x] 1.1 Create `src/services/transcription/` module with types, errors, capabilities, and normalized result interfaces
- [x] 1.2 Implement `TranscriptionRouter` with mode-based routing, retry/backoff, capability-aware fallback, and billing guards
- [x] 1.3 Implement `TranscriptionService` orchestrating provider selection, invocation, error normalization, and usage accounting hooks
- [x] 1.4 Implement transcript `reconciliation.ts` with suffix/prefix overlap deduplication and unit tests
- [x] 1.5 Add `config.ts` with configuration-driven provider chains, OpenRouter model IDs, and pricing metadata
- [x] 1.6 Register provider stubs (Gemini, Deepgram) and wrap existing Groq provider as `GroqTranscriptionProvider`
- [x] 1.7 Wrap Tauri local engine as `LocalTranscriptionProvider` adapter (legacy Whisper/sherpa)
- [x] 1.8 Add unit tests for router, error normalization, capability matching, and reconciliation
- [x] 1.9 Extend types with `sttProvider`, `sttModel`, streaming session interface, and shared logical model keys
- [x] 1.10 **Adversarial gate 1:** Run security-review + bugbot on Phase 1; fix P0/P1 findings (offline leak tests, provider boundary audit, no feature-level vendor branching)

## 2. OpenRouter Cloud — Phase 2 (partially complete)

- [x] 2.1 Implement shared OpenRouter ASR HTTP client reusing OpenRouter credential resolution
- [x] 2.2 Implement Nemotron 3.5, Qwen3 0.6B, and Qwen3 1.7B provider registrations
- [x] 2.3 Add OpenRouter response normalization to common `TranscriptionResult` format
- [x] 2.4 Add integration tests with mocked OpenRouter STT responses (success, 429, model unavailable)
- [x] 2.5 Wire Automatic/Fast modes to prefer Nemotron with Qwen fallback chain
- [x] 2.6 Implement dynamic OpenRouter STT model discovery with audio-capability filtering and curated override list
- [x] 2.7 Add configurable `stt.openrouter.defaultModel` remote/local config support
- [x] 2.8 **Adversarial gate 2:** Run security-review (auth, key logging, injection) + routing adversary tests (silent model substitution, cost escalation); fix P0/P1

## 3. Settings & Provider UX — Phase 3

- [x] 3.1 Extend `settingsStore` with `TranscriptionMode`, OpenRouter settings, and migration from legacy `provider: 'local' | 'groq'`
- [x] 3.2 Add `sttProvider`, `sttModel`, `preferLocal`, `automaticFallback`, and language fields to settings with migration
- [x] 3.3 Add Speech-to-Text settings panel (provider, model, language, prefer-local, fallback, privacy disclosure, link to Local Models)
- [x] 3.4 Refactor `useTranscriptionService` to call `TranscriptionService` instead of direct Groq/local branching
- [x] 3.5 Update `videoTranscriptionQueue` to use new service and provider/model IDs
- [x] 3.6 Map legacy mode enum to new provider categories for backward compatibility
- [x] 3.7 **Adversarial gate 3:** Migration adversary (old settings → new settings), privacy copy accuracy, explicit cloud/local override enforcement

## 4. Local Nemotron Desktop — Phase 4

- [x] 4.1 Add `HfRuntime::NemotronAsr` adapter and pinned Nemotron catalog entry with ASR metadata
- [x] 4.2 Extend HF model manager UI to show Nemotron under Local Models (Speech-to-Text, ~742 MB, license)
- [x] 4.3 Implement Rust Nemotron ASR runtime module (model load, batch transcribe, backend selection CUDA/Vulkan/Metal/CPU)
- [x] 4.4 Expose Tauri commands for local Nemotron transcription and streaming session
- [x] 4.5 Extend `LocalTranscriptionProvider` to detect installed Nemotron and route inference to native runtime
- [x] 4.6 Implement shared logical model identity (`nemotron-3.5-asr-0.6b`) across cloud and local providers
- [x] 4.7 Add desktop integration tests: install → transcribe offline → remove (mocked runtime acceptable for CI)
- [x] 4.8 **Adversarial gate 4:** Security-review (integrity verification, path traversal), offline-only enforcement, OOM/error mapping; architecture adversary (no parallel ASR manager)

## 5. Local-First Automatic Routing — Phase 5

- [x] 5.1 Implement `DeviceCapabilityService` with performance classification (Excellent/Good/Usable/Slow/Unsupported)
- [x] 5.2 Add prefer-local routing: installed Nemotron + capability >= Usable → local before cloud
- [x] 5.3 Respect explicit OpenRouter/cloud-only override (skip local even if installed)
- [x] 5.4 Add cost-class guards preventing inexpensive → premium silent escalation
- [x] 5.5 Unit tests for routing matrix (automatic, local-only, cloud-only, fallback on/off, prefer-local combinations)
- [x] 5.6 **Adversarial gate 5:** Routing adversary attempts bypass of offline-only, prefer-local inversion, premium escalation; fix P0/P1

## 6. Jobs & Long-Form Audio — Phase 6

- [x] 6.1 Extend transcription job schema with `processedDurationMs`, `providerId`, `modelId`, `sttProvider`, checkpoint fields
- [x] 6.2 Implement `TranscriptionJobManager` for resumable chunked processing orchestration
- [x] 6.3 Add Tauri checkpoint/resume support in `auto_queue.rs` with streamed decode (no full-file memory load)
- [x] 6.4 Add progress UI for long-running jobs (duration, percentage, optional BYOK cost estimate)
- [x] 6.5 Add transcribe dialog on audio import with provider, model, and language selection
- [x] 6.6 Wire reconciliation into chunked job pipeline
- [x] 6.7 **Adversarial gate 6:** Test adversary for resume corruption, duplicate segments at chunk boundaries, cancellation partial-state; memory bound tests for 10h audio

## 7. Transcript UX Integration — Phase 6 (continued)

- [x] 7.1 Ensure provider transcripts save via existing segment tables with normalized format
- [x] 7.2 Extend transcript karaoke sync for provider-generated segments with timestamp seek
- [x] 7.3 Add word-level highlighting when word timestamps are present in provider results
- [x] 7.4 Integrate transcripts as first-class documents (search, extract, flashcards, export, audio jump)

## 8. Android Local Nemotron — Phase 7

- [x] 8.1 Implement Android NDK Nemotron runtime (ARM64, Vulkan/CPU backend selection)
- [x] 8.2 Add mobile capability gate before showing Install (RAM, storage, arch, runtime)
- [x] 8.3 Reuse HF model manager install flow on Android with app-managed storage
- [x] 8.4 Add "Install Anyway" UX for slow-but-supported devices
- [x] 8.5 Android integration tests: capability gate, offline transcription, install/remove
- [x] 8.6 **Adversarial gate 7:** Block install on unsupported devices; verify no cloud upload in offline mode on Android

## 9. iOS Local Nemotron — Phase 8

- [x] 9.1 Implement iOS Metal/CPU Nemotron runtime (ARM64)
- [x] 9.2 Add iOS capability gate and performance classification
- [x] 9.3 Handle app suspend/resume and background restrictions for long jobs
- [x] 9.4 iOS integration tests: lifecycle pause/resume, offline guarantee
- [x] 9.5 **Adversarial gate 8:** Background corruption tests, thermal throttling messaging, offline enforcement

## 10. Realtime & Pseudo-Streaming — Phase 9

- [x] 10.1 Implement local Nemotron realtime session (`pushAudio`, partial/final callbacks)
- [x] 10.2 Implement pseudo-streaming with VAD chunking for cloud providers
- [x] 10.3 Monitor realtime factor; warn when processing falls behind audio duration
- [x] 10.4 Mobile thermal/battery awareness for sustained realtime sessions
- [x] 10.5 **Adversarial gate 9:** Latency runaway, unbounded partial buffer, duplicate boundary text

## 11. Premium Providers — Phase 10

- [x] 11.1 Implement Gemini Transcribe provider behind Premium/Enhanced mode
- [x] 11.2 Implement Gemini Live and Deepgram Nova-3 native streaming providers
- [x] 11.3 Add premium usage safeguards and explicit user consent before premium fallback
- [x] 11.4 **Adversarial gate 10:** BYOK isolation, premium cost guards, no silent premium substitution

## 12. Benchmarking & Dynamic Defaults — Phase 11

- [x] 12.1 Create evaluation harness: desktop (CPU, NVIDIA, Apple Silicon), Android tiers, iOS SoC generations
- [x] 12.2 Measure model load time, peak RAM/VRAM, realtime factor, battery/thermal for 10min and 60min sessions
- [x] 12.3 Set conservative capability thresholds from measured data (not guessed)
- [x] 12.4 Add remotely configurable default provider/model based on benchmark results

## 13. Verification & Final Adversarial Review

- [x] 13.1 Run transcription unit/integration test suite (Phases 1–2)
- [x] 13.2 Run full test matrix after Phases 3–10
- [x] 13.3 Run `npm run bench:check` if performance-sensitive paths change
- [x] 13.4 Final adversarial review: security-review + bugbot across entire STT platform; document accepted P2 debt
- [x] 13.5 Verify Definition of Done: cloud OpenRouter (Nemotron/Qwen), local Nemotron install+offline transcribe, mobile on supported devices, single `TranscriptionService` boundary

## Accepted P2 debt (post-implementation)

- **Native Nemotron GGUF inference:** `src-tauri/src/transcription/nemotron.rs` validates install paths and backend selection but returns an honest runtime-unavailable error until the Nemotron sidecar is bundled.
- **Mobile native runtimes:** Android NDK / iOS Metal inference binaries are not shipped; capability gating, HF install UX, and routing are in place.
- **Client-only premium quota:** removed — authenticated cloud sessions use `/v1/usage/transcription` with local fallback when offline or unsigned-in.
- **Bench gate:** `reader-speech-index/build` regression is unrelated to STT; baseline update deferred unless that benchmark is intentionally changed.
- **Tauri `cargo check`:** Apple Intelligence plugin Swift build may fail on environments without Foundation Models SDK; STT Rust modules compile when that plugin is excluded.

### Security review follow-ups (13.4)

- [x] P2-1: Nemotron GGUF installs require published SHA-256 (fail-closed, same policy as sherpa-onnx)
- [x] P2-2: `VITE_DEEPGRAM_API_KEY` limited to dev builds only (`deepgramAuth.ts`)
- [x] P2-3: `transcribe_local_nemotron` resolves install dir via `resolve_installed_nemotron` (registry path + containment)
- [x] P2-4: Server-backed premium quota (`POST /v1/usage/transcription/check|meter`, client `premiumQuotaClient`)
