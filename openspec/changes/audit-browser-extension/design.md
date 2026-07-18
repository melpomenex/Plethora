## Context

The browser extension integrates with the Incrementum desktop application but suffers from a critical crash when saving selections in "Extract Mode", visually clashes with the main app theme, contains a redundant AI button, fails to update statistics, and drops highlight colors when pages are rendered in the desktop app.

## Goals / Non-Goals

**Goals:**
- Fix the synchronous error causing extract creation to hang when clicking "Create Extract" in the priority dialog.
- Synchronize theme colors dynamically from the desktop app to the extension popup.
- Clean up the UI by removing the redundant "Generate AI Summary" button.
- Ensure statistics and highlights are successfully recorded and displayed.
- Correctly render highlight background colors inside the desktop application document viewer.

**Non-Goals:**
- We are not introducing a full theme editor inside the extension itself; it only takes on the active theme of the desktop app.
- We are not changing the layout engine of the content parser.

## Decisions

### 1. Theme Sharing Mechanism
- **Choice**: Share the theme from Tauri's `apply_theme_vibrancy` command to the BrowserSyncServer via a global static variable, exposing it via a `GET /api/theme` endpoint.
- **Rationale**: Since the Tauri webview and the browser extension run in isolated browser contexts, sharing `localStorage` is impossible. The HTTP server is the only direct bridge between the extension and the desktop app. Passing the theme colors on theme change is robust and handles all custom and built-in themes.
- **Alternative**: Writing theme state to a file or reading directly from a database. Rationale against: Writing to a file adds disk I/O and potential race conditions; database does not store individual theme color configurations for built-in themes.

### 2. Resolving Extract Mode Crashes
- **Choice**: Safe text node and range checks in `content.js`. Specifically, wrapping DOM query selectors and checking `.nodeType` before calling `.tagName.toLowerCase()`, and using a static cloned selection range for HTML capturing.
- **Rationale**: Prevents TypeErrors on text nodes (where `tagName` is undefined) and prevents losing the webpage selection range when the user focuses/clicks on the priority dialog.

### 3. Preserving Highlight Rendering in RichContentRenderer
- **Choice**: Modify the CSS sanitizer style builder in `RichContentRenderer.tsx` to use `body *:not(.incrementum-highlight)` instead of `body *` when stripping background colors.
- **Rationale**: Retains the highlighting capability while preserving the general color-normalization sanitization for the rest of the document.

## Risks / Trade-offs

- **[Risk]**: The desktop app is not running when the extension is opened, meaning the extension cannot fetch the theme.
  - **Mitigation**: The extension popup will fall back gracefully to the default retro/super-game-bro dark theme when the server is unreachable.
