## Why

The command palette (Ctrl/Cmd+K) is currently context-blind for *actions*. It already detects the active view (document, RSS, podcast) to switch *content-search* sources, but it surfaces the same flat list of navigation/theme commands everywhere — so a user reading a PDF, scrolling RSS, or listening to an audiobook gains nothing from the palette in that moment. There are no in-context actions like "Search in document", "Toggle chapters", "Mark all read", or "Add bookmark", even though the underlying handlers already exist and many already have their own keyboard shortcuts. The palette should become the single keyboard-driven entry point for whatever the user is currently doing.

## What Changes

- Introduce a **contextual action** layer in the command palette: when a view is active, surface a prioritized set of actions that operate on that view (shown above global navigation/theme commands when the query is empty or matches the action title)
- Add contextual action sets for four views:
  - **Document viewer** (PDF/EPUB/HTML/TXT/MD): Search in Document, Toggle Table of Contents, Next/Previous Page, Jump to Page, Zoom In/Out/Reset, Create Extract, Highlight Selection, Toggle Fullscreen, Toggle Vim Reading Mode
  - **RSS view**: Search Articles, Next/Previous Article, Mark Current Read/Unread, Toggle Star, Open Original, Refresh Feed, Mark All Read, Cycle View Mode
  - **Podcast view**: Search Episodes, Play/Pause Selected, Skip Back/Forward, Mark Current Played/Unplayed, Download/Delete Download, Refresh Feed, Toggle Transcript
  - **Audiobook view**: Play/Pause, Skip Back/Forward, Cycle Playback Speed, Toggle Mute, Toggle Chapters, Add Bookmark, Toggle Transcript, Toggle Sleep Timer, Toggle Fullscreen
- Make action discovery **context-driven**: actions are sourced from a per-view registry and only shown when the corresponding view is active (no RSS actions in a PDF, etc.)
- Dispatch each action to the **existing handler** in the active view via a lightweight, typed event bus (no duplication of business logic) so the palette never re-implements view behavior
- Keep the existing global commands and content-search behavior intact; contextual actions are purely additive and appear ranked above globals when relevant

## Capabilities

### New Capabilities

- `contextual-palette-actions`: Per-view, keyboard-discoverable actions surfaced in the command palette based on the active tab's view type, each dispatching to the existing view handler without re-implementing behavior

### Modified Capabilities

<!-- No existing spec-level requirements change. The palette's global command list and content-search behavior remain as-is; this is an additive capability. -->

## Impact

- **Frontend (palette)**: `src/components/search/CommandCenter.tsx` — assemble and rank contextual action results in `handleSearch`; `src/components/search/GlobalSearch.tsx` — optional result grouping/visual treatment for "Actions in this view"
- **Frontend (views)**: `src/components/viewer/DocumentViewer.tsx`, `PDFViewer.tsx`, `EPUBViewer.tsx`, `MarkdownViewer.tsx`; `src/components/media/RSSReader.tsx`; `src/components/media/PodcastManager.tsx`; `src/components/viewer/AudiobookViewer.tsx` — expose existing handlers to the action dispatcher
- **Frontend (new)**: a small per-view action registry + a typed event/dispatch channel for palette → view invocation
- **State/stores**: reads `useTabsStore` (active tab `type`) for context; no new persistence required
- **No backend/Rust changes**; no breaking changes — additive only
