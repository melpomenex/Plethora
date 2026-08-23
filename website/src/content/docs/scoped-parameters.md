---
title: "Scoped Retention Overrides"
description: "Deck-level and tag-level retention targets and custom FSRS weight parameters overriding global defaults."
category: "scheduling-and-algorithms"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["deck parameters","per-deck fsrs","tag retention","custom weights"]
aliases: ["deck parameters","per-deck fsrs","tag retention","custom weights"]
relatedDocs: ["scheduler.fsrs","scheduler.adaptive","library.collection"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/scheduling/scoped-parameters.md"
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