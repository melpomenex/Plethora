---
id: audio.hands_free_study
title: Hands-Free Headphone Study Actions
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Configurable headphone multi-click triggers remapping Next/Prev buttons to "Save Extract", "Replay Sentence", or "Ask Plethora".
how_to: Open Settings → Hands-Free Audio. Configure your preferred actions for Headphone Double-Click and Triple-Click.
why: When walking or exercising, reaching for a phone or keyboard to capture an insight disrupts momentum; headphone button remapping enables instant extract capture.
aliases:
  - headphone shortcuts
  - airpods gestures
  - hands free extract
  - earbud buttons
settings:
  - audio.headphone.doubleClickAction
  - audio.headphone.tripleClickAction
actions:
  - id: settings.audio.hands_free
    label: Configure Headphone Actions
    shortcut: Alt+,
related:
  - audio.media_controls
  - review.audio_review
  - queue.extract_chain
---

# Hands-Free Headphone Study Actions

## Purpose
Allows learners to actively capture knowledge and control study sessions through physical or touch buttons on Bluetooth earbuds and headphones.

## User-Facing Behavior
- Remaps headphone remote buttons to study actions:
  - **Single Click**: Play / Pause.
  - **Double Click**: Save currently spoken sentence as an Extract (plays subtle confirmation chime).
  - **Triple Click**: Replay previous paragraph or trigger Socratic explanation.
  - **Long Press**: Open Ask Plethora voice query.

## Exact Behavioral Rules
1. Intercepts media key double/triple click events within a 400ms multi-tap time window.
2. When "Save Extract" is triggered, captures the active spoken sentence and surrounding paragraph into a new extract.
3. Audio confirmation tone plays in ear to verify successful capture without looking at the screen.

## Rationale
Turns passive audio listening into high-yield active learning without requiring visual screen contact.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `audio.headphone.doubleClickAction` | `"save-extract"` | Action triggered on headphone double-click |
| `audio.headphone.tripleClickAction` | `"replay-passage"` | Action triggered on headphone triple-click |

## Platform Behavior
- **All Platforms**: Works with Apple AirPods, Sony WH/WF series, Bose, Galaxy Buds, and standard Bluetooth remotes.
