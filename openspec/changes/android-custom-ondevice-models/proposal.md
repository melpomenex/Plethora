## Why

Gemini Nano availability is fragmented. Some devices can run a **Plethora-managed** embedding model already (EmbeddingGemma ~184 MB via LiteRT). A future optional generative **Plethora Local Model** (LiteRT-LM + Play for On-device AI packs) could serve phones without Nano — but only with honest hardware tiers, licenses, and explicit download UX. Shipping multi-GB models to every install is unacceptable.

## Existing behavior

- EmbeddingGemma download in `EmbeddingSupport.kt` (HF gated → ModelScope mirror, sha256).
- whisper/sherpa model manager; HF speech OpenSpec.
- No LiteRT-LM generative engine, no Play AI packs.

## What Changes

- Define hardware tiers: **gen** (high RAM/NPU/GPU, optional LLM pack), **embed** (current Gemma class), **none**.
- Play for On-device AI is **beta** — use on-demand/fast-follow, never install-time GB. Device targeting by RAM.
- LiteRT-LM Kotlin API as the 2026 custom-LLM path (not abandoned TFLite demos). MediaPipe LLM Inference is not the preferred new path if LiteRT-LM is documented stable.
- License registry: name, version, source, license, attribution, redistribution, commercial-use. No arbitrary HF LLM redistribution.
- UX: size, Wi-Fi preference, progress, cancel, verify, delete, corruption recovery.
- Register as `AIProvider` kind `local-model` (A). Does not replace Nano when Nano is ready unless user pins it.
- **Do not** select a concrete LLM filename in this spec (legal unresolved). Implementation blocked on license review of a candidate.

## Capabilities

### New Capabilities
- `android-custom-models`: tiers, LiteRT-LM provider, AI pack delivery, license tracking, download UX.

## Non-goals

- Bundling a generative LLM in the base APK.
- Running LLMs on low-end devices.
- Replacing AICore Gemini Nano on Pixel-class devices by default.

## Dependencies

A. Coordinate with B: B keeps EmbeddingGemma downloader unless H explicitly migrates it to AI packs in a later task (must not dual-download).

## Expected ownership

**Agent H.** Does not own AppSearch or scanner.
