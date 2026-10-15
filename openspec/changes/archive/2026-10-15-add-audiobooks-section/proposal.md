## Why

Incrementum currently lacks a centralized, dedicated workspace for audiobooks, making it difficult for users to track, filter, and consume their audiobook library. Introducing a dedicated Audiobooks section with premium playback features (sleep timer, silence skipping, volume boost, system media session sync, and bookmarks) will significantly improve the mobile and desktop user experience for audio-based incremental reading.

## What Changes

- **Dedicated Audiobook Library**: A new tab in the sidebar displaying a beautiful visual bookshelf of all imported audiobooks, filterable by status (Not Started, In Progress, Finished, DNF) and sortable by various metadata.
- **Enhanced Playback Controls**: Integration of sleep timer (presets, shake-to-extend, end of chapter), a fine-grained speed control slider (0.5x to 3.0x), volume boost, and smart silence skipping.
- **Bookmarks & Annotations**: Ability to add textual notes at specific playback timestamps directly from the player view.
- **Listening Stats Dashboard**: A visual display of daily/weekly listening statistics, total audiobooks, and completed count.
- **System Media Sessions**: Sync with the Web Media Session API to allow lock-screen and hardware media key control of audiobook playback on both desktop and mobile.
- **Refined Multi-Part Player UX**: Improved handling and display of multi-part audiobooks, showing total cumulative progress and clean track transitions.

## Capabilities

### New Capabilities
- `audiobooks-section`: A dedicated tab/section displaying a beautiful library of imported audiobooks, filtering by progress, showing reading/listening statistics, and integrating a high-fidelity media player with sleep timer, speed control, bookmarks, and transcripts.

### Modified Capabilities
<!-- None -->

## Impact

- **Sidebar & Routing**: `src/components/layout/MainLayout.tsx` and `src/components/tabs/TabRegistry.tsx` will be modified to include the new "Audiobooks" tab.
- **Player Interface**: `src/components/viewer/AudiobookViewer.tsx` will be upgraded to support advanced player controls.
- **Data Models**: `src/api/audiobooks.ts` and document metadata types will support new player-related states (e.g. DNF status, sleep timer configurations).
