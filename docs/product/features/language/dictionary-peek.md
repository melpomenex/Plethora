---
id: language.dictionary_peek
title: Dictionary Peek Card
domain: language
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Instant popover definition, IPA phonetics, native audio pronunciation, and example sentences for clicked foreign words.
how_to: Click any foreign word in a reader or press Shift while hovering. The Dictionary Peek popover appears instantly.
why: Looking up words in external dictionary apps takes 10+ seconds and ruins reading immersion; instant in-place dictionary peek takes <100ms.
aliases:
  - dictionary popup
  - word definition
  - lookup word
  - ipa pronunciation
settings:
  - language.peekOnHover
  - language.autoPlayPronunciation
actions:
  - id: action.language.dictionary
    label: Open Full Dictionary
    shortcut: Alt+L
related:
  - language.vocabulary
  - language.sentence_mining
  - reader.selection.actions
---

# Dictionary Peek Card

## Purpose
Provides instantaneous, zero-latency in-context dictionary definitions and pronunciations without navigating away from the reading surface.

## User-Facing Behavior
- Floating popover showing:
  - Root lemma and part of speech.
  - Definition in target or native language.
  - IPA phonetics and pitch accent indicator.
  - Speaker icon playing native audio pronunciation.
  - One-click "Mine Sentence" button to create a study card.

## Exact Behavioral Rules
1. Searches offline SQLite dictionary databases (EPWING, Yomichan/JMdict, FreeDict, StarDict).
2. Falls back to online dictionary APIs when offline definitions are missing.
3. Automatically logs the lookup event into vocabulary study history.

## Rationale
Eliminates context-switching overhead. Maintaining reading flow is vital for language fluency development.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `language.peekOnHover` | `false` | Trigger peek on hover (default requires click or modifier key) |

## Platform Behavior
- **Desktop & Mobile**: Supports touch tap and keyboard navigation.
- **E-ink**: High-contrast dialog with solid borders and crisp text.
