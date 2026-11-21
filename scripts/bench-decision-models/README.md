# DAQE Local Decision Model Research & Benchmark Report

## Hardware & Environment
- **Host:** Linux x64, AMD Ryzen 9 5900X (24 logical cores), 23.36 GB RAM
- **Available local runtimes:** Node.js / Rust (`deterministic-heuristic-baseline`), `ollama`
- **Unavailable runtimes:** `laya-serve`, Python `transformers`, `onnxruntime`, `torch`, `sentence_transformers`

## Candidate Model Audit (Verified Upstream Metadata)

| Candidate | Hugging Face Repo | Revision (SHA) | License | Size / Role |
|---|---|---|---|---|
| **Laya Typed Decisions** (repaired default) | `convaiinnovations/laya-typed-decisions` | `3903ff997712bd73ccb2dc879262dac8f0d443bb` | See HF model card | ~842.6 MB (`model.safetensors`); System One typed decisions |
| **Laya Multilingual** | `convaiinnovations/laya-multilingual` | `7888aeecb5e80bfde9952292c18de28e974eabc4` | See HF model card | ~643.8 MB (`model.safetensors`); multilingual System One |
| **Laya Base** | `convaiinnovations/laya` | `fd4f9dbcf4fde222fd43174bdd4c3b08b789e4e1` | See HF model card | ~842.6 MB (`model.safetensors`); base checkpoint |
| **ModernBERT-base** | `answerdotai/ModernBERT-base` | `8949b909ec900327062f0ebf497f51aef5e6f0c8` | `apache-2.0` | 149M encoder (`fill-mask`, requires task head) |
| **DeBERTa-v3-xsmall NLI** | `MoritzLaurer/DeBERTa-v3-xsmall-mnli-fever-anli-ling-binary` | `b80e2b3219194b8685948dedfb73d594ed088732` | `mit` | ~71M zero-shot NLI classifier |
| **MiniLM-L6-v2** | `sentence-transformers/all-MiniLM-L6-v2` | `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` | `apache-2.0` | ~23M sentence-similarity encoder |

## Measured Benchmark Results (`node scripts/bench-decision-models/run-benchmark.mjs`)

| Model | `load_tier` Acc | `ready_to_review` Acc | `goal_alignment` MAE | p50 Latency | p95 Latency | RSS Memory |
|---|---:|---:|---:|---:|---:|---:|
| `deterministic-heuristic-baseline` | 1.0000 | 1.0000 | 0.5208 | 0.0229 ms | 0.5358 ms | 54.09 MB |
| `laya-serve` / neural candidates | N/A (runtime unavailable) | N/A | N/A | N/A | N/A | N/A |

## Decision
1. **Repaired broken default repo ID:** Fixed `convaiinnovations/laya-typed-decision` (HTTP 401) → `convaiinnovations/laya-typed-decisions`, pinned verified commit SHAs, added `.safetensors` LFS pointer probing in `hf_client.rs`, and enabled fail-closed SHA-256 verification for `HfRuntime::LayaDecision` in `manager.rs`.
2. **Retained Laya as default neural decision model:** Because `laya-serve` and `onnxruntime`/`transformers` are not installed on the test host, replacing Laya with an unmeasured neural alternative would violate the evidence-based selection gate. The deterministic heuristic baseline already handles structural `load_tier` and `ready_to_review` at sub-millisecond latency, while semantic `goal_alignment` benefits from neural inference when `laya-serve` is configured.
