## 1. Shared registry & dispatch channel

- [x] 1.1 Create `src/commandPalette/contextualActions.ts` exporting the `ViewType` union (subset of `TabType`: `document-viewer | rss | podcast | audiobook | audiobook-epub-sync`), the `actionId` string-literal union, and the `ViewAction` descriptor interface (`id`, `title`, `subtitle?`, `keywords?`, `icon?`, `applies?`, `view`)
- [x] 1.2 Export typed per-view action sets (`documentActions`, `rssActions`, `podcastActions`, `audiobookActions`) and a `getActionsForView(view, context?)` resolver that filters by `applies(context)`
- [x] 1.3 Create `src/commandPalette/paletteActionEvents.ts` with `dispatchPaletteAction(view, actionId)`, the `PALETTE_ACTION_EVENT` constant, the typed payload interface, and a `usePaletteActionListener(view, handlerMap)` hook that registers/removes a `window` listener on mount/unmount and routes `actionId → handler`, emitting a dev-only `console.warn` for unknown ids
- [x] 1.4 Add unit tests for the pure registry: `getActionsForView` returns the right set per view; `applies()` filtering hides inapplicable actions; title/keyword matching helper (if extracted) behaves as expected

## 2. Wire contextual actions into the palette

- [x] 2.1 In `src/components/search/CommandCenter.tsx`, compute the active view via the existing `getActiveTab()` helper and resolve it to a `ViewType` (reusing the `isRssView`/`isPodcastView`/document-type logic already present)
- [x] 2.2 In `handleSearch`, map applicable `ViewAction`s into `SearchResultType.Command` results with a new `metadata.resultKind === "contextual-action"` and payload `{ view, actionId }`; rank them above global commands on empty query and on matching query
- [x] 2.3 Extend the click/Enter path in `src/components/search/GlobalSearch.tsx` so that for `resultKind === "contextual-action"` it calls `dispatchPaletteAction(view, actionId)` and closes the palette (preserve existing `command` behavior)
- [x] 2.4 Add a minimal visual differentiator for the contextual section (e.g. a "Actions in this view" group label or icon) without redesigning the palette UI
- [x] 2.5 Verify existing global commands and RSS/Podcast content-search branches still behave identically (regression check)

## 3. Document viewer actions

- [x] 3.1 Add the document action set in `contextualActions.ts`: Search in Document, Toggle Table of Contents, Next Page, Previous Page, Jump to Page, Zoom In, Zoom Out, Reset Zoom, Create Extract, Highlight Selection, Toggle Fullscreen, Toggle Vim Reading Mode — each with an `applies(viewerKind)` predicate (paging/TOC actions limited to PDF/EPUB; vim-mode action gated on availability)
- [x] 3.2 In `src/components/viewer/DocumentViewer.tsx`, register a `usePaletteActionListener("document-viewer", handlerMap)` mapping each `actionId` to its existing handler (`handleSearch`, TOC toggle, `handleNextPage`/`handlePrevPage`/`handleGoToPage`, zoom handlers, `openExtractDialog`, highlight handler, `toggleFullscreen`, vim toggle)
- [x] 3.3 Resolve and pass the active document format/kind into the listener so `applies()` filtering uses live state (refs to avoid stale closures)
- [ ] 3.4 Manually verify each document action works from the palette for PDF, EPUB, and Markdown (confirm paging actions are hidden for Markdown)

## 4. RSS view actions

- [x] 4.1 Add the RSS action set: Search Articles, Next Article, Previous Article, Mark Current Read, Mark Current Unread, Toggle Star, Open Original, Refresh Feed, Mark All Read, Cycle View Mode
- [x] 4.2 In `src/components/media/RSSReader.tsx`, register a `usePaletteActionListener("rss", handlerMap)` that maps action ids to the existing `handleKeyboardAction(actionName)` dispatcher and `refreshAllFeeds`/`handleMarkAllRead` where applicable
- [ ] 4.3 Manually verify RSS actions from the palette in the active RSS tab, including the no-duplicate-listener check when a second RSS pane is open

## 5. Audiobook view actions

- [x] 5.1 Add the audiobook action set: Play/Pause, Skip Back 10s, Skip Forward 10s, Cycle Playback Speed, Toggle Mute, Toggle Chapters, Add Bookmark, Toggle Transcript, Toggle Sleep Timer, Toggle Fullscreen
- [x] 5.2 In `src/components/viewer/AudiobookViewer.tsx`, register a `usePaletteActionListener("audiobook", handlerMap)` mapping ids to existing handlers (`togglePlay`, `skip(±10)`, `cyclePlaybackRate`, `toggleMute`, `goToChapter`/chapters toggle, `addBookmark`, transcript toggle, sleep-timer handlers, fullscreen toggle)
- [x] 5.3 Confirm the `audiobook-epub-sync` tab type routes to the audiobook listener (shared handler map) so the same actions apply
- [ ] 5.4 Manually verify audiobook actions from the palette (play/pause, skip, bookmark, speed cycle, chapters)

## 6. Podcast view actions

- [x] 6.1 Add the podcast action set: Search Episodes, Play/Pause Selected, Skip Back, Skip Forward, Mark Current Played, Mark Current Unplayed, Download/Delete Download, Refresh Feed, Toggle Transcript — with the "resolvable episode" gating (now-playing else selected/highlighted)
- [x] 6.2 In `src/components/media/PodcastManager.tsx`, register a `usePaletteActionListener("podcast", handlerMap)` mapping ids to existing handlers (`handlePlayEpisode`, playback skip, `handleTogglePlayed`, `handleDownloadEpisode`/`handleDeleteDownload`, `handleRefreshFeed`, transcript toggle); resolve target episode via now-playing or selected state
- [ ] 6.3 Manually verify podcast actions from the palette, including the hidden state when no episode is playing or selected

## 7. Polish & verification

- [x] 7.1 Add subtitle shortcut hints (e.g. `⌘F`) to actions that have a stable existing shortcut, for discoverability only
- [x] 7.2 Run the full unit-test suite and the palette regression checks (global commands, content search, open/close, keyboard navigation)
- [x] 7.3 Run `npm run lint` / typecheck and fix any issues introduced
- [ ] 7.4 Cross-form-factor sanity check: open the palette in each of the four views and confirm the correct, format-filtered action set appears *(requires live GUI; pending manual run)*
