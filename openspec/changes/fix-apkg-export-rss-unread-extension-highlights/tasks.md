## 1. Review Deck APKG Export Fix

- [x] 1.1 Update `src-tauri/src/anki.rs` `export_deck_as_apkg` command to accept optional `card_ids: Option<Vec<String>>`, filtering cards by ID when provided and falling back to case-insensitive and `deck:`-prefix-tolerant tag matching when not provided. Verify via cargo check/test.
- [x] 1.2 Update `src/api/learning-items.ts` `exportDeckAsApkg` TypeScript wrapper to pass optional `cardIds`. Verify via `npm run test:scripts` / type check.
- [x] 1.3 Update `src/components/review/ReviewHome.tsx` and `src/components/review/DeckItemContextMenu.tsx` to prompt user with `@tauri-apps/plugin-dialog` `save()` dialog, resolve card IDs for the target deck using `matchesDeck`, and invoke `exportDeckAsApkg`. Verify context menu export trigger and error toast handling.

## 2. RSS Unread Article Navigation Fix

- [x] 2.1 Update `src/components/media/RSSReader.tsx` state to track `sessionReadItemIds`, ensuring articles read during the active unread session remain visible in the list while `viewMode === "unread"`. Verify list retains read items without disappearing.
- [x] 2.2 Fix auto-selection `useEffect` and keyboard navigation in `src/components/media/RSSReader.tsx` so selecting or advancing to subsequent articles does not snap back to `items[0]`. Verify sequential advancement down the article list.
- [x] 2.3 Clear `sessionReadItemIds` on view mode switch, feed change, or manual feed refresh in `RSSReader.tsx`. Verify clean reset on navigation.

## 3. Browser Extension Highlight Customization & Persistence

- [x] 3.1 Add `activeHighlightColor` sync setting with preset palette (Yellow, Peach, Green, Blue, Pink, Purple) in `browser_extension/options.html`, `options.js`, and default settings. Verify options page settings save and load.
- [x] 3.2 Add highlight color selection swatches in `browser_extension/popup.html` and `popup.js` allowing quick selection of the active highlight color. Verify color switches persist to storage.
- [x] 3.3 Add highlight color selection swatches in `browser_extension/content.js` `showPrioritySelectionDialog`. Verify dialog displays palette and passes selected color.
- [x] 3.4 Ensure `createExtract`, `createSmartExtract`, and background registration in `browser_extension/content.js` and `background.js` attach `color` to `extractData` and include it in sync payloads. Verify extract records contain color attribute.
- [x] 3.5 Upgrade extract persistence in `browser_extension/content.js` to store page extracts in `chrome.storage.local` keyed by URL and hostname with transparent migration from `localStorage`. Verify storage read/write persistence.
- [x] 3.6 Update `restoreHighlight` and `highlightText` in `browser_extension/content.js` to apply the stored `extract.color`, handle multi-node text ranges safely without throwing unhandled DOM exceptions, and re-check highlights on dynamic DOM mutations. Verify highlights restore with correct colors on page re-visit.

## 4. Verification and Regression Testing

- [x] 4.1 Add test cases to `browser_extension/tests/` covering highlight color selection, extract color persistence, and safe multi-node highlight restoration. Verify via `npm run test:browser-extension`.
- [x] 4.2 Run relevant frontend tests (`npm run test:run`) to verify no regressions in Review View and RSS reader components.
