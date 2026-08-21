---
id: reader.selection.actions
title: Selection Action Bar
domain: reading
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Floating contextual toolbar on text selection providing 1-click Highlight, Extract, Learn This flashcard generation, Dictionary Peek, and AI Explanations.
how_to: Select any passage of text in any reader. The floating action bar appears anchored directly above the selection.
why: Lowers interaction cost to zero for turning raw reading material into permanent spaced repetition memory items.
aliases:
  - text selection
  - extract bar
  - highlight toolbar
  - learn this button
settings:
  - viewer.selection.showToolbar
  - viewer.selection.quickExtractShortcut
actions:
  - id: action.review.flashcard_studio
    label: Open Flashcard Studio
    shortcut: Cmd+N
related:
  - queue.extract_chain
  - ai.learn_this
  - language.dictionary_peek
---

# Selection Action Bar

## Purpose
Acts as the primary conversion hub turning passive reading text into active learning items (extracts, clozes, Q&A flashcards, dictionary lookups).

## User-Facing Behavior
- Appears smoothly when the user finishes selecting text with mouse or touch.
- Features quick-action buttons:
  - **Highlight** (Color picker with 6 curated palette colors).
  - **Extract** (Creates a child incremental reading item).
  - **Learn This** (Generates structured flashcards via AI).
  - **Dictionary Peek** (Instant definition, pronunciation, and lexical info).
  - **Ask AI** (Contextual question answering on selected text).

## Exact Behavioral Rules
1. Automatically computes viewport positioning to prevent clipping off top/bottom screen edges.
2. Selection metadata (exact quote, page number, CFI, character offsets) is captured in the created item.
3. Automatically clears selection after action execution unless configured otherwise.

## Rationale
In SuperMemo-style incremental reading, extracting high-value nuggets is the central habit. An instant, anchored action bar minimizes friction.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.selection.showToolbar` | `true` | Show floating toolbar on selection |
| `viewer.selection.autoCopy` | `false` | Automatically copy selected text to system clipboard |

## Platform Behavior
- **Desktop**: Fast keyboard shortcuts (`Cmd+E` extract, `Cmd+H` highlight).
- **Mobile**: Touch callout menu optimized for thumb reach.
- **E-ink**: High-contrast outline buttons with no transparency.
