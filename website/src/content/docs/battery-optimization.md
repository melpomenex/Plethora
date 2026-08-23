---
title: "Battery & Thermal Optimization"
description: "Intelligent hardware throttling disabling 3D WebGL animations and deferring heavy Whisper/Vector indexing when on battery power or high thermal load."
category: "platforms-and-devices"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android"]
keywords: ["battery saver","power management","thermal throttling","energy optimization"]
aliases: ["battery saver","power management","thermal throttling","energy optimization"]
relatedDocs: ["platform.desktop_native","graph.knowledge_sphere","podcast.whisper"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/platform/battery-optimization.md"
---
# Battery & Thermal Optimization

## Purpose
Monitors device battery status and CPU/GPU thermal load to automatically pause heavy background indexing tasks and conserve energy on laptops and mobile devices.

## User-Facing Behavior
- Displays a subtle power-saver badge in the status bar when battery conservation is active.
- Background tasks (e.g. bulk Whisper podcast transcription, vector re-indexing) are queued and run when plugged into wall power.
- 3D Knowledge Sphere automatically drops frame rate to 30 FPS when on battery power.

## Exact Behavioral Rules
1. Queries OS battery state through Rust `battery.rs` backend.
2. If device is on battery and charge drops below 20%, all background ML jobs pause automatically.
3. Resumes immediately upon plugging into AC power.

## Rationale
Learners studying in libraries, coffee shops, or airplanes need long battery endurance without premature shutdown.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `performance.pauseHeavyJobsOnBattery` | `true` | Defer heavy background audio transcription when on battery power |

## Platform Behavior
- **macOS / Windows / Linux**: Direct OS power management API integration.
- **Android**: Respects Android Doze mode and system Battery Saver flags.