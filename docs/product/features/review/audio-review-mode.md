---
id: review.audio_review
title: Hands-Free Audio Review
domain: review
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Automated voice-guided card study where TTS reads question, pauses for configured recall delay, reads answer, and auto-rates.
how_to: In Review Session, click the Audio Mode button (or press Alt+A). Put on headphones and review cards while walking or commuting.
why: Knowledge workers commute, exercise, and cook; hands-free audio review allows active spaced repetition practice without looking at a screen.
aliases:
  - audio review
  - hands free flashcards
  - voice review
  - headphone study
settings:
  - review.audio.autoFlipDelayMs
  - review.audio.autoRateDefault
actions:
  - id: settings.audio.hands_free
    label: Configure Audio Review Settings
    shortcut: Alt+,
related:
  - tts.playback
  - audio.media_controls
  - review.flashcard_studio
---

# Hands-Free Audio Review

## Purpose
Automates flashcard testing into an interactive voice and audio loop, allowing complete eyes-free, hands-free spaced repetition study.

## User-Facing Behavior
- TTS reads the front (question) of the card aloud.
- Silence timer plays during the configured recall thinking delay (e.g. 4 seconds).
- Audio chime sounds and TTS speaks the back (answer).
- Automatically records a "Good" rating and transitions to the next card, or waits for headphone button input.

## Exact Behavioral Rules
1. Cleans Markdown and HTML markup so TTS speaks only natural plain text and mathematical expressions.
2. Supports OS media key / headphone button interception:
   - Single Click: Pause / Resume.
   - Double Click: Rate Easy (or skip).
   - Triple Click: Rate Again (lapse).
3. Plays distinctive audio earcons for question prompt, answer reveal, and session completion.

## Rationale
Unlocks massive latent study time during daily commutes, jogging, or household chores.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.audio.autoFlipDelayMs` | `4000` | Thinking delay in milliseconds before answer audio plays |
| `review.audio.autoRateDefault` | `"good"` | Grade assigned if no headphone button override is pressed |

## Platform Behavior
- **Desktop & Mobile**: Full OS audio focus and background playback support.
