---
id: scheduler.scoped_params
title: Scoped Retention Overrides
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Deck-level and tag-level retention targets and custom FSRS weight parameters overriding global defaults.
how_to: Open Deck / Tag Settings → Spaced Repetition Parameters. Specify a custom retention target (e.g., 95% for medical exam cards, 80% for trivia).
why: Not all learning materials have equal stakes; high-stakes certifications require near-perfect recall (95%+), while general interest reading is fine at lower retention rates.
aliases:
  - deck parameters
  - per-deck fsrs
  - tag retention
  - custom weights
settings:
  - scopedFsrsOverrides
actions:
  - id: settings.learning.algorithm
    label: Configure Global Parameters
    shortcut: Alt+,
related:
  - scheduler.fsrs
  - scheduler.adaptive
  - library.collection
---

# Scoped Retention Overrides

## Purpose
Allows different decks, tags, and collections to operate under distinct retention targets and custom FSRS optimization weights.

## User-Facing Behavior
- Per-deck and per-tag settings panel with a dedicated Retention Target slider (70% - 97%).
- Optional custom 19-parameter FSRS weight vector box.
- Clear indicator on card review footer showing which scope rule is active (e.g. `Scope: #usmle-step1 (95%)`).

## Exact Behavioral Rules
1. Resolution hierarchy: Card Tag Override > Deck Override > Global Settings.
2. When a card has multiple tags with conflicting overrides, the highest retention target takes precedence.
3. Repetitions compute intervals dynamically using the resolved scope's parameters.

## Rationale
Prevents over-studying trivial facts while ensuring critical professional knowledge receives the necessary repetition frequency.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scopedFsrsOverrides` | `{}` | Map of deckId/tag to custom FSRS parameter configurations |

## Platform Behavior
- **All Platforms**: Evaluated instantaneously at review time via `src/utils/fsrsScope.ts`.
