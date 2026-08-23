---
title: "Troubleshooting: Queue Items Reappearing Sooner Than Expected"
description: "Diagnostic guide explaining why high-priority articles, short extracts, or lapsed cards return to the reading queue quickly."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["all"]
keywords: ["item came back","queue item too frequent","why is this item here","repeated reading item"]
aliases: ["item came back","queue item too frequent","why is this item here","repeated reading item"]
relatedDocs: ["queue.priority_score","queue.reappearance","queue.extract_lifecycle"]
owner: "E"
claimIds: []
sourcePath: "docs/product/troubleshooting/queue-item-reappearing.md"
---
# Troubleshooting: Queue Items Reappearing Sooner Than Expected

## Purpose
Explains the mathematical reasons an article, extract, or flashcard returns to the reading queue sooner than the user anticipated.

## User-Facing Behavior
- **Symptom**: An article you read yesterday appears in your queue again today.
- **Cause 1**: The item has a high priority score (e.g. Priority < 15), giving it a short initial reappearance interval.
- **Cause 2**: You clicked "Next (Keep in Queue)" instead of "Dismiss" or "Done".
- **Cause 3**: The item was selected via Neural Topic Queue because it semantically matches another article currently open.

## Exact Behavioral Rules
1. To retire an article permanently from the queue without deleting it, click **Dismiss** (`m` / Dismiss button).
2. To increase the return interval, lower its priority (e.g. adjust from 10 to 60) or manually set a future return date.
3. Check the item details popover and click **"Why am I seeing this item today?"** for a grounded mathematical explanation.

## Rationale
Incremental reading intentionally re-surfaces uncompleted articles at spaced intervals to ensure continuous progress through long materials.

## Platform Behavior
- Reappearance intervals are calculated identically across all desktop and mobile platforms.