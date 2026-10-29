# Provider implementation evidence

The user clarified the product scope on 2026-10-28: LFM3 is another optional TTS
provider in the existing app, for users across supported platforms. A developer's
GPU is only a test device. The superseded broad architecture/qualification plan
is retained in `initial-scope/`; its G1–G5 program is not an implementation gate.
The current proposal, design, validation and 16-task checklist govern the work.

## Verified inputs

`inputs.lock.json` pins llama.cpp/libmtmd commit
`ac8e1694d837b11ed0aab944a6a2eee34b9c4d80` and model revision
`642697a5597a675cb819ed236ac415c1e60a4f6f`. Both downloaded GGUF files matched their
immutable metadata, exact byte counts and SHA-256 hashes. The 1,437,488,096-byte
weight pair contains the backbone/template and required depthformer/codec.
Exact model/runtime notices and the dependency inventory are retained with the
lock and under `notices/`. No weights are committed to the application.

## Actual audio smoke

The isolated probe generates five real mono PCM16, 24 kHz WAVs from one model
load: female/male in both English locales, then a repeat after changing
voices/locales. Both CPU and CUDA runs produced complete nonempty, readable WAVs
and byte-identical repeats within each backend. Offline transcription matched
all four unique test sentences for each backend. This is a compatibility smoke,
not a broad voice-quality certification or cross-backend determinism promise.

| Run | Model load | Bounded clip generation | Generation/audio ratio |
|---|---:|---:|---:|
| Initial CPU smoke | 1.083 s | 4.24–5.01 s | 1.259–1.447 |
| CUDA smoke | 0.849 s | 0.377–0.526 s | 0.115–0.149 |

CUDA evidence includes actual offload logs and full depthformer/codec execution.
`cuda-results.jsonl`, `cuda-asr.json`, `cuda-build.json` and
`cuda-probe-checks.json` contain results/hashes. The development card was an RTX
2060 SUPER; no provider logic or supported-device allowlist depends on that card.
The isolated build used a hash-verified CUDA 13.4.1 development toolkit, recorded
in `cuda-toolkit.lock.json`. End users do not install that compiler/toolkit.

Negative fixtures rejected control-token input and a one-frame cap without EOS,
with no successful audio publication. GPU model-load cancellation exited in
0.606 s, cancellation at a native frame barrier stopped/reaped in 0.171 s, and
a small TERM-ignoring child fixture was killed/reaped in 1.801 s. These exercise
native lifecycle behavior, not an app's audible-silence or UI-latency measurement.

The probe and raw logs/weights live in
`/home/ubuntu/.cache/plethora/lfm3-spike/`. Source is under `spike/`. CPU results
preceding and during static analysis are retained separately; they are not p95
or isolated hardware benchmark measurements.

## Product integration

The production host is `native/lfm3-host/`, with a portable CPU implementation and
optional GGML backend plugins. Available compatible acceleration is selected at
runtime. The Tauri supervisor is `src-tauri/src/tts/lfm3.rs`; it owns inference
only, serializes work, cancels/reaps children and uses existing bounded WAV
results. It introduces no playback owner or durable audio/cache/job database.

The HF adapter uses the existing manager with a dedicated exact LFM3 contract.
The frontend adapter registers `lfm3` and reuses normal settings, speech cache,
reader and Audio Edition interfaces. These implementation items are verified and
checked off in `tasks.md` as tests complete; source existence alone is not a pass.

## Licensing and platform statements

The model license is separate from llama.cpp's runtime license. The user reports
commercial clearance and will provide its scope; attach that evidence for a
commercial release. Engineering implementation and ordinary model setup do not
need a hardware certification program. No commercial release is performed here.

Desktop runtime builds use normal CPU/Metal/optional CUDA configuration. Web and
mobile targets without a compatible packaged runtime report unavailability and
preserve existing providers. Mac/Windows physical execution is not claimed from
Linux smoke results. Local artifact/build provenance is retained for debugging,
not used to limit the feature to a developer's hardware.
