# LiteRT-LM / on-device generative packs (OpenSpec H)

Status: **spike notes only**. No generative LLM is shipped.

## Memory (device / emulator)

- Treat **6 GB RAM + accelerator** as the floor for offering a generative pack
  (`classifyDeviceAiTier` → `gen`). Below that, only embeddings.
- Do not run a multi-GB decode on API 24–30 emulators; they OOM.
- Hello-path on a supported device: load tokenizer + 1 token greedy decode,
  log RSS before/after, then unload. Record numbers in this file when a
  licensed artifact exists.

## Play Feature Delivery

`plugins/plethora-android-genai/android/play-ai-packs.gradle.kts` is an
**opt-in** skeleton (`-Pplethora.playAiPacks=true`). Default is off so install
size does not grow.

## EmbeddingGemma

Stays on the existing genai downloader. Not migrated to Play AI packs in v1.
