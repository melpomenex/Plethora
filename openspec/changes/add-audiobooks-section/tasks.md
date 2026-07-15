## 1. Sidebar Navigation and Tab Registration

- [x] 1.1 Register the new tab type `audiobook` and its content mapping in `src/components/tabs/TabRegistry.tsx`
- [x] 1.2 Add the Audiobooks tab to navigation mappings, icon list, and UI sidebar in `src/components/layout/MainLayout.tsx`

## 2. Audiobook Library View Implementation

- [x] 2.1 Create the main component `AudiobooksTab.tsx` under `src/components/tabs/`
- [x] 2.2 Implement a beautiful visual bookshelf cover grid with progress overlays and author/title descriptions
- [x] 2.3 Implement the filtering system (Not Started, In Progress, Finished, DNF) and sort selectors (date, title, author, duration) in the library toolbar
- [x] 2.4 Add the Statistics Dashboard header displaying listening metrics (listening time today, weekly overview, total books)
- [x] 2.5 Integrate the file import dialog trigger to allow quick audiobook uploads directly from the bookshelf

## 3. Media Player Upgrades in AudiobookViewer

- [x] 3.1 Replace the existing segmented speed selection with a fine-grained playback speed slider (0.5x to 3.0x, 0.05x steps) in `src/components/viewer/AudiobookViewer.tsx`
- [x] 3.2 Add the sleep timer controls supporting presets (5m, 15m, 30m, 45m, 60m) and "End of Chapter" selection
- [x] 3.3 Implement volume fade-out mechanism that gradually scales down playback volume over the last 5 seconds of the sleep timer
- [x] 3.4 Upgrade the bookmarks panel to allow adding custom textual annotations when a bookmark is created
- [x] 3.5 Implement the Web Media Session API (`navigator.mediaSession`) to bind audiobook metadata and play/pause/skip commands to system notifications and keys
- [x] 3.6 Implement the optional smart silence skipping toggles using simple polling amplitude analysis or Web Audio API nodes

## 4. Verification and Testing

- [x] 5.1 Write unit tests for the active word highlight logic and sleep timer calculations
- [x] 5.2 Manually verify the library layout, responsiveness, and control buttons on desktop and simulated mobile modes
