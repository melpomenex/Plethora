## Why

The Incrementum Browser Extension has several bugs and functional gaps that prevent it from providing a seamless user experience. Specifically:
1. Creating text extracts in "Extract Mode" fails synchronously when clicking the final dialog button due to a TypeError on text nodes and a loss of webpage selection context.
2. The browser extension does not match the active visual theme chosen by the user in the main desktop application.
3. The "Generate AI Summary" button is redundant, as modern browsers provide AI page summaries natively.
4. Statistics (extracts/highlights counts) on pages fail to display because highlighting/extract creation is blocked by the crash.
5. Highlighted pages saved to the desktop application do not render their highlights because the desktop app's HTML renderer aggressively strips all background colors.

## What Changes

- **FIX**: Correct text node selection handling and selector path resolution in `content.js` to prevent the extract mode crash.
- **FIX**: Retrieve selection HTML based on the cached pre-dialog range in `content.js` to preserve formatting.
- **FEATURE**: Expose the active theme and colors from the Tauri app via a new `GET /api/theme` endpoint in `browser_sync_server.rs`, which the extension popup queries to apply matching styles dynamically.
- **REMOVAL**: Delete the "Generate AI Summary" button from the extension popup interface (`popup.html` and `popup.js`).
- **FIX**: Update the popup statistics loading logic and ensure quick extracts are correctly sent through the content script so highlights and counts update automatically.
- **FIX**: Exclude `.incrementum-highlight` elements from CSS background stripping in the desktop app's `RichContentRenderer.tsx` so highlights are preserved when pages are saved.

## Capabilities

### New Capabilities
- `browser-extension-theme-sync`: Syncs the active visual theme from the desktop app to the browser extension popup dynamically.
- `browser-extension-highlight-export`: Ensures highlights are correctly preserved and rendered when exporting/saving pages to the desktop application.

### Modified Capabilities
<!-- No requirement changes to existing specs -->

## Impact

- **Frontend (Desktop)**:
  - `src/contexts/ThemeContext.tsx`: Update `apply_theme_vibrancy` invocation to pass active theme colors.
  - `src/components/common/RichContentRenderer.tsx`: Exclude `.incrementum-highlight` elements from CSS stripping and define default highlight styling.
- **Backend (Tauri)**:
  - `src-tauri/src/lib.rs`: Update `apply_theme_vibrancy` command signature to accept theme colors.
  - `src-tauri/src/browser_sync_server.rs`: Add a global active theme static variable, update it via the vibrancy command, and expose it via a new `/api/theme` endpoint.
- **Browser Extension**:
  - `browser_extension/popup.html`: Remove AI summary button and associated markup.
  - `browser_extension/popup.js`: Query active theme on load, apply theme styles, remove AI summary logic, and delegate quick extract to content script.
  - `browser_extension/content.js`: Fix selector resolution for text nodes, pass range to `captureSelectionHTML`, and resolve quick extract messaging.
