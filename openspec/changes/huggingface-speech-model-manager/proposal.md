# Change: Hugging Face Speech Model Manager with Hardware Suitability Checks

Covers numbered requirement **#19 (install arbitrary compatible Hugging Face TTS/STT models with intelligent hardware suitability checks)**.

## Why

Plethora has local speech runtimes but no way to install arbitrary compatible Hugging Face models, and **no hardware-suitability logic exists at all**.

### Current state discovered

- **Local STT engines (Rust):** whisper.cpp sidecar (`src-tauri/src/transcription/engine.rs`, ggml `.bin` models) and sherpa-onnx sidecar (Parakeet/SenseVoice, ONNX dirs `model.int8.onnx` + `tokens.txt`). Model catalog is a **hardcoded `Vec<ModelProfile>`** (`transcription/model_manager.rs:119–165`) with pinned SHA-256 + download size, downloaded via reqwest streaming with progress (`transcription://download-progress`). Storage: `<app_data_dir>/models/whisper/`, `<app_data_dir>/models/parakeet/`.
- **Local TTS:** Pocket TTS (Kyutai, Python CLI, desktop; app does not manage its weights), Android native sherpa-onnx TTS (ONNX models via `src-tauri/plugins/plethora-android-tts/` `TtsAssetManager.kt` with SHA-256 + free-space preflight). **No MOSSAI/nanotts/transformers.js TTS exists** (`@huggingface/transformers` is an unused dependency).
- **Hugging Face usage today:** only direct download URLs for the hardcoded STT models (`huggingface.co/.../resolve/main/...`) + LFS `/raw/` metadata probing (`fetch_lfs_metadata`). No HF API client, no catalog fetch, no auth, no token handling.
- **Hardware detection:** essentially none. Rust has no `sysinfo`; only a file-presence Vulkan probe (`engine.rs:209–223`) and a `glxinfo` software-renderer check (`main.rs`). JS has no `navigator.hardwareConcurrency`/`deviceMemory`/WebGPU usage. No CUDA/Metal/RAM/disk detection. Android has a free-space preflight.
- **Security:** no `trust_remote_code` anywhere; sidecars spawned via `tauri-plugin-shell` `.sidecar()`; `env_clear()` + whitelisted envs for python subprocesses; SHA-256 verification on every existing model download; strict CSP. These patterns SHALL be extended.

### Product goal

A knowledgeable user provides a Hugging Face repo (URL or `owner/model` id) and Plethora: inspects repo metadata, determines plausibility of compatibility with the supported speech runtimes (whisper.cpp ggml, sherpa-onnx ONNX; TTS ONNX via sherpa where applicable), estimates hardware requirements, compares against the machine, warns/blocks clearly unsuitable installs, downloads safely with progress/cancel/retry/integrity, registers the model, and makes it available in the TTS/STT model picker. It must NOT be a text field that blindly downloads arbitrary repositories, and must not claim every TTS/STT-tagged repo can run.

## What Changes

### 1. Runtime-compatibility model (see spec)
Define supported architectures/formats per runtime (e.g. ggml `.bin` for whisper.cpp; ONNX (`model.onnx`/`model.int8.onnx` + `tokens.txt`) for sherpa-onnx STT and sherpa TTS), the required metadata, and a per-runtime adapter that can (a) inspect a repo's file listing to determine if a compatible artifact exists and (b) know how to run it. Propose a clean adapter architecture so future runtimes can be added without changing the manager.

### 2. Hugging Face metadata inspection (see spec)
Add a Rust HF API client (repo info + file listing via `huggingface.co/api/models/{id}` and LFS metadata) to discover: model name, task, architecture tags, parameter count if known, precision/quantization, approximate download size, license, and the actual files present. Present this in the UI as discovered metadata, clearly labeled as estimates where they are estimates. Input: pasted HF repo URL or `owner/model`, optionally `#revision`/branch.

### 3. Hardware detection (see spec)
Add system-info detection: OS, CPU architecture + core count, system RAM / available RAM, GPU type + VRAM, CUDA availability, Metal/Apple Silicon, supported accelerators, and available disk space. Implement in Rust (a `system_info` command; use appropriate crates or platform APIs — e.g. `sysinfo` or platform-specific queries; no new heavy deps where avoidable). Respect privacy: only gather what is needed for suitability.

### 4. Suitability classification (see spec)
Classify a model as one of: Recommended / Should Run / May Run Slowly (Requires Offload) / Not Recommended / Unsupported Runtime (names to match Plethora's UX), with an explanation (e.g. "Requires ~12 GB VRAM; detected GPU has 8 GB", "Compatible with CPU inference but expected to be slow", "Architecture is not supported by any installed Plethora speech runtime", "Model requires CUDA; CUDA runtime unavailable", "Estimated model files exceed available disk space"). No guarantee-language; estimates labeled as such. Consider the chosen artifact/quantization, not just the upstream full-precision repo, when quantized variants exist.

### 5. Installation lifecycle (see spec)
Reuse/extend the `ModelManager` pattern: streaming download with progress events, cancellation, partial-download cleanup, retries, SHA-256 integrity where the repo exposes it, storage under the existing model dirs, model removal, re-detection after restart, duplicate-install prevention, and version/revision identification. UI stays responsive (no blocking).

### 6. Security (see spec)
Treat downloaded repos as untrusted data. Never execute arbitrary repo code; no silent `trust_remote_code`; if a runtime genuinely requires executable custom code it must not be silently enabled. Spawn sidecars only via the existing `.sidecar()` mechanism; keep `env_clear()`/whitelisted-env patterns. Document the security model.

### 7. Licensing (see spec)
Surface the model license from HF metadata where available and note that downloading does not grant rights to use the model.

## Impact

### Affected Specs
- `hf-model-manager` (new, #19)

### Affected Code Areas
- `src-tauri/src/transcription/model_manager.rs` (extend catalog → dynamic manager), `src-tauri/src/transcription/engine.rs` (runtime adapters), new `src-tauri/src/models/` (hf client, system info, suitability)
- New Rust commands + registrations in `src-tauri/src/lib.rs`; new migration/table if a model-installation registry is persisted in SQLite (or reuse the established settings/JSON persistence)
- `src/api/transcription.ts` + a new HF-model API module; `src/stores/useTranscriptionStore.ts` (progress events); new UI in `src/components/settings/AudioTranscriptionSettings.tsx` and/or `src/components/settings/TTSSettings.tsx` + a new model manager component
- TTS side: `src/api/tts/providers/pocket.ts`, sherpa TTS path, and `TtsAssetManager.kt` patterns as references
- Tests: Rust (hf parsing, suitability math, download manager), frontend (UI states)

### Non-goals
- No auto-run of arbitrary repos; no pretending unsupported architectures work.
- No bundled LLM/vision model installation (speech TTS/STT only).
- No changes to the Groq cloud transcription path.
- No removal of the hardcoded catalog — it becomes the seed/first-party list alongside user-installed models.