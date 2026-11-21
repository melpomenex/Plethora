# Design: Local Decision Model Audit and Benchmark Harness

## 1. Delivery & Security Hardening (Phase 7A & 7F)
- Add `.safetensors` to `build_file_index` LFS pointer probing in `src-tauri/src/models/hf/hf_client.rs` so `.safetensors` weights always resolve SHA-256 digests when HF API `siblings[].lfs` is incomplete.
- Enforce fail-closed SHA-256 verification for `HfRuntime::LayaDecision` in `ensure_sherpa_hash_pinned` (or generalized `ensure_runtime_hash_pinned`) and add `"laya-decision"` to `commands.rs` runtime parsing tests.
- Pin verified revisions on `LayaCheckpoint` entries after checking upstream Hugging Face metadata.
- Enable connection/health probing for `laya` in `DaqeDecisionModelSettings.tsx` (which does not require an API key) so users can verify a live `laya-serve` endpoint with a real representative inference check (`probeSelectedModel`), not merely file presence on disk.

## 2. Reproducible Benchmark Harness (Phase 7B–7D)
- Create a versioned synthetic + public-domain representative Plethora DAQE benchmark dataset (short/long docs, academic papers, RSS headlines/bodies, multilingual, ambiguous, adversarial) covering `load_tier`, `goal_alignment`, and `ready_to_review` without training/test leakage or private user data.
- Benchmark deterministic heuristics (`local_goal_alignment` / length+structure rules) and any runnable local/HTTP models on the actual host hardware, recording exact hardware specs, accuracy, macro-F1, calibration (ECE/Brier), p50/p95 latency, memory, and download size.
- Document unavailable runtimes/weights transparently rather than estimating numbers.
