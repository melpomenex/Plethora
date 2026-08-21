---
id: review.flashcard_studio
title: Flashcard Studio (Q/A, Cloze)
domain: review
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Comprehensive card authoring studio supporting Basic Q/A, Cloze deletion {{c1::answer}}, Multiple Choice, and Matching cards with rich media.
how_to: Press Cmd+N or click "+ New Flashcard" in any view to open Flashcard Studio. Choose card type, enter prompts, and save.
why: High-quality flashcard formulation following the 20 Rules of Formulating Knowledge is essential for long-term memory formation.
aliases:
  - create flashcard
  - cloze editor
  - card studio
  - flashcard maker
settings:
  - review.defaultCardType
  - review.autoGenerateBack
actions:
  - id: action.review.flashcard_studio
    label: Open Flashcard Studio
    shortcut: Cmd+N
related:
  - review.image_occlusion
  - ai.learn_this
  - review.source_provenance
---

# Flashcard Studio (Q/A, Cloze)

## Purpose
Provides a full-featured modal card authoring environment with live formatting preview, LaTeX math support, audio recording, and Cloze deletion helpers.

## User-Facing Behavior
- Card type selector tab bar: Basic Q/A, Cloze Deletion, Multiple Choice, Definition Match.
- Toolbar buttons for bold, italic, code, math formulas (`$...$`), and Cloze creation (`{{c1::...}}`).
- Live side-by-side flip preview displaying front and back appearances.
- Deck and tag picker with autocomplete.

## Exact Behavioral Rules
1. Validates Cloze syntax using `cardValidator.ts`, ensuring numbered cloze groups (c1, c2, etc.) are well-formed.
2. Supports rich text formatting and automatic image pasting from clipboard.
3. Attaches document and extract provenance metadata when opened from reader context.

## Rationale
Formulating concise, unambiguous minimum-information items prevents memory interference and guarantees swift reviews.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.defaultCardType` | `"cloze"` | Default card type when opening Flashcard Studio |

## Platform Behavior
- **Desktop**: Full keyboard shortcuts (`Alt+Shift+C` insert Cloze).
- **Mobile**: Touch-optimized editing keyboard bar.
