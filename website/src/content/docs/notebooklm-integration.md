---
title: "NotebookLM Py AppImage Integration"
description: "Local Python sidecar integration connecting Google NotebookLM source ingestion, document grounding, and audio overview podcast import."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux"]
keywords: ["notebooklm","google notebooklm","audio overview","python sidecar"]
aliases: ["notebooklm","google notebooklm","audio overview","python sidecar"]
relatedDocs: ["ai.task_router","ai.library_rag","podcast.whisper"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/notebooklm-integration.md"
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