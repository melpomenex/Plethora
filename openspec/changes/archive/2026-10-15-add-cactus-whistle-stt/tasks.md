## 1. Engine Provisioning & Packaging Rails

- [x] 1.1 Add `needle` sidecar provisioning to `scripts/download-sidecars.js` for desktop target triples (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`) and verify by running `node scripts/download-sidecars.js`.
- [x] 1.2 Register `needle` in `src-tauri/tauri.conf.json` under `bundle.externalBin` and ensure `src-tauri/build.rs` creates placeholders during development builds.
- [x] 1.3 Update sidecar verification scripts (`scripts/verify-transcription-sidecars.mjs`, `scripts/verify-deb-bundle.sh`, `scripts/verify-macos-bundles.sh`) to check for the `needle` sidecar and verify with `node scripts/verify-transcription-sidecars.mjs`.

## 2. Hugging Face Model Adapter & Registry

- [x] 2.1 Add `HfRuntime::WhistleStt` to `src-tauri/src/models/hf/adapters.rs` to detect and validate `whistle.cact` from `Cactus-Compute/whistle`, verifying with `cargo test --lib models::hf::adapters`.
- [x] 2.2 Wire Whistle model detection, directory paths, and verification into `src-tauri/src/models/hf/manager.rs`, verifying with `cargo test --lib models::hf::manager`.

## 3. Backend Transcription Engine Dispatch

- [x] 3.1 Define `SttEngineRoute::Whistle { model: PathBuf }` in `src-tauri/src/transcription/mod.rs` and update route resolution in `manager.rs`.
- [x] 3.2 Implement `transcribe_whistle` in `src-tauri/src/transcription/engine.rs` to spawn `needle --model whistle.cact --audio <wav> --audio-word-timestamps`, parse JSON output into timestamped segments, and handle audio chunking for files >30s.
- [x] 3.3 Add unit tests for Whistle output parsing, error handling, and argument generation in `src-tauri/src/transcription/engine.rs`, verifying with `cargo test --lib transcription`.
- [x] 3.4 Wire Whistle route dispatch into podcast transcription (`src-tauri/src/commands/podcast.rs`) and audiobook transcription (`src-tauri/src/transcription/job_queue.rs`).

## 4. Android Native On-Device Integration

- [x] 4.1 Add `WHISTLE` model manifest to `SttModelRegistry.kt` in `src-tauri/plugins/plethora-android-stt` and verify with `SttModelRegistryTest.kt`.
- [x] 4.2 Bundle Android native `needle` binaries (`android-arm64`, `android-armv7`) into `plethora-android-stt` assets/libs and implement execution dispatch in `SttJobManager.kt` / `SttTranscriptionService.kt`.

## 5. Frontend Settings & Unified Routing

- [x] 5.1 Add Whistle model keys and definitions to `src/services/transcription/config.ts` (`LOGICAL_STT_MODEL_KEYS.WHISTLE`, `LOGICAL_STT_MODELS`).
- [x] 5.2 Update `src/lib/transcriptionProvider.ts` to include `cactus-whistle` in quality ranking and allow on-device mobile transcription when Whistle is installed, verifying with `npm test src/lib/__tests__/transcriptionProvider.test.ts`.
- [x] 5.3 Expose Whistle STT model in `src/components/settings/AudioTranscriptionSettings.tsx` and `HuggingFaceModelManager.tsx` with download status, model size (16.9 MB), and language coverage.

## 6. Verification & End-to-End Testing

- [x] 6.1 Run full Rust and frontend test suites (`cargo test` and `npm test`) to ensure no regressions in existing transcription providers.
- [x] 6.2 Execute an end-to-end transcription smoke test on a sample WAV clip using the provisioned `needle` sidecar and `whistle.cact` model.
