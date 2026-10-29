## Why

Plethora needs private, offline narration that follows the reader's actual position and can also produce durable, chaptered Audio Editions. LFM3-Audio-2B offers multilingual speech and two built-in voices through a compact native GGUF pipeline; its suitability for sustained Plethora playback still requires measurement.

## What Changes

- Add **LFM3 (On-device)** to the existing TTS registry, with female/male voices, validated language choices, article-text previews, truthful availability, and optional model installation. Preserve all existing providers and preferences.
- Validate a pinned llama.cpp/libmtmd build, then run it in one supervised native host with lazy loading, warm model reuse, bounded scheduling, cooperative cancellation and a process termination deadline. Reuse Tauri invocation and sidecar provisioning. No Python installation, local HTTP service, or WebView inference.
- Extend the existing HF manager with an exact LFM3 backbone/projector contract, variant-safe registry identity, immutable revisions, verified multi-file installation, runtime probes and measured hardware classifications. Weights remain optional downloads.
- Reuse ReaderSpeechIndex, current-position selection, source anchors and the reader's prefetch logic. Promote generated reader playback into the existing application audio ownership system so leaving the reader does not stop it. Completed-sentence delivery is the initial adapter contract; it is not advertised as PCM streaming.
- Make LFM3 Audio Editions first-class persistent artifacts in the existing schema, shelf, Queue and player: immutable narration configuration, stable segment checkpoints, atomic native audio commits, early section playback, cancellation, retry, stale-source detection and restart recovery.
- Extend durable TTS caching with native file assets and complete synthesis identity. Permanent edition assets are retained independently of disposable cache eviction. Never move book-sized PCM or base64 audio through JSON IPC.
- Add measurable latency, RTF, memory, audio quality, interruption and crash-recovery gates. Platforms/workflows become available only after their actual-model and packaged-app acceptance passes.

## Capabilities

### New Capabilities

- `local-lfm3-tts`: Native LFM3 provider, managed runtime lifecycle, scheduling, capability truthfulness, synthesis identity/cache, resource bounds, privacy and release gates.

### Modified Capabilities

- `hf-model-manager`: Exact LFM3 multi-artifact contracts, immutable installation identity, operational backend checks and safe model leases.
- `tts-settings-management`: Backward-compatible local narrator configuration, availability UX and Settings search coverage.
- `document-tts-sync`: LFM3 current-position starts, provenance-preserving normalization, honest timing and application-lifetime live narration.
- `audio-edition-generation`: Generic exportable-provider dispatch, durable segmented local jobs, previews, local estimates and recovery.
- `audio-editions`: Durable assets, reproducible narration provenance, section invalidation and safe deletion.
- `audio-edition-position-persistence`: Navigation-independent listening and checkpoint identity for progressive local editions.

## Impact

**Starting point:** inspected repository commit `694cf983177ed625d052584c1fea995c53385842` on 2026-10-28. Provider dispatch, anchored reader starts, IndexedDB TTS caching, semantic extraction and SQLite edition manifests exist. Edition synthesis currently persists blob URLs and depends on an in-memory text map; its restart recovery is incomplete. Native sherpa engine/contract work from `add-supertonic-3-cross-platform-tts` is present, but its provider integration remains pending. The global playback implementation exists behind `GLOBAL_AUDIO_PLAYBACK_ENABLED = false`. See [audit.md](audit.md) for evidence and distinctions between code, specification and proposal.

**Product behavior:** download once, choose a voice/language and read from the current selection/viewport; pause, seek, skip and continue elsewhere in the app. Alternatively create a chaptered edition from canonical article/EPUB/PDF text, preview the narrator, see estimated disk/time needs, play ready sections and resume unfinished generation after restart. Scanned PDFs use existing OCR/reflow before narration.

**Platforms:** desktop-first. Apple Silicon macOS (including M4/16 GB), Linux CUDA (RTX 2060 SUPER/8 GB), Windows CUDA and desktop CPU paths are validation targets, not established support. Ship each backend only after its gate passes; slower devices may offer edition generation alone. Android ARM64 and iOS native inference are **deferred**. Web/PWA show the saved preference as unavailable and retain existing providers.

**Dependencies/conflicts:** coordinate shared HF types, Settings and native packaging with Supertonic; do not reuse its superseding sherpa scheduler for LFM3. Depend on the desktop acceptance and ownership boundaries of `global-persistent-audio-playback`, then extend that owner for reader narration instead of creating a second global player. Preserve the epoch protections in `harden-selection-youtube-auth-sync-and-tts-races`. No canonical specs or other changes are rewritten by this proposal.

**Compatibility:** additive settings/schema fields with legacy readers and immutable edition snapshots; old Pocket/Kokoro/Android/System/cloud behavior remains covered by regression tests. Invalid old generated blob assets become recoverable missing audio, never falsely ready durable files. Never change an edition's narrator because the global default changed.

**Non-goals:** ASR, voice agents, microphone capture, zero-shot cloning, voice training, arbitrary prosody controls, a second model manager/player/OCR pipeline, mandatory M4B encoding, browser/WASM inference, or simultaneous MLX/ONNX/GGUF stacks. LoRA adaptation and PCM streaming transport remain separately gated follow-ups.

**Risks and success:** experimental upstream audio APIs, full-pipeline CPU/GPU latency, sentence seams, memory growth, sidecar packaging and incomplete existing persistence/playback are the main engineering risks. The model has commercial-use conditions distinct from llama.cpp's MIT runtime license. Phase 1 must prove real audio, cancellation and bounded memory; desktop live release targets warm audible onset p95 ≤2 s and sustained RTF p95 ≤0.75, plus the navigation/recovery matrix in [validation.md](validation.md). These are proposed gates, not measured results. Both live narration and durable editions must pass their release gates before the complete product is declared delivered.
