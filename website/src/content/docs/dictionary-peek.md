---
title: "Dictionary Peek Card"
description: "Instant popover definition, IPA phonetics, native audio pronunciation, and example sentences for clicked foreign words."
category: "language-learning"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["dictionary popup","word definition","lookup word","ipa pronunciation"]
aliases: ["dictionary popup","word definition","lookup word","ipa pronunciation"]
relatedDocs: ["language.vocabulary","language.sentence_mining","reader.selection.actions"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/language/dictionary-peek.md"
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