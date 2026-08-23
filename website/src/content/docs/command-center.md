---
title: "Global CommandCenter (Cmd+K)"
description: "Unified global palette combining app navigation, action execution, full-text library search, URL ingestion, and Ask Plethora help."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["command palette","global search","quick switcher","cmd k","search library"]
aliases: ["command palette","global search","quick switcher","cmd k","search library"]
relatedDocs: ["palette.contextual_actions","graph.knowledge_sphere","reader.selection.actions"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/search/command-center.md"
---
# Global CommandCenter (Cmd+K)

## Purpose
Acts as the central nervous system of Plethora, providing a single high-speed modal overlay for navigation, action dispatch, full-text search, and product help.

## User-Facing Behavior
- Opens instantly on `Cmd+K` / `Ctrl+K`.
- Features unified multi-entity search:
  - App navigation ("Go to Dashboard", "Open Settings").
  - Document & Extract content matching with highlighted quote excerpts.
  - Video & Podcast audio transcript search with timestamped jump points.
  - URL detection (pasting a URL automatically converts into an import action).
  - Prefix support: `?` forces Ask Plethora help mode.

## Exact Behavioral Rules
1. Uses client-side token extraction, stopword filtering, and BM25 relevance scoring.
2. Grouped results show one primary card per document with expandable secondary hit matches.
3. Arrow keys navigate results; `Enter` executes action or navigates to the exact quote offset in reader.

## Rationale
Reduces interaction latency to near zero. A learner can find any idea across thousands of books in under 2 seconds.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `search.includeTranscripts` | `true` | Search inside video and podcast transcripts |

## Platform Behavior
- **Desktop**: Full keyboard focus and shortcut hints.
- **Mobile**: Dedicated search icon in top app bar.
- **E-ink**: High-contrast list styling with clean selection indicators.