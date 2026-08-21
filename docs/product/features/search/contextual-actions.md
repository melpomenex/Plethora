---
id: palette.contextual_actions
title: Per-View Contextual Actions
domain: search
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Dynamic command palette action sets prioritized and tailored to match the currently active tab (PDF, EPUB, RSS, Podcast, Audiobook).
how_to: Press Cmd+K while reading a PDF or listening to a podcast. Contextual actions for that specific view appear at the top of the palette.
why: General commands crowd out specific view operations; contextual actions surface high-relevance operations (like "Zoom In", "Toggle TOC", "Mark Read") instantly.
aliases:
  - contextual commands
  - view actions
  - tab actions
  - dynamic palette
settings:
  - palette.prioritizeContextualActions
actions:
  - id: action.search.command_center
    label: Open Contextual Actions
    shortcut: Cmd+K
related:
  - palette.command_center
  - reader.pdf.page_mode
  - rss.feed_reader
---

# Per-View Contextual Actions

## Purpose
Dynamically tailors the command palette's action inventory to match the exact context and document format of the active workspace tab.

## User-Facing Behavior
- When opening `Cmd+K` in a PDF viewer, top actions include: "Search in Document", "Next Page", "Toggle TOC", "Zoom In", "Create Extract".
- In RSS view: "Mark Current Read", "Toggle Star", "Open Original", "Refresh Feed".
- In Podcast view: "Play / Pause", "Skip 10s", "Toggle Transcript".
- Displays current keyboard shortcut hints beneath action titles.

## Exact Behavioral Rules
1. Resolves active tab type and `viewerKind` via `contextualActions.ts`.
2. Dispatches selected actions over typed `palette-action` window events directly to the active view's registered event listener.
3. Ranks contextual actions above global application navigation (score 0.95 vs 0.80).

## Rationale
Maintains a compact, clean interface without cluttering toolbars with dozens of niche buttons.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `palette.prioritizeContextualActions` | `true` | Show view-specific actions first in empty palette |

## Platform Behavior
- **All Platforms**: Zero-overhead in-memory resolver with type-safe dispatch IDs.
