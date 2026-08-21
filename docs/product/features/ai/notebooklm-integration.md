---
id: ai.notebooklm
title: NotebookLM Py AppImage Integration
domain: ai
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Local Python sidecar integration connecting Google NotebookLM source ingestion, document grounding, and audio overview podcast import.
how_to: Open the NotebookLM tab in Plethora. Link your local NotebookLM workspace to sync sources and download synthetic Audio Overviews.
why: Google NotebookLM excels at multi-document synthesis and two-host audio podcasts; Plethora integrates these assets directly into the incremental reading queue.
aliases:
  - notebooklm
  - google notebooklm
  - audio overview
  - python sidecar
settings:
  - notebooklm.sidecarPath
  - notebooklm.autoSyncAudioOverviews
actions:
  - id: action.search.command_center
    label: Open NotebookLM Tab
    shortcut: Cmd+K
related:
  - ai.task_router
  - ai.library_rag
  - podcast.whisper
---

# NotebookLM Py AppImage Integration

## Purpose
Integrates Google NotebookLM's multi-document reasoning and AI-generated "Deep Dive" audio podcast overviews into Plethora's local workspace.

## User-Facing Behavior
- Dedicated NotebookLM workspace tab.
- Ingests multiple PDF/EPUB library sources into NotebookLM notebook containers.
- 1-click download and import of generated 10-15 minute conversational Audio Overviews directly into Plethora Podcasts.
- Generates synchronized Whisper transcripts for the downloaded audio discussions.

## Exact Behavioral Rules
1. Manages a local Python AppImage sidecar executable communicating over JSON-RPC.
2. Ingests source documents without sending unapproved personal library folders.
3. Automatically creates extract citations linked to the NotebookLM audio timeline.

## Rationale
Combines NotebookLM's world-class synthetic audio generation with Plethora's incremental reading and spaced repetition retention tools.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `notebooklm.autoSyncAudioOverviews` | `true` | Automatically transcribe and import generated audio deep dives |

## Platform Behavior
- **Desktop (macOS / Linux / Windows)**: Runs local Python sidecar process.
