---
id: import.supermemo_zip
title: SuperMemo XML/ZIP Import
domain: imports
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Ingests SuperMemo 15/16/18 XML element exports, preserving tree hierarchy, extract chains, repetition dates, and A-Factors.
how_to: Export your SuperMemo collection as XML, then import via Settings → Import → SuperMemo XML.
why: SuperMemo is the historical pioneer of incremental reading; Plethora provides a modern cross-platform home for SuperMemo collections with zero data loss.
aliases:
  - supermemo import
  - sm18 import
  - supermemo xml
  - element tree import
settings:
  - import.supermemo.preserveHierarchy
actions:
  - id: action.queue.open
    label: View Imported Queue
    shortcut: Alt+Q
related:
  - scheduler.sm18
  - queue.extract_chain
  - queue.priority_score
---

# SuperMemo XML/ZIP Import

## Purpose
Provides comprehensive import support for SuperMemo 15/16/17/18 collections, maintaining parent-child concept hierarchies and exact repetition histories.

## User-Facing Behavior
- Ingests XML element trees, HTML components, image files, and sound snippets.
- Preserves the entire hierarchical folder structure as Plethora Collections.
- Maps SuperMemo Articles, Extracts, and Items into Plethora incremental reading nodes.

## Exact Behavioral Rules
1. Translates SuperMemo repetition records (reps, lapses, interval, A-Factor, U-Factor) to the native SM-18 engine tables.
2. Extracts embedded references (`#Title:`, `#Author:`, `#Source:`) into document provenance metadata.
3. Automatically sets priority scores from SuperMemo percentage ranks (0.00% to 100.00%).

## Rationale
Long-time SuperMemo power users maintain knowledge bases spanning decades. Preserving their learning investments allows them to study on modern macOS, Linux, and mobile devices.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `import.supermemo.preserveHierarchy` | `true` | Mirror SuperMemo knowledge tree in Plethora collections |

## Platform Behavior
- **Desktop**: Direct XML stream parser handling multi-gigabyte collections efficiently.
