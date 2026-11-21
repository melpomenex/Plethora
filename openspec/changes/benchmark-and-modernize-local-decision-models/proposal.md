# Change: Benchmark and Modernize Local Decision Models

Covers **Requirement #7** (research, benchmark, audit, and modernize local decision models).

## Why

Plethora configures Laya checkpoints (`convaiinnovations/laya-typed-decision`, `convaiinnovations/laya-multilingual`, `convaiinnovations/laya`) in `src/lib/daqe/decisionModelDownloads.ts` and routes DAQE second-pass queue ranking to an external `laya-serve` HTTP endpoint (`/v1/systemone`).

Audit of the current implementation revealed:
1. Comments claim checkpoints ship with a pinned digest, yet `LayaCheckpoint` has no pinned revision, filename, or SHA-256, and `src-tauri/src/models/hf/manager.rs` defaults to `"main"` without fail-closed hash enforcement for `HfRuntime::LayaDecision` or `.safetensors` LFS pointer probing in `hf_client.rs`.
2. `DaqueDecisionModelDownload.tsx` writes `model: checkpoint.repoId` into `settings.daqe.decisionEngine` when clicking "Use", even though `laya-serve` rejects the `model` field (`modelFor` / `body_model_for` omit it).
3. `decisionKeyProviderFor("laya")` returns `null`, hiding the connection probe button in `DaqeDecisionModelSettings.tsx` for Laya.
4. No reproducible benchmark dataset or evaluation harness exists to compare Laya against deterministic heuristics or newer lightweight local classifiers/encoders.

## What Changes

- **Phase 7A (Audit & Delivery Hardening):** Verify upstream Hugging Face repositories (`convaiinnovations/laya-typed-decision` vs `laya-typed-decisions`, etc.), fix LFS `.safetensors` pointer probing and fail-closed digest/revision pinning for `HfRuntime::LayaDecision`, fix `DaqueDecisionModelDownload.tsx` settings assignment, and expose Laya connection/health probing in `DaqeDecisionModelSettings.tsx`.
- **Phase 7B–7D (Research & Benchmark Harness):** Research authoritative upstream models (Laya checkpoints, ModernBERT-base, DeBERTa-v3-xsmall, MiniLM-L6/SetFit, fastText, deterministic heuristics), document licenses/params/compatibility, and build a reproducible, versioned benchmark harness & dataset (`scripts/bench-decision-models/` or `src/lib/daqe/__tests__/`) measuring accuracy, F1, calibration, latency, and memory across Plethora's actual DAQE decision tasks (`load_tier`, `goal_alignment`, `ready_to_review`).
- **Phase 7E–7G (Evidence-Based Selection):** Evaluate tiered routing (deterministic rules / lightweight local baseline → neural decision model) and update or retain the default local decision model strictly based on measured benchmark results.

## Impact

- **Affected specs:** `local-decision-models` (new)
- **Affected code:** `src/lib/daqe/decisionModelDownloads.ts`, `src/lib/daqe/decisionModelOptions.ts`, `src/components/settings/DaqueDecisionModelDownload.tsx`, `src/components/queue/DaqeDecisionModelSettings.tsx`, `src-tauri/src/models/hf/hf_client.rs`, `src-tauri/src/models/hf/manager.rs`, `src-tauri/src/algorithms/daqe/`
- **Non-goals:** Silent fallback to paid cloud providers, fabricating benchmark metrics for unrun models, or replacing Laya without measured evidence.
