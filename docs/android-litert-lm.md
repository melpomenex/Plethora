# LiteRT-LM / on-device generative packs (OpenSpec H)

Status: **spike notes only**. No generative LLM is shipped.

## Memory (device / emulator)

- Treat **6 GB RAM + accelerator** as the floor for offering a generative pack
  (`classifyDeviceAiTier` → `gen`). Below that, only embeddings.
- Do not run a multi-GB decode on API 24–30 emulators; they OOM.
- Hello-path on a supported device: load tokenizer + 1 token greedy decode,
  log RSS before/after, then unload. Record numbers in this file when a
  licensed artifact exists.

### Hello-path without a licensed file

`LocalModelProvider` refuses generation unless `mayShipGenerativePack` is true
for a registry row. A LiteRT-LM probe should:

1. Resolve the licensed artifact path (empty → **no-op**, log `license_missing`, do not download).
2. If present, load tokenizer, greedy-decode **one** token, log RSS delta, unload.
3. Never ship an unlicensed multi-GB pack at install time.

This environment has no licensed file and no device, so task 3 stays open.

## Play Feature Delivery

`plugins/plethora-android-genai/android/play-ai-packs.gradle.kts` is an
**opt-in** skeleton (`-Pplethora.playAiPacks=true`). Default is off so install
size does not grow.

## EmbeddingGemma

Stays on the existing genai downloader. Not migrated to Play AI packs in v1.
