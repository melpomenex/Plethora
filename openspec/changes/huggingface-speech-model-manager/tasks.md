# Implementation Tasks

## 1. Rust: HF client + system info + suitability
- [x] 1.1 Add a Rust HF API client: repo info (`/api/models/{id}`), file listing, LFS metadata probing (extend `fetch_lfs_metadata` pattern), revision handling
- [x] 1.2 Add a system-info command: OS, CPU arch + cores, RAM (total/available), GPU type/VRAM, CUDA availability, Metal/Apple Silicon, disk space (use `sysinfo` or platform APIs; keep deps minimal)
- [x] 1.3 Implement suitability classification with the 5-level scale + explanations, evaluating the chosen artifact/quantization

## 2. Rust: runtime adapters + installation manager
- [x] 2.1 Define a runtime-adapter trait: `detect_artifact(files) -> Option<Artifact>`, `required_metadata`, `install_dir`, `run_contract`; implement whisper.cpp (ggml) and sherpa-onnx (ONNX STT + TTS) adapters
- [x] 2.2 Extend/extract the download manager (streaming + progress events + cancel + retry + SHA-256 + atomic rename + partial cleanup) from `model_manager.rs`
- [x] 2.3 Persist the user-installed model registry (SQLite table or established config persistence) with repo id, revision, runtime, artifact info, integrity metadata, install date
- [x] 2.4 Add commands: `hf_inspect_model`, `hf_install_model`, `hf_cancel_install`, `hf_uninstall_model`, `get_installed_hf_models`, `get_system_info`; register in `lib.rs`
- [x] 2.5 Ensure duplicate-install detection and restart re-detection

## 3. Frontend
- [x] 3.1 Add an HF model manager UI (in STT settings and/or TTS settings) with: input, inspection results, suitability badge + explanation, license, install progress/cancel/retry/remove
- [x] 3.2 Wire progress events into `useTranscriptionStore` (or a new store)
- [x] 3.3 Surface installed HF models in the STT model picker and the relevant TTS model/voice surface
- [x] 3.4 Keep UI responsive; no blocking during inspection/download

## 4. Security
- [x] 4.1 Document the security model; enforce no silent custom-code execution (explicit consent or refuse)
- [x] 4.2 Keep `.sidecar()`/`env_clear()` patterns for any spawned runtime

## 5. Tests
- [x] 5.1 Compatible small model (whisper ggml + sherpa ONNX) — Recommended/Should Run
- [x] 5.2 Incompatible architecture → Unsupported Runtime
- [x] 5.3 Insufficient VRAM → Not Recommended with explanation
- [x] 5.4 CPU-only machine realistic warning
- [x] 5.5 Apple Silicon reasoning (where test infra permits)
- [x] 5.6 Insufficient disk → blocked
- [x] 5.7 Canceled download → partial cleanup, not installed
- [x] 5.8 Failed download → error, retry, not installed
- [x] 5.9 Integrity mismatch → fail closed
- [x] 5.10 Restart re-detection; remove model; duplicate install
- [x] 5.11 Untrusted/custom-code repo → no silent execution
- [x] 5.12 Run `cargo test -p`, `npm run test:run` affected suites

## 6. Spec
- [x] 6.1 Confirm spec matches implementation