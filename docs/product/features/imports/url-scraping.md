---
id: import.url_scraping
title: Web URL Article Ingestion
domain: imports
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: 1-click web page extraction via Defuddle and Readability with automatic image embedding and metadata parsing.
how_to: Paste any HTTP/HTTPS URL into the Command Palette (Cmd+K) or click "+ Add URL" in the Documents view.
why: Reading articles on cluttered web browsers causes constant distraction; importing converts web pages into permanent, searchable local assets.
aliases:
  - scrape url
  - web capture
  - save web page
  - defuddle import
settings:
  - import.downloadImages
  - import.defuddleEnabled
actions:
  - id: action.search.command_center
    label: Open Command Palette
    shortcut: Cmd+K
related:
  - reader.html.article
  - import.browser_ext
  - import.arxiv
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
