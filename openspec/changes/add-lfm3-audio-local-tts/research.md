# Upstream feasibility and runtime decision

Research date: 2026-10-28. This document records the original source/documentation research; its original phase downloaded no weights and ran no inference. Subsequent apply evidence, immutable input lock, local artifact verification and implementation results are recorded in [evidence/README.md](evidence/README.md). Recommendations below are engineering decisions, not vendor performance guarantees.

## Evidence ledger

| ID | Primary source | Verified observation |
|---|---|---|
| U1 | [LFM3-Audio-2B model card](https://huggingface.co/LiquidAI/LFM3-Audio-2B) | 2B architecture, 24 kHz output, 32K combined context, two gender prompts, streaming audio frames, documented speech sampling and language/locale set. No documented native word timestamps or zero-shot cloning. |
| U2 | [GGUF card](https://huggingface.co/LiquidAI/LFM3-Audio-2B-GGUF/blob/642697a5597a675cb819ed236ac415c1e60a4f6f/README.md), [file metadata API](https://huggingface.co/api/models/LiquidAI/LFM3-Audio-2B-GGUF?blobs=true) | Native llama support advertised from b11960/v0.8.0; example pairs Q4_K_M backbone and Q8_0 projector. Exact bytes and LFS SHA below. `-hf` auto-download is upstream convenience, not Plethora's install path. |
| U3 | [Pinned llama TTS README](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/tools/tts/README.md) | LFM3 task, female/male, 19 locale codes, 80 ms acoustic frames, no reference-voice cloning; projector includes encoder, depthformer and codec decoder. Sampling defaults are encoded at GGUF conversion. |
| U4 | [Pinned demonstration source](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/tools/tts/tts.cpp) | Explicitly disclaims production readiness; loads backbone/projector, runs frames, then writes a complete WAV. Spawning this per sentence would repeatedly load weights. |
| U5 | [Generation C API](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/tools/mtmd/mtmd.h#L456), [helper API](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/tools/mtmd/mtmd-helper.h#L234), [LFM3 helper](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/tools/mtmd/mtmd-helper-gen.cpp#L1271) | Experimental ABI; incremental PCM is supported with stream mode, frame stepping and final codec-tail flush. Helper retains accumulated utterance PCM even after delivering new samples; stream mode alone is not a constant-memory book pipeline. Reset per bounded utterance. |
| U6 | [ONNX card](https://huggingface.co/LiquidAI/LFM3-Audio-2B-ONNX), revision `df2b3ed2ea10824030b3ff29ee46705754e72b99` | Complete component graphs are available: decoder with recurrent caches, depth decoder and codec/STFT output. Application must drive MaskGIT sampling and inverse STFT. CUDA requires fp16-activation variants to avoid CPU attention fallback. No packaged Plethora/Rust full TTS runtime is established. |
| U7 | [MLX card](https://huggingface.co/LiquidAI/LFM3-Audio-2B-MLX-4bit/blob/f73a8a6666f3160377d20b4119035b23d6533cc6/README.md) | Weights plus separate codec exist; card explicitly says MLX-VLM support is in progress. Example commands do not establish a released, working pipeline. |
| U8 | [Liquid announcement](https://www.liquid.ai/blog/lfm3) | Introduces the audio model and LiquidCodec. Reported codec-only throughput on M4 Max is not end-to-end TTS on M4/16 GB and is not used to size Plethora performance budgets. Page retrieved directly because the browser research tool exceeded its response-size limit. |
| U9 | [Voice adaptation notebook](https://github.com/Liquid4All/cookbook/blob/main/finetuning/notebooks/lfm3_audio_tts_sft_with_transformers.ipynb) | Trains LoRA on language backbone AND depth decoder; saves adapters or merges weights. This is supervised training with paired recordings/transcripts, not reference-audio inference. |
| U10 | [Model license](https://huggingface.co/LiquidAI/LFM3-Audio-2B/blob/main/LICENSE), [llama MIT license](https://github.com/ggml-org/llama.cpp/blob/ac8e1694d837b11ed0aab944a6a2eee34b9c4d80/LICENSE) | Separate model and runtime terms; see licensing decision below. |
| U11 | [llama project](https://github.com/ggml-org/llama.cpp), [Liquid native guide](https://docs.liquid.ai/deployment/on-device/llama-cpp) | General CPU/Metal/CUDA deployment exists; it does not certify model-specific depth decoder/codec operations, cancellation or real-time quality on any target. |

Moving `main` references are discovery references. Implementation must re-fetch and pin all chosen runtime/model/license revisions, retain full SHA-256 for every distributed artifact and record source provenance. Investigated llama commit: `ac8e1694d837b11ed0aab944a6a2eee34b9c4d80`; this is a spike candidate, not a claim it passed Plethora tests. If changed, rerun the full compatibility spike and update the evidence.

## Candidate model installation

Repository `LiquidAI/LFM3-Audio-2B-GGUF`, immutable revision `642697a5597a675cb819ed236ac415c1e60a4f6f`:

| Required asset | Bytes | SHA-256 |
|---|---:|---|
| `LFM3-Audio-2B-Q4_K_M.gguf` | 1,099,626,016 | `9a773289bd321ed879cd3a76545f6aca506e403851a45fb315420aee45625be2` |
| `mmproj-LFM3-Audio-2B-Q8_0.gguf` | 337,862,080 | `26601e904245a85bd8f3cf320a629e897cfc01c1d09369e8b4fd951f13024d3e` |

Total **1,437,488,096 bytes (1.437 GB / 1.339 GiB)** before notices, runtime, scratch and generated audio. This is storage, not peak working memory or VRAM. Q4_0/Q8_0/F16/BF16 alternatives also exist, but the first supported contract accepts only this validated pair. Do not download the safetensors codec separately for GGUF: U3 places the required depth/codec pipeline in mmproj. Tokenization/templates belong to GGUF; probe required special tokens, TTS template and pipeline type at load. The included ASR encoder does not justify microphone permissions.

## Runtime comparison matrix

“Available” below concerns upstream components, not certified Plethora support. Memory/startup/cancellation need direct measurements; no row assumes weight size equals runtime requirements.

| Criterion | llama.cpp + libmtmd / GGUF | MLX / MLX-VLM | Native ONNX Runtime | Transformers; vLLM/SGLang references |
|---|---|---|---|---|
| Actual TTS completeness | Native TTS prompt, frame predictor, depth decoder, LiquidCodec/ISTFT in source (U3–5) | Checkpoint exists, released LFM3-Audio execution not established (U7) | Graph set exists; host still owns cache loops, sampling, codec synthesis/ISTFT (U6) | Reference model.generate + processor/codec demonstrated (U1); serving-framework listings alone do not validate audio output |
| Maturity | Evolving experimental audio APIs; demo CLI unsuitable as service | Card marks support in progress | Mature general engine; new model-specific orchestration not validated | Python/custom model code, large distribution/runtime surface |
| CPU | General native CPU backend; test full LFM3 pipeline | No portable desktop CPU path outside Apple stack | q4/q8 graphs use fp32 activations; test performance | Possible but expensive; no native lightweight deployment established |
| CUDA | General GGML CUDA; verify backbone AND projector/codec, driver/SM compatibility | No | fp16/q4f16/q8f16 recommended; other variants fall back for attention | CUDA/PyTorch practical reference, adds ecosystem and packaging |
| Metal | General GGML Metal; verify all graphs on M4 | Apple Silicon target, pipeline readiness blocker | No proven LFM3 Metal-equivalent EP path; CoreML partitioning unvalidated | Not a portable native Metal runtime |
| Mobile | General native builds are possible; full audio integration not validated | Apple device availability is not LFM3 iOS proof | ORT mobile engine exists; full model pipeline/memory unvalidated | Unsuitable base-app dependency |
| Quantization/dependencies | Q4_K_M + Q8 projector; embedded tokenizer/templates; bundled native runtime | 4-bit main weights + codec/tokenizer/config; upstream recommends 8-bit trade-off | Multiple external-data graphs + depth + codec/config/tokenizer; 2.09–2.71 GB example full bundles | BF16 backbone + codec/processor and explicit vetted custom code |
| RAM/VRAM | 1.437 GB files + recurrent/context state, compute buffers, projector/codec, host and output; unknown peak | ~1.73 GB weights/codec before runtime; unknown working set | Multiple sessions/graph buffers and external data; unknown peak | Material framework overhead, unknown complete peak |
| Streaming | Native per-frame output in helper; demo command emits finished WAV; helper accumulates utterance PCM | No supported LFM3 release verified | Incremental host loop could be built; not a turnkey streaming TTS service | Model exposes audio frame streamer/codec incremental decode; this does not solve packaging |
| Cancellation/cleanup | Host polls between prompt/frame steps; GPU kernel not instantly abortable; process supervisor supplies deadline/kill | Must establish APIs and resource release | Host loops/Run termination require validation across EPs | Framework stopping criteria and process kill; unnecessary stack |
| Initialization/warm reuse | Keep one loaded model, llama context and mtmd context; reset per request | Potential model reuse, no measured benefit | Reuse sessions, implement all model state transitions | Reuse Python process; bigger surface |
| Distribution/license | MIT runtime; model LFM terms; backend dependencies need notices and redistribution check | Model LFM + runtime/dependency licenses; Apple-only packaging, Python examples | MIT engine plus EP licenses; model LFM; complex model-specific native implementation | Model LFM + framework dependencies and Python environment |
| Tauri integration cost | One pinned native host and Rust supervision, no external service | Second stack with no demonstrated gain | Reusing sherpa's ORT library does not implement LFM3 graphs or tokenizer | Larger than needed; explicit remote-code execution examples unsuitable for user model loading |
| Decision | **Select for Phase 1 and gated desktop integration** | Defer until released pipeline AND measured material benefit | Reject for initial implementation, retain as evidence-backed fallback candidate if selected runtime fails | Reference validation only; do not distribute in feature |

## Architecture decision ADR-1

Use **one long-lived Plethora-owned native host linked to pinned llama.cpp/libmtmd**, supervised by Rust. Wrap the upstream helper generation APIs and prompt/template utilities; do not implement a codec or model graph in Rust/JS and do not ship an unmodified `llama-tts` per-request subprocess. Process isolation is worth the small metadata-only stdio protocol: malformed native weights, driver faults and non-cooperative kernels can be contained/terminated without unsafe thread cancellation inside Tauri. One host has one inference worker and one loaded configuration. No sockets/listening server.

The first adapter returns bounded completed WAV segments through native asset handles. Upstream PCM streaming is technically real; **Plethora v1 delivery is complete-segment**, using prefetch. A later binary PCM transport must extend the existing audio owner and pass its own acceptance gate. If completed segments cannot meet warm onset/underrun goals, do not falsely advertise live readiness: ship edition-only on that backend, or complete the separately scoped streaming extension before enabling live reading. No automatic addition of MLX/ORT to make benchmarks pass.

## Languages, voices and truthful limits

Advertised upstream locales: `ar`, `da`, `de`, `el`, `en` (American English), `en-gb`, `es`, `fi`, `fr`, `he`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `sv`, `tr`, `zh`. These are 18 languages with two English locales. Store canonical BCP-47 equivalents (`en-US`, `en-GB`, etc.) and explicitly map to upstream tokens (`en`/`en-gb`); never infer an arbitrary accent. Only a locale tested on the pinned runtime is enabled as validated; others are labeled experimental and require opt-in until quality acceptance. Voices have stable IDs `female` and `male`, not fictional named narrators. No clone, style, emotion, pitch or pronunciation API. Playback speed is a player property. Context is 32K total, not a 32K-character input allowance; phase 1 measures a conservative bounded text/token/frame budget.

## Platform release status

| Target | Proposed status | Validation before any claim of support |
|---|---|---|
| macOS Apple Silicon, M4/16 GB | Experimental candidate → supported after gates | Packaged/signature-correct host, Metal full pipeline incl. codec, memory pressure, warm/cold/30 min/thermal and navigation tests |
| Linux x86-64 NVIDIA, RTX 2060 SUPER/8 GB | Experimental candidate → supported after gates | CUDA build including SM 7.5, actual driver/dependencies, full model/codec execution, GPU memory and CPU fallback; do not reuse transcription-ready status |
| Windows x86-64 CUDA | Experimental candidate → supported after gates | Same inference test, DLL isolation, installed package, sleep/wake/device changes, OS controls |
| CPU desktop Linux/Windows/macOS Intel | Edition-first candidate; live conditional | Native CPU ISA portability, complete pipeline, memory, RTF; slow builds remain edition-only |
| Linux ARM64 desktop | Deferred packaging target | Separate build/sign/smoke evidence; ARM64 weights alone do not qualify |
| Android ARM64 | **Deferred**, not supported/experimental rollout | Future in-process JNI llama/libmtmd, model memory/battery/thermal and existing service lifecycle/AudioTrack tests; desktop sidecar unavailable |
| iOS | **Deferred**, not supported | Native arm64 backend, codec/Metal/mobile memory, entitlement/background audio, real device tests; MLX weights do not establish support |
| Browser/PWA | Unavailable native inference | Preserve existing provider choices; no automatic remote or WASM fallback |

## Licensing decision and release gate

LFM Open License v1.0 has a **$10 million annual revenue threshold**: commercial grants are conditional on not exceeding it; commercial use by an entity exceeding it is not covered. The text defines Threshold using “or more” while the operative clause uses “not exceeding”; resolve the exact-boundary interpretation and publisher/customer applicability with Liquid AI or qualified review before commercial distribution. Optional downloads do not remove these conditions.

Redistribution requires a license copy, retained applicable notices/attribution, notices of modified files and inclusion of applicable NOTICE content. Trademark permission is limited. Runtime MIT notices remain separate; CUDA/other bundled dependencies require their own inventory. Show the model license and obtain download acceptance, retain a revisioned license/NOTICE with installation, and include runtime notices in packages. Secure separate rights where required; do not market unrestricted commercial use. This is a concrete release requirement, not a claim that Plethora's commercial eligibility has been established. U10 is controlling; metadata's `other` label is insufficient.

## Future custom voice adaptation

U9 fine-tunes backbone and depth-decoder modules. A backbone-only llama LoRA loader therefore does not establish compatibility with this tutorial. Future work must test depthformer adapter support or merge both components, convert backbone AND projector from one merged checkpoint, then requantize and validate quality/license/provenance. Adapter/base/quantization hashes belong in voice/cache/edition identity. Require authorized recordings and clear consent; do not promise identity equivalence. Training and adapter installation are outside this change and do not block built-in voices.
