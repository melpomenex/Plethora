## 1. Rust Backend Implementation

- [ ] 1.1 Add active theme global static variable in `src-tauri/src/browser_sync_server.rs` using `once_cell::sync::Lazy`
- [ ] 1.2 Implement helper functions `set_active_theme` and `get_active_theme` in `src-tauri/src/browser_sync_server.rs`
- [ ] 1.3 Add dynamic route `GET /api/theme` to the Axum Router in `src-tauri/src/browser_sync_server.rs` and implement its handler `handle_get_theme`
- [ ] 1.4 Update the `apply_theme_vibrancy` command signature in `src-tauri/src/lib.rs` to accept an optional `colors` JSON payload, and call `set_active_theme` in its body

## 2. Desktop App Frontend Implementation

- [ ] 2.1 Update `src/contexts/ThemeContext.tsx` to pass `currentTheme.colors` inside the `apply_theme_vibrancy` invoke command call
- [ ] 2.2 Update `src/components/common/RichContentRenderer.tsx`'s `createIframeDocument` function to exclude `.incrementum-highlight` from the `body *` reset rule and define a fallback background/text color for it

## 3. Browser Extension Popup Cleanup and Styling

- [ ] 3.1 Remove the "Generate AI Summary" button from `browser_extension/popup.html` and delete the AI summary modal container
- [ ] 3.2 Remove AI summary event listeners, variables, and methods (`generateAISummary`, `renderAIResults`, `saveAIExtract`, etc.) from `browser_extension/popup.js`
- [ ] 3.3 Add active theme query and CSS injection logic to the popup load sequence in `browser_extension/popup.js`
- [ ] 3.4 Update `quickExtract` in `browser_extension/popup.js` to call the content script's `createQuickExtract` action directly instead of invoking the background save directly, fixing highlights sync

## 4. Browser Extension Content Script Auditing

- [ ] 4.1 Update `getElementSelector` and `getElementPath` in `browser_extension/content.js` to safely resolve text nodes without throwing a `TypeError`
- [ ] 4.2 Update `captureSelectionHTML` in `browser_extension/content.js` to accept a `range` parameter and map cloned elements to their original styles using a TreeWalker selection intersection list
- [ ] 4.3 Update `createSmartExtract` in `browser_extension/content.js` to pass the cloned range to `captureSelectionHTML`
