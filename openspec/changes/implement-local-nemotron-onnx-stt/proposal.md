# Proposal: implement-local-nemotron-onnx-stt

## Why

Local Nemotron STT is advertised and downloadable but cannot transcribe anything: the "runtime" is a validating stub (`nemotron.rs` returns "runtime not available on this build yet"), a consciously deferred item in the STT platform change's accepted-debt log. Now that the download pipeline works, users install a 495 MB model, see it as installed, and hit a dead end. sherpa-onnx — already bundled and battle-tested in this app for Parakeet/SenseVoice/Zipformer STT — merged official multilingual Nemotron 3.5 streaming support in June 2026 (k2-fsa/sherpa-onnx#3671, 1.13.x series) with pre-exported ONNX packages, making real on-device inference possible on our existing rails instead of a new GGUF sidecar.

## What Changes

- Switch the pinned local Nemotron model artifact from the handy-computer GGUF to the official sherpa-onnx ONNX export (`csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-<chunk>ms-int8-…`: `encoder.int8.onnx` + `decoder.int8.onnx` + `joiner.int8.onnx` + `tokens.txt`), SHA-256-pinned per file through the existing HF install machinery (multi-file installs and hash fail-closed are already supported).
- Provision the sherpa-onnx **online** (streaming) binary alongside the existing offline sidecar — the tarball ships both, but `download-sidecars.js` currently copies only `sherpa-onnx-offline` — and bump the pinned sherpa-onnx version to a release containing the Nemotron transducer support.
- Implement real local Nemotron inference: spawn the online sidecar with the generic split-transducer contract (`--encoder/--decoder/--joiner/--tokens <wav>` — identical argv shape to our existing Zipformer split branch), parse its per-segment timestamped output, and wire it through `SttEngineRoute` → `transcribe_route` so podcast, audiobook, job-queue, and manual transcription all run on-device.
- Replace the stub error path: `nemotron.rs`'s runtime-unavailable error disappears for file transcription; missing-runtime errors surface only for genuinely missing sidecars (reusing `check_sidecar_usable`).
- Handle the transition for existing GGUF installs: the model entry shows not-installed until the ONNX set is downloaded; the stale GGUF install is surfaced with a cleanup/uninstall affordance rather than silently kept as dead weight.
- Extend sidecar packaging rails to the new binary: `externalBin`, `build.rs` placeholder seeding + macOS rpath/codesign filters, `.gitignore`, provisioning marker, and bundle verification scripts.

## Capabilities

### New Capabilities
- `local-nemotron-onnx-stt`: On-device Nemotron 3.5 speech-to-text via the bundled sherpa-onnx streaming runtime — model artifact pinning/install, sidecar provisioning, batch file transcription with segments/timestamps/progress, and the GGUF→ONNX migration behavior.

### Modified Capabilities
<!-- None: no STT/runtime capability spec is archived in openspec/specs/ yet. -->

## Impact

- **Rust backend**
  - `src-tauri/src/models/hf/manager.rs` (+ `adapters.rs`): pinned Nemotron target/contract switches to the 4-file ONNX set; GGUF legacy-install handling.
  - `src-tauri/src/transcription/engine.rs`: new sherpa family dispatch to the online binary, output parsing, progress; `nemotron.rs` stub retired into thin path/validation helpers.
  - `src-tauri/build.rs`, `src-tauri/tauri.conf.json` + platform confs: second sherpa sidecar (`sherpa-online`).
- **Provisioning/packaging**: `scripts/download-sidecars.js` (version bump + online-binary copy + marker), `.gitignore`, `verify-transcription-sidecars.mjs`, `verify-deb-bundle.sh`, `verify-macos-bundles.sh`, Windows DLL map if needed.
- **Frontend**: model-entry metadata (size/files) via existing catalog plumbing; stale-GGUF cleanup affordance in the model manager UI; no routing changes (prefer-local routing already targets the logical key).
- **Out of scope**: live-mic streaming sessions (the CLI binary can't be fed PCM incrementally — needs a C-API binding; follow-up), mobile native runtimes (Android/iOS keep existing native STT), diarization/translation.
- **User-visible**: re-download of the model in ONNX form (~0.6–0.7 GB int8 vs the 495 MB GGUF); transcription then runs fully offline.
