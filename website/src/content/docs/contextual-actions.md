---
title: "Per-View Contextual Actions"
description: "Dynamic command palette action sets prioritized and tailored to match the currently active tab (PDF, EPUB, RSS, Podcast, Audiobook)."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["contextual commands","view actions","tab actions","dynamic palette"]
aliases: ["contextual commands","view actions","tab actions","dynamic palette"]
relatedDocs: ["palette.command_center","reader.pdf.page_mode","rss.feed_reader"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/search/contextual-actions.md"
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