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
   - **Desktop**: Pocket TTS and the optional LFM3 provider run speech locally.
   - **Android**: Sherpa-ONNX / Kokoro-82M native on-device runtime.
   - **Cloud**: Fal.ai, Groq, OpenRouter, and ElevenLabs API integrations.
2. Synthesizes audio in look-ahead sentence buffers to ensure seamless, gapless playback.
3. Automatically pauses playback when headphones are disconnected.

### Optional LFM3 speech

In Settings → TTS, select **LFM3 (On-device)**. Use **Get model** to open the local
model manager, review the license and download the optional model (about 1.4 GB).
The backbone and audio projector install together. Choose Female or Male and a
language, then use the existing preview and reader Play controls. LFM3 also appears
in Audio Edition creation. The selected provider stays selected if setup fails;
Plethora reports the problem instead of sending the text to another provider.

LFM3 works offline after installation. Packaged GPU acceleration is selected
automatically when available; compatible CPU execution is also supported. No
particular GPU model is required. Builds without the desktop runtime report its
absence, and Android/iOS/web builds currently use the other available providers.
Speech quality and speed depend on the device and language. LFM3 produces WAV
audio, has two built-in voices, and does not provide voice cloning or word-level
timing. Stop/skip/close cancels pending local synthesis; subsequent speech reloads
the runtime if cancellation stopped it. Playback speed remains a player control.

LFM3 does not require an API key or a local API server. Audio Edition creation
starts with your selected TTS provider, voice and language. Its visible Narration
provider picker groups on-device and cloud choices, including LFM3. Changes there
apply to that edition. Use Preview voice to check a short passage; More options
contains the controls supported by the chosen provider. Live-only System and
Android voices cannot create an audio file, so choose a file-generating provider
when creating an edition from those settings.

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
