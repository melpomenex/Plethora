---
title: "Audiobook EPUB Synchronization"
description: "Synchronized playback of professionally narrated M4B/MP3 audiobooks with aligned text highlights in the parallel EPUB reader."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["audiobook sync","whispersync","audiobook text sync","m4b epub sync","narrated book"]
aliases: ["audiobook sync","whispersync","audiobook text sync","m4b epub sync","narrated book"]
relatedDocs: ["reader.epub.cfi","tts.playback","audio.media_controls"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/tts/audiobook-sync.md"
---
# Audiobook EPUB Synchronization

## Purpose
Merges professionally recorded human narration audiobooks (`.m4b`, `.mp3`) with digital e-books (`.epub`), providing synchronized text following and extract creation.

## User-Facing Behavior
- Displays dual-pane or stacked interface: interactive e-book reader alongside rich audiobook player.
- As the narrator speaks, text highlights and pages advance automatically.
- Clicking any word or sentence in the EPUB immediately seeks the audiobook audio to that precise timestamp.

## Exact Behavioral Rules
1. Performs forced alignment between the audiobook audio track and EPUB text using Whisper transcription and dynamic time warping (DTW).
2. Generates an alignment index mapping each sentence to an audio millisecond range.
3. Allows standard text selection to create extracts, clozes, and flashcards tagged with the narrator audio clip.

## Rationale
Delivers the beloved Kindle/Audible "Immersion Reading" experience locally without proprietary cloud lock-in.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `audiobook.autoHighlightText` | `true` | Highlight EPUB text in sync with audiobook playback |

## Platform Behavior
- **Desktop & Mobile**: Seamless cross-pane synchronization with hardware-accelerated audio decoding.