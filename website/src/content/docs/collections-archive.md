---
title: "Collections & Folder Archives"
description: "Hierarchical folder collections, bulk tagging, filtering, and `.plethora-collection` archive export/import."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["folders","document organization","plethora collection","library tags"]
aliases: ["folders","document organization","plethora collection","library tags"]
relatedDocs: ["import.local_files","queue.composition","graph.knowledge_sphere"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/collections-archive.md"
---
# Collections & Folder Archives

## Purpose
Provides flexible hierarchical organization, bulk metadata management, and portable archive sharing for your entire learning library.

## User-Facing Behavior
- Sidebar tree displaying custom folder hierarchies and smart filtered views.
- Drag-and-drop organization for single documents or multi-selection batches.
- Multi-tag assignment with color badges.
- One-click export to `.plethora-collection` format containing documents, extracts, and cards.

## Exact Behavioral Rules
1. Collections are virtual organizational containers; documents can belong to multiple collections simultaneously.
2. Deleting a collection does not delete the underlying documents unless explicitly chosen.
3. Exported `.plethora-collection` archives are standard zip bundles containing encrypted metadata and asset folders.

## Rationale
Enables structured academic course organization, syllabus sharing with classmates, and modular topic backups.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `library.defaultSort` | `"recently-added"` | Default library sorting order |

## Platform Behavior
- **Desktop & Mobile**: Shared tree structure synced across devices via encrypted delta logs.