---
title: "Incremental Reading Extract Chain"
description: "Hierarchical extract lineage preserving parent document provenance, priority inheritance, and reading position across generations."
category: "understand-and-extract"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["extract lineage","incremental reading extracts","parent child extracts","provenance chain"]
aliases: ["extract lineage","incremental reading extracts","parent child extracts","provenance chain"]
relatedDocs: ["reader.selection.actions","queue.extract_lifecycle","review.source_provenance"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/queue/extract-chains.md"
---
# Incremental Reading Extract Chain

## Purpose
Preserves the full genealogical hierarchy of incremental reading extracts, tracing every concise memory item back to its original source book and chapter.

## User-Facing Behavior
- Creating an extract displays a breadcrumb trail: `[Book Title] › [Chapter 3 Extract] › [Key Quote]`.
- Clicking the source breadcrumb opens the parent document directly to the exact page and highlight location.
- Extract children automatically inherit parent tags, collection assignments, and priority scores.

## Exact Behavioral Rules
1. Extracts store `parentId`, `documentId`, `sourceOffset`, and `quoteText`.
2. Modifying a parent document does not alter or corrupt previously spawned extract text.
3. Deleting a parent document prompts whether to orphan, archive, or delete descendant extracts.

## Rationale
Prevents context loss. When reviewing a flashcard or extract months later, the learner can instantly jump back into the full source context to re-ground understanding.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `extracts.inheritTags` | `true` | Child extracts automatically inherit parent document tags |

## Platform Behavior
- **Cross-Platform**: Tree traversal and provenance resolution execute locally with zero latency.