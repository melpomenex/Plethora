# Tasks: Benchmark and Modernize Local Decision Models

## 1. Phase 7A & 7F — Audit & Hardening
- [x] 1.1 Verify upstream Hugging Face repos for Laya (`convaiinnovations/laya-typed-decision` was 401 -> fixed to `convaiinnovations/laya-typed-decisions`, `laya-multilingual`, `laya`) and pin verified revisions.
- [x] 1.2 Add `.safetensors` LFS pointer probing in `src-tauri/src/models/hf/hf_client.rs` and fail-closed SHA-256 enforcement for `HfRuntime::LayaDecision` in `src-tauri/src/models/hf/manager.rs`.
- [x] 1.3 Fix `DaqueDecisionModelDownload.tsx` `model` field handling so `laya-serve` does not reject requests.

## 2. Phase 7B–7E — Research & Benchmark Harness
- [x] 2.1 Document authoritative candidate model research (Laya, ModernBERT-base, DeBERTa-v3-xsmall, MiniLM-L6) with licenses, parameter counts, and compatibility (`scripts/bench-decision-models/README.md`).
- [x] 2.2 Build a reproducible, versioned benchmark dataset and harness for Plethora's DAQE tasks (`scripts/bench-decision-models/dataset.json`, `run-benchmark.mjs`).
- [x] 2.3 Run the benchmark harness on available runtimes, record measured results + hardware, and document unavailable neural runtimes.

## 3. Phase 7G — Evidence-Based Selection
- [x] 3.1 Retain Laya (`convaiinnovations/laya-typed-decisions`) as the default local neural decision model until `laya-serve` / neural runtimes can be benchmarked head-to-head.
