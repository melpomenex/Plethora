---
title: "Web URL Article Ingestion"
description: "1-click web page extraction via Defuddle and Readability with automatic image embedding and metadata parsing."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["scrape url","web capture","save web page","defuddle import"]
aliases: ["scrape url","web capture","save web page","defuddle import"]
relatedDocs: ["reader.html.article","import.browser_ext","import.arxiv"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/url-scraping.md"
---
# Web URL Article Ingestion

## Purpose
Enables one-paste web clipping that transforms volatile web links into clean, offline-ready local library documents.

## User-Facing Behavior
- Pasting a URL opens a preview dialog showing article title, author, site icon, and word count.
- Strips advertisements, social buttons, navigation menus, and popups.
- Saves high-res article images locally to eliminate broken image links when reading offline.

## Exact Behavioral Rules
1. Fetches HTML source through Rust backend with customizable User-Agent headers.
2. Extracts article text using Readability and Defuddle algorithms.
3. Compresses and archives the raw HTML source alongside the cleaned DOM snapshot.

## Rationale
Web links frequently rot, hit paywalls, or alter content over time. Saving permanent local snapshots guarantees study references remain intact.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `import.downloadImages` | `true` | Save remote article images locally for offline reading |

## Platform Behavior
- **Desktop & Mobile**: Native networking client with timeout safeguards.
- **Android**: Supports system "Share to Plethora" intent from Chrome / Firefox.