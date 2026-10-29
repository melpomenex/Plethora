## Context

The user clarified that this change is one additional TTS option for Plethora's
users, not a redesign of the speech/audio subsystem or a product tied to a
particular GPU. Existing providers already supply registry dispatch, settings,
preview, read-aloud, cache and Audio Edition integration. Reuse those paths.

## Goals / Non-Goals

**Goals:** optional LFM3 selection; straightforward model download; two built-in
voices and documented language choices; actual offline speech; available GPU
acceleration selected automatically; CPU portability; responsive cancellation;
backward-compatible settings and provider behavior.

**Non-goals:** global-player migration, durable edition-job/storage redesign,
second cache/player/model manager, hardware certification, benchmark-driven
feature tiers, mandatory device allowlists, PCM streaming, voice cloning/training,
new OCR or export formats. Unsupported native targets remain unavailable honestly.

## Decisions

### D1. Small portable native host

Use pinned llama.cpp/libmtmd and its TTS template, depthformer and codec helpers.
The existing smoke proved real 24 kHz speech from the pinned pair. Keep one loaded
model per host and reset recurrent/KV, sampling and codec state per utterance.
Serialize bounded requests; stop/cancel/unload retire obsolete work and release
resources. A process boundary allows a stuck native operation to be terminated
without killing Tauri. Reuse Tauri command/sidecar patterns and existing WAV/file
handling; no Python environment, HTTP inference server or WebView inference.

The host source and build recipe work on supported desktop targets. CPU is the
portable baseline; Metal and CUDA are build/backend capabilities. Auto-select an
available supported backend and report the effective choice. Hardware facts help
diagnose availability; they do not create an RTX/M4 model-specific product gate.
A local SM 7.5 probe is development evidence only. End users install packaged
runtime artifacts and model data, not developer compilers/toolkits.

Use bounded private control messages and canonical app-managed model/output
paths. Return a bounded WAV result through the existing adapter shape, not a new
native asset/cache persistence subsystem. Reject unsupported model pipelines,
control-token injection, oversized input and output without valid termination.
Keep logs free of user text. A default model instance is shared by ordinary
reading/preview calls; concurrent reader prefetch must queue rather than cancel
an unrelated valid request. Cancellation has request identity and a kill/reap
fallback. Reuse existing focus and stale-media protections.

### D2. Existing HF installation

Add a dedicated LFM3 runtime/run contract rather than misclassifying GGUF as
sherpa. Start with the exact Q4_K_M backbone and Q8_0 projector at the immutable
revision in `research.md`, including hashes and combined size. Reuse artifact
files, containment validation, download progress/cancel/hash verification and
registration. A missing/wrong projector cannot become a runnable installation.
Keep existing model IDs/contracts compatible. Do not add a generic quantization
variant registry before another supported variant needs it.

Uninstall must not delete files while the LFM3 host uses them: unload or return a
clear in-use state. Existing generated audio does not require installed weights.
Runtime availability and model installation are separate diagnostics. Show the
pinned model terms for download; preserve notices. Commercial clearance is a
release matter, separate from implementing the provider.

### D3. Normal provider adapter

Register `lfm3` with label **LFM3 (On-device)**, local kind and no authentication.
Expose female/male base voices and documented upstream locales, explicitly mapping
`en-US` to `en` and `en-GB` to `en-gb`. WAV is 24 kHz mono. Do not advertise cloning,
style prompts, measured word timing or synthesis speed. Existing player speed
remains a playback concern. Missing runtime/model returns a local actionable
error; it never silently dispatches System or a cloud provider.

Extend shared provider fields only when required (for example optional language
and AbortSignal). Preserve other adapters. Cache identity includes immutable
model/runtime profile, voice, locale and speech text; LFM3 cannot hit a legacy key
that omits its locale. Reuse the current bounded clip cache and result shape.
Deduplicated consumers cancel independently and stop native production when the
last consumer withdraws. Do not build a native cache database for this change.

### D4. Settings and existing consumers

Add provider-scoped defaults without changing the user's selection. Validate
LFM3 voice/locale independently of Fal language migration. Reuse current model,
voice and preview controls. Add stable Settings search target IDs/catalog/coverage
for new meaningful groups/controls, reusing existing shared-control targets.

The normal `generateSpeech`/registry path serves Settings preview and reading.
Use existing input segmentation, start anchors, playback lifecycle and focus.
Audio Edition provider enumeration/dispatch accepts LFM3 WAVs through the same
adapter; this change does not promise to repair existing edition durability.
No reader ownership extraction or global rollout toggle is needed.

### D5. Focused verification and packaging

Before provider integration, confirm the full native audio pipeline with the
pinned model on available hardware. CPU and GPU smoke results are development
checks, not hardware qualification. Then verify native protocol bounds,
load/reuse/cancel/unload, wrong/missing model handling, provider settings/cache
identity and existing-provider regressions with deterministic tests.

Build/package runtime resources for normal desktop targets using existing
sidecar tooling. Runtime probes, rather than named GPU whitelists, determine
whether a build can execute locally. Unbuilt/unsupported targets report that
state; platform build validation does not require owning a device matrix before
writing the portable integration. Run applicable type/lint/build, Settings search,
script and `bench:check` gates. Do not claim untested platform execution.

## Migration Plan

Additive provider/default/config and HF contract changes preserve existing
selections and serialized models. LFM3 remains opt-in and its weights are optional.
Device-local runtime/install state does not become a synced preference. Preserve
current playback/cache/edition storage semantics and existing platform providers.
