---
title: "HTML Web Article Reader"
description: "Distraction-free article reader for scraped web pages, newsletters, and Defuddle/Readability snapshots."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["article reader","web reader","readability","distraction free article"]
aliases: ["article reader","web reader","readability","distraction free article"]
relatedDocs: ["import.url_scraping","reader.selection.actions","reader.position.restore"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/html-reader.md"
---
# HTML Web Article Reader

## Purpose
Renders captured web articles, blog posts, and research pages in a standardized, high-speed typography container stripped of clutter.

## User-Facing Behavior
- Displays article title, author, date, domain badge, and original source URL.
- Cleans away navigation bars, cookie banners, tracking widgets, and advertisements.
- Preserves code snippets, inline images, tables, and blockquotes.

## Exact Behavioral Rules
1. Uses `@mozilla/readability` and `defuddle` parsers to extract semantic content.
2. Sanitizes HTML with `DOMPurify` to eliminate cross-site scripting risks.
3. Automatically caches raw compressed HTML snapshot to ensure reading availability when offline.

## Rationale
Prevents cognitive overload caused by dynamic web ads and ensures personal library materials remain accessible even if the original web page is altered or removed.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.html.maxWidth` | `760px` | Optimal reading measure width |
| `viewer.html.lineHeight` | `1.7` | Vertical typographic rhythm |

## Platform Behavior
- **Cross-Platform**: Consistent reader layout across macOS, Linux, Windows, and Android.
- **E-ink**: High contrast typography with zero flashing DOM animations.