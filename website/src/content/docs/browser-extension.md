---
title: "Browser Extension Bridge"
description: "Local HTTP Axum bridge on localhost:9527 enabling 1-click web captures and text highlights directly from Chrome and Firefox."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux"]
keywords: ["web clipper","chrome extension","firefox extension","local bridge server"]
aliases: ["web clipper","chrome extension","firefox extension","local bridge server"]
relatedDocs: ["import.url_scraping","reader.html.article","queue.scroll_session"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/browser-extension.md"
---
# Browser Extension Bridge

## Purpose
Provides an ultra-fast, local-first connection between web browsers and Plethora desktop for effortless article clipping and highlight capture.

## User-Facing Behavior
- Adds a Plethora Clipper icon to your browser toolbar.
- 1-click captures:
  - Entire article in clean reader view.
  - Selected text as an immediate extract with source citation.
  - PDF documents open in the browser.
- Displays instantaneous success notification banner.

## Exact Behavioral Rules
1. Plethora runs an embedded Rust Axum HTTP server on `127.0.0.1:9527` (configurable).
2. All communications use local REST endpoints secured by origin headers.
3. Automatically queues newly captured documents into your reading queue based on priority rules.

## Rationale
Knowledge capture must be instantaneous. Removing intermediate clipboard steps encourages high-frequency learning intake.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `server.browserSyncPort` | `9527` | Local loopback port for browser extension bridge |
| `server.autoStartBridge` | `true` | Start bridge server automatically on launch |

## Platform Behavior
- **Desktop**: Runs as a low-overhead background thread inside Tauri.
- **Security**: Bound exclusively to loopback interface `127.0.0.1`.