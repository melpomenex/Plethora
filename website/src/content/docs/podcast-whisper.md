---
title: "Podcast Search & Local Whisper"
description: "Apple Podcasts directory search, background episode downloading, and local Whisper speech-to-text transcription with timestamped extracts."
category: "rss-and-podcasts"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["podcast player","whisper transcription","apple podcasts","podcast transcript"]
aliases: ["podcast player","whisper transcription","apple podcasts","podcast transcript"]
relatedDocs: ["audio.media_controls","reader.video.transcript","language.shadowing"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/media/podcast-whisper.md"
---
# Podcast Search & Local Whisper

## Purpose
Turns audio podcast listening into an active learning medium by generating timestamped transcripts and allowing full-text search across spoken audio.

## User-Facing Behavior
- Search and subscribe to millions of shows via the Apple Podcasts directory.
- Built-in audio player with variable speed (0.5x - 3.0x), silence skipping, and sleep timer.
- Live scrolling transcript: click any word or sentence to seek audio playback immediately.
- Select transcript text to generate study flashcards with embedded audio clips.

## Exact Behavioral Rules
1. Transcribes downloaded MP3 audio using local Whisper engine (`whisper.cpp` / Vulkan / CoreML).
2. Segment timestamps are aligned and saved in SQLite for instant full-text search in CommandCenter (Cmd+K).
3. Background downloads and transcriptions queue automatically when connected to Wi-Fi.

## Rationale
Extracting quotes and actionable takeaways from long podcasts is nearly impossible without searchable text. Synchronized transcripts bridge listening and reading.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `podcast.whisperModel` | `"base.en"` | Local Whisper model size (tiny, base, small, medium) |

## Platform Behavior
- **macOS**: Accelerated via Apple Neural Engine / Metal.
- **Windows / Linux**: Accelerated via Vulkan / CUDA.
- **Android**: Fast Sherpa-ONNX speech recognition runtime.