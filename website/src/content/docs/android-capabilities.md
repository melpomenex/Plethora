---
title: "Android Native Integration"
description: "Storage Access Framework (SAF) folder import, ML Kit GenAI (on-device Gemini Nano), Sherpa-ONNX TTS, and Media3 background audio."
category: "platforms-and-devices"
order: 100
published: true
featureStatus: "shipping"
platforms: ["mobile-android"]
keywords: ["android apk","saf storage","android tts","ml kit gemini","mobile plethora"]
aliases: ["android apk","saf storage","android tts","ml kit gemini","mobile plethora"]
relatedDocs: ["platform.eink","tts.playback","ai.task_router"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/platform/android-capabilities.md"
---
# Android Native Integration

## Purpose
Provides deep Android operating system integration via Tauri 2.0 native plugins, supporting offline storage, background audio, and hardware AI.

## User-Facing Behavior
- Storage Access Framework (SAF) folder binding allows selecting external SD card book directories.
- Foreground Media3 service keeps TTS and podcast playback running smoothly with screen locked.
- Native Android Share Sheet target: share web links directly from Chrome into Plethora reading queue.

## Exact Behavioral Rules
1. Uses `tauri-plugin-os` and custom Android JNI bridges for hardware APIs.
2. Integrates Google ML Kit GenAI for on-device Gemini Nano execution on supported chipsets (e.g. Tensor G3/G4, Snapdragon 8 Gen 3).
3. Adapts UI navigation for touch gestures (edge swipe back/forward, bottom navigation bar).

## Rationale
Ensures mobile learners enjoy the exact same high-powered learning operating system on the train or couch as on desktop workstations.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `platform.android.useMlKit` | `true` | Use on-device Gemini Nano when supported |

## Platform Behavior
- **Android 10+**: Full scoped storage compliance and background audio focus handling.