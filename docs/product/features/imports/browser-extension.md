---
id: import.browser_ext
title: Browser Extension Bridge
domain: imports
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Local HTTP Axum bridge on localhost:9527 enabling 1-click web captures and text highlights directly from Chrome and Firefox.
how_to: Install the Plethora Web Clipper extension in Chrome or Firefox. Click the extension icon on any page to send it instantly to Plethora.
why: Switching windows to copy-paste URLs interrupts browsing flow; a lightweight local web clipper sends full articles and selected highlights into your reading queue instantly.
aliases:
  - web clipper
  - chrome extension
  - firefox extension
  - local bridge server
settings:
  - server.browserSyncPort
  - server.autoStartBridge
actions:
  - id: action.search.command_center
    label: Open Command Palette
    shortcut: Cmd+K
related:
  - import.url_scraping
  - reader.html.article
  - queue.scroll_session
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
