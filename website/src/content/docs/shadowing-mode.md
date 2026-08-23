---
title: "Shadowing & Pronunciation"
description: "Audio loop playback of native utterances with synchronized microphone recording, waveform visualizer, and acoustic pitch comparison."
category: "language-learning"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["shadowing","shadowing mode","pronunciation practice","audio shadowing","pitch contour","accent training"]
aliases: ["shadowing","shadowing mode","pronunciation practice","audio shadowing","pitch contour","accent training"]
relatedDocs: ["language.profiles","reader.video.transcript","podcast.whisper"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/language/shadowing-mode.md"
---
# Shadowing & Pronunciation

## Purpose
Provides an interactive speech training environment for practicing real-time shadowing, intonation imitation, and accent correction.

## User-Facing Behavior
- Displays twin waveform visualizers:
  - Top: Native audio reference waveform with pitch contour overlay.
  - Bottom: Your microphone recording waveform.
- Loop playback controls: repeats the target sentence 1 to 5 times.
- Auto-records your repetition when native speech pauses.

## Exact Behavioral Rules
1. Cuts precise audio sub-clips using transcript segment start/end milliseconds.
2. Computes pitch contour (fundamental frequency $F_0$) in real time using Rust audio DSP.
3. Provides a phonetic accuracy score and highlights mispronounced phonemes.

## Rationale
Shadowing builds the motor muscle memory of foreign language articulation by closing the gap between auditory perception and vocal production.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `language.shadowing.loopCount` | `2` | Number of times model audio plays before recording |

## Platform Behavior
- **Desktop & Mobile**: Low-latency WebAudio / native microphone stream processing.