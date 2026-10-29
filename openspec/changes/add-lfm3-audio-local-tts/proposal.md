## Why

Add LFM3-Audio as another optional local TTS provider in Plethora. Users should
choose it in the existing speech settings, download its model, preview a voice
and use the same read-aloud controls they already know. The feature serves the
app's users across supported platforms; one developer's GPU is a test device,
not a product requirement.

## What Changes

- Register **LFM3 (On-device)** in the existing provider registry, defaults,
  settings and provider catalog, preserving current provider selections.
- Offer the model download through the existing Hugging Face manager, with the
  complete verified backbone/projector pair and licensing information.
- Add a small native llama.cpp/libmtmd host and Tauri adapter for real local WAV
  synthesis, warm model reuse, cancellation and ordinary resource cleanup.
- Build on the same portable runtime for desktop CPU, Metal and optional CUDA.
  Select available acceleration automatically; availability reflects the runtime
  and model installation, with no GPU-model allowlist or device certification.
- Reuse the existing speech cache, reader, preview and Audio Edition dispatch.
  Add only the contract fields and fixes needed for this provider.
- Add focused provider/native/settings regression tests, existing required local
  checks, and a real-model smoke on available hardware.

## Capabilities

### New Capabilities

- `local-lfm3-tts`: Optional local provider, portable native runtime, complete
  artifact compatibility, cancellation and honest availability/capabilities.

### Modified Capabilities

- `hf-model-manager`: LFM3 model pair detection, verified installation and native
  runtime metadata through the existing manager.
- `tts-settings-management`: Provider, model, voice, language and preview controls
  with backward-compatible settings and Settings search coverage.
- `document-tts-sync`: Existing read-aloud start/stop/seek behavior works with the
  LFM3 adapter without introducing a new playback owner.
- `audio-edition-generation`: LFM3 participates in the existing provider dispatch
  where exportable WAV synthesis is supported.

## Impact

Reuse the provider API/registry, TTS settings/catalog/search, HF adapters/manager,
Tauri sidecar/build mechanisms and current reader/cache/edition consumers. Native
execution is portable source code; local validation on an RTX 2060 SUPER does not
limit supported users to that GPU. Desktop builds may provide CPU, Metal or CUDA
as appropriate. Web/mobile targets without a packaged compatible runtime show
LFM3 as unavailable while preserving the saved preference and other providers.
No claim of native mobile execution is made by adding a desktop sidecar.

Existing providers, global playback rollout and Audio Edition storage behavior
retain their existing contracts. A global audio-owner extraction, crash-durable
edition job system, native cache database, streaming PCM transport, extensive
hardware benchmark/certification matrix and new export/training features are
separate work. They are not dependencies of adding this TTS option.

The exact runtime/model inputs and useful smoke evidence are already recorded in
`research.md` and `evidence/`. The original broader scope is retained under
`evidence/initial-scope/` for provenance. Commercial distribution still observes
the model/runtime terms; the user reports clearance and its scope is pending.
