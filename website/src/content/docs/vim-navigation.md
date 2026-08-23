---
title: "Vim Reading Navigation"
description: "Modal keyboard-driven navigation (j/k scrolling, gg/G document bounds, / in-page search, f link hints) for mouse-free reading."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux"]
keywords: ["vim mode","keyboard navigation","modal reading","vimium shortcuts"]
aliases: ["vim mode","keyboard navigation","modal reading","vimium shortcuts"]
relatedDocs: ["reader.pdf.scroll_mode","reader.markdown.native","palette.command_center"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/vim-navigation.md"
---
# Vim Reading Navigation

## Purpose
Provides full modal keyboard navigation across all document viewers, reading queues, and review screens without lifting hands from home row.

## User-Facing Behavior
- Displays a minimalist modal status indicator ("NORMAL" / "SEARCH") in the viewer bottom bar.
- Navigation shortcuts: `j`/`k` (scroll down/up), `d`/`u` (half page), `gg`/`G` (top/bottom).
- `/` triggers quick in-document search; `n`/`N` cycles matches.
- `f` generates two-letter visual hint labels over all clickable links and citations.

## Exact Behavioral Rules
1. Keystrokes are intercepted at the window capture phase when input elements are not focused.
2. Pressing `Escape` cancels search mode or hint overlay and returns to Normal mode.
3. Vim mode state is preserved globally across tabs.

## Rationale
Fast incremental reading demands switching between dozens of documents per hour. Home-row navigation removes mechanical friction and speeds up review flow.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `general.vimModeEnabled` | `false` | Enable Vim modal navigation by default |
| `general.vimScrollStep` | `60` | Pixels per j/k keypress |

## Platform Behavior
- **Desktop (macOS / Win / Linux)**: Full keyboard keymap bindings.
- **Mobile**: Disabled on touch-only devices without physical hardware keyboard attached.