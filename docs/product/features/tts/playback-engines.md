---
id: tts.playback
title: Multi-Engine Text-to-Speech
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Multi-engine neural TTS supporting offline Rust Pocket TTS on desktop, Sherpa-ONNX on Android, and cloud Fal.ai voice cloning.
how_to: Open any document and press Alt+P (or click the Play icon in reader header). Switch voices or engines in Settings → TTS.
why: Listening while reading doubles reading speed and eliminates eye strain; local neural TTS engines provide instantaneous playback with zero cloud fees.
aliases:
  - tts engines
  - pocket tts
  - sherpa onnx
  - read aloud
  - text to speech
settings:
  - tts.activeEngine
  - tts.playbackSpeed
  - tts.voiceId
actions:
  - id: settings.tts.general
    label: Open TTS Settings
    shortcut: Alt+,
related:
  - tts.word_highlighting
  - tts.auto_scroll
  - audio.media_controls
---

# Multi-Engine Text-to-Speech

## Purpose
Provides natural-sounding neural text-to-speech across all document types, supporting fast on-device inference and high-fidelity cloud voices.

## User-Facing Behavior
- Floating or docked TTS player bar with Play/Pause, speed slider (0.5x - 4.0x), voice selector, and skip sentence buttons.
- Supports background audio playback while switching apps or tabs.
- Automatic sentence chunking with word boundary timestamps.

## Exact Behavioral Rules
1. Engine selection:
   - **Desktop**: Native Rust `pocket_tts.rs` running high-speed neural models locally.
   - **Android**: Sherpa-ONNX / Kokoro-82M native on-device runtime.
   - **Cloud**: Fal.ai, Groq, OpenRouter, and ElevenLabs API integrations.
2. Synthesizes audio in look-ahead sentence buffers to ensure seamless, gapless playback.
3. Automatically pauses playback when headphones are disconnected.

## Rationale
Fast, high-quality audio narration makes textbooks and dense research papers as accessible as audiobooks.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `tts.playbackSpeed` | `1.2` | Playback speed multiplier |
| `tts.activeEngine` | `"pocket-tts"` | Active TTS backend engine |

## Platform Behavior
- **Desktop**: Embedded Rust Pocket TTS inference with AVX2/NEON hardware acceleration.
- **Android**: Native Media3 audio service with lock-screen notification controls.
