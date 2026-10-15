## Why

Users encounter three distinct issues across the review system, RSS reader, and browser extension:
1. Right-clicking a deck in Review View and selecting "Export as .apkg" fails with an error because the context menu handler bypasses the save dialog, passing a relative file path (`${deck.name}.apkg`) to Tauri, and Rust's deck matching fails when tags or card IDs do not directly equal the deck name string.
2. In the RSS reader's unread mode (`viewMode === "unread"`), selecting an article marks it as read immediately and strips it from the filtered item list. The auto-selection effect fails to find the active item and snaps selection back to the first item (`items[0]`), preventing the user from advancing past the top article and causing subsequent clicked articles to disappear.
3. In the browser extension, text highlights extracted from web pages do not persist user-chosen highlight colors, lack an interface for users to choose their highlight color, and fail to reliably re-highlight pages on revisit due to reliance on volatile origin-scoped `localStorage`, single-text-node DOM range restoration, and missing color restoration.

## What Changes

- **Review Deck APKG Export**:
  - Update `ReviewHome.tsx` and `DeckItemContextMenu.tsx` to prompt the user with `@tauri-apps/plugin-dialog` `save()` dialog before exporting, matching `DeckManager.tsx`.
  - Pass resolved deck card IDs (or robust tag filter matching) to Rust's `export_deck_as_apkg` command so cards belonging to the deck (by tags, filters, or IDs) are exported reliably.
  - Surface descriptive error messages if export fails or is canceled.

- **RSS Reader Unread Article Navigation**:
  - In `RSSReader.tsx`, keep the currently selected article (and items read during the active view session) in the visible unread list so selecting an article does not immediately pull the rug from underneath the user.
  - Fix the selection effect so advancing to subsequent unread articles does not snap back to `items[0]`.
  - Allow read state to be indicated visually while preserving list position and advancement.

- **Browser Extension Highlight Color Customization and Persistence**:
  - Allow users to select their preferred highlight color (from popup/options and extract dialogs with preset swatches and custom hex support).
  - Store `color` directly on `extractData` and sync payloads.
  - Upgrade storage from fragile per-origin `localStorage` to durable `chrome.storage.local` (with backward-compatible migration).
  - Enhance `restoreHighlight` and `highlightText` to restore each extract with its persisted color, support multi-node selections safely without DOM exceptions, and re-apply highlights when dynamic page content loads.

## Capabilities

### New Capabilities
- `deck-apkg-export`: Review View deck context menu export as .apkg with native save dialog and robust card resolution.
- `rss-unread-navigation`: RSS unread view list retention and stable article selection advancement.
- `browser-extension-highlight-customization`: Highlight color customization, extract color persistence, and robust cross-session page re-highlighting.

### Modified Capabilities
<!-- None: No existing specs under openspec/specs/ cover these exact requirements -->

## Impact

- `src/components/review/ReviewHome.tsx` & `DeckItemContextMenu.tsx`: Deck context menu export actions.
- `src-tauri/src/anki.rs`: `export_deck_as_apkg` command support for card IDs / tolerant deck tag matching.
- `src/api/learning-items.ts`: TypeScript API signatures for deck export.
- `src/components/media/RSSReader.tsx`: Unread filter logic and selection sync effect.
- `browser_extension/content.js`, `popup.html`, `popup.js`, `options.html`, `options.js`: Highlight color selection UI, extract color storage, and DOM restoration.
- Extension test suite (`browser_extension/tests/*.test.cjs`).
