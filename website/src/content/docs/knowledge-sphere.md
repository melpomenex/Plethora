---
title: "3D Knowledge Sphere Graph"
description: "Interactive 3D WebGL semantic sphere visualizing document connections, shared tags, extract lineages, and topical similarity clusters."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android"]
keywords: ["knowledge graph","3d graph","semantic sphere","document network"]
aliases: ["knowledge graph","3d graph","semantic sphere","document network"]
relatedDocs: ["palette.command_center","queue.neural_queue","library.collection"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/search/knowledge-sphere.md"
---
# 3D Knowledge Sphere Graph

## Purpose
Provides an interactive 3D WebGL knowledge graph visualizing the relationships, citations, and semantic clusters across your entire library.

## User-Facing Behavior
- Renders books, extracts, and cards as glowing interconnected 3D nodes arranged on a dynamic semantic sphere.
- Node size reflects reading progress and repetition stability.
- Edge lines connect parent-child extracts, cross-references, and shared tags.
- Clicking any node opens a floating preview card with 1-click navigation to that item.

## Exact Behavioral Rules
1. Uses Three.js and custom force-directed graph physics.
2. Layout positions nodes using dimensionality reduction over document embedding vectors.
3. Automatically falls back to lightweight 2D canvas on lower-power devices or E-ink screens.

## Rationale
Visualizing the growing galaxy of personal knowledge provides emotional motivation and sparks serendipitous connections between disparate fields of study.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `graph.renderLabels` | `true` | Render floating text labels on primary document nodes |

## Platform Behavior
- **Desktop**: 60 FPS hardware-accelerated WebGL rendering.
- **E-ink**: Automatically replaced with high-contrast static outline graph.