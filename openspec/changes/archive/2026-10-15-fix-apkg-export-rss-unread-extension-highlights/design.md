## Context

Three user-facing workflows require bug fixes and UX improvements:
1. Review deck export to Anki package (.apkg) from context menus in `ReviewHome.tsx` and `DeckItemContextMenu.tsx`.
2. Article queue navigation in `RSSReader.tsx` when filtering by `viewMode === "unread"`.
3. Web text extraction and highlight persistence in `browser_extension/content.js`, `popup.js`, and `options.js`.

See `proposal.md` for background and motivation.

## Goals / Non-Goals

**Goals:**
- Provide a consistent file-save dialog experience when exporting decks as .apkg from any Review context menu.
- Ensure Rust's `export_deck_as_apkg` command accurately resolves cards belonging to a deck via explicit card IDs and case-tolerant tag filters.
- Maintain stability of the RSS unread article list while reading, preventing active or newly-read articles from abruptly disappearing and blocking queue progression.
- Enable users to pick their highlight color via popup, options, and in-page extract dialogs.
- Persist the selected highlight color on each extract and reliably restore highlights with their exact colors across page visits.
- Ensure highlight restoration is resilient to multi-node DOM structures and dynamic page rendering.

**Non-Goals:**
- Complete rewrite of the RSS reading engine or Anki import/export subsystem.
- Building a standalone annotations manager outside of the existing Plethora extension architecture.

## Decisions

### Decision 1: Card-ID-Assisted Deck Export with Save Dialog

- **Context**: In `DeckManager.tsx`, deck export already uses `@tauri-apps/plugin-dialog` to prompt for a save destination. In contrast, `ReviewHome.tsx` and `DeckItemContextMenu.tsx` bypassed the file dialog and passed a relative filename `${deck.name}.apkg`, which fails when the process current working directory is not writable. Furthermore, Rust strictly matched `tags == deck_name`, missing cards matched by deck tag filters or document associations.
- **Approach**:
  - Unify all deck export handlers (`ReviewHome.tsx`, `DeckItemContextMenu.tsx`, `DeckManager.tsx`) to open the native `@tauri-apps/plugin-dialog` `save()` dialog with sanitized default filename.
  - Compute matching card IDs using `matchesDeck(card, deck)` on the frontend and pass `cardIds?: string[]` to `exportDeckAsApkg(deckName, outputPath, cardIds)`.
  - In Rust `src-tauri/src/anki.rs`, accept `card_ids: Option<Vec<String>>`. If provided, filter learning items directly by ID; if not provided, perform case-insensitive and `deck:`-prefix-tolerant tag matching.
- **Alternatives Considered**:
  - *Export to default Downloads folder automatically*: Rejected because users expect to choose where their exported files are stored.
  - *Filter exclusively in Rust*: Rust lacks full knowledge of client-side smart deck filters (such as document IDs, cram filters, difficulty filters), so passing resolved card IDs from the client is much more accurate.

### Decision 2: Session Read Tracking in RSS Unread Mode

- **Context**: When `viewMode === "unread"`, `allFeedItems.filter(({ item }) => !item.read)` immediately drops an article as soon as it is clicked. The auto-selection effect detects that `selectedItem` is no longer in `items` and forcibly resets `selectedItem` to `items[0]`. Consequently, users cannot advance down the list, and subsequent clicks snap back to the first article.
- **Approach**:
  - Introduce `sessionReadItemIds: Set<string>` in `RSSReader.tsx` state to track items read during the active browsing session.
  - In `viewMode === "unread"`, filter items as: `!item.read || sessionReadItemIds.has(item.id) || item.id === selectedItem?.id`.
  - Display read indicators (e.g. muted text, read icon) so the user sees the article was marked as read while keeping its row in place.
  - Clear `sessionReadItemIds` when the user changes view mode, selects another feed/folder, or triggers a manual reload.
  - Guard the selection synchronization `useEffect` so that it preserves `selectedItem` if it still exists in the session list rather than resetting to `items[0]`.
- **Alternatives Considered**:
  - *Never mark articles as read until leaving the view*: Rejected because user review history and backend read status should update in real time.
  - *Only keep selectedItem*: Does not prevent snapping when moving between multiple articles if prior items were removed. Keeping session-read items provides standard RSS reader behavior (similar to Feedly / NetNewsWire / Inoreader).

### Decision 3: Durable Highlight Storage, Color Palette, and Resilient DOM Restoration

- **Context**: The browser extension stored extracts in per-origin `localStorage`, which is volatile, can be cleared or isolated by websites, and was keyed only by hostname. Neither `createExtract` nor `restoreHighlight` persisted or applied custom colors. Furthermore, `range.surroundContents` fails with DOMException whenever selections cross inline node boundaries (e.g., links or formatted text), and `restoreHighlight` only searched single text nodes.
- **Approach**:
  - **Storage**: Store page extracts in `chrome.storage.local` keyed by page URL and hostname, with transparent migration from existing `localStorage`.
  - **Color Selection**:
    - Add `activeHighlightColor` (default: `#ffd3a5`) to `chrome.storage.sync`.
    - Provide a preset palette (Yellow `#fff59d`, Peach `#ffd3a5`, Green `#c8e6c9`, Blue `#bbdefb`, Pink `#f8bbd0`, Purple `#e1bee7`) with a custom color picker in `popup.html`, `options.html`, and the priority extraction dialog (`showPrioritySelectionDialog`).
  - **Persistence**:
    - Attach `color` to `extractData` on creation.
    - Transmit `color` in synchronization payloads to Plethora.
  - **Restoration**:
    - In `restoreHighlight(extract)`, pass `extract.color` to `highlightText`.
    - For multi-node ranges, wrap text nodes individually or use safe DOM node extraction so `surroundContents` errors are gracefully handled.
    - Set up a debounced `MutationObserver` on the page body so that dynamic/lazy-loaded content restores highlights after initial page load.
- **Alternatives Considered**:
  - *Rely solely on XPath / CSS selectors*: Too fragile across responsive layouts or dynamic CMS re-renders. Exact text matching with text node search plus fallback to ranges is much more reliable.

## Risks / Trade-offs

- **[Risk]** `@tauri-apps/plugin-dialog` in browser / non-Tauri mode.
  - *Mitigation*: Check `isTauri()` or wrap in try/catch with fallback to standard browser download if executed in non-desktop environments.
- **[Risk]** Large web pages with heavy DOM mutations could re-trigger highlight restoration excessively.
  - *Mitigation*: Debounce MutationObserver callbacks (e.g. 500ms) and skip already-highlighted extract IDs.
- **[Risk]** Unread list memory growth if user reads thousands of articles in one session.
  - *Mitigation*: `sessionReadItemIds` is a set of string IDs; even 10,000 IDs consume less than 1 MB of memory.
