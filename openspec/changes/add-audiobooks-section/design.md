## Context

Incrementum currently lacks a centralized space to view and manage imported audiobooks. Users can import audio files and listen to them, but they are mixed in with other documents under the general "Documents" library. We need a dedicated Audiobook Bookshelf/Library tab, unified playback statistics, and advanced player controls (sleep timer, silence skipping, media key controls, bookmarks with annotations) with an exceptional UX on both desktop and mobile layouts.

## Goals / Non-Goals

**Goals:**
- Create a dedicated "Audiobooks" tab in the sidebar and tab registry with a high-fidelity visual layout.
- Filter, search, and sort audiobooks dynamically using the existing `useDocumentStore`.
- Provide an attractive bookshelf view displaying cover art, author, title, and listening progress.
- Track listening progress states: Not Started, In Progress, Finished, and DNF (Did Not Finish).
- Enhance the `AudiobookViewer` with sleep timer, playback speed control (fine-grained slider), bookmarks with custom notes, volume boost, silence skipping, and Web Media Session API integration.
- Ensure the audiobook interface is fully responsive, looking stunning on both desktop monitors and native mobile screens.

**Non-Goals:**
- Building a server-side storage or hosting solution for audiobook files.
- Implementing an audiobook marketplace or storefront.

## Decisions

### 1. Sidebar and Tab Registration
We will register a new tab type `audiobook` in `TabRegistry.tsx` and integrate it into the main layout sidebar in `MainLayout.tsx`. The tab component will render a new `AudiobooksTab.tsx` component that serves as the entry point.

### 2. Document Filtering and Audiobook Tagging
- Audiobooks will be represented as `Document` objects with `fileType === 'audio'` and having `"audiobook"` in their tags list.
- We will fetch them using the existing `useDocumentStore.documents` list.
- Reading status (Not Started, In Progress, Finished, DNF) will be stored using document tags or fields inside the `metadata` object (e.g. `doc.metadata.audiobookStatus`).

### 3. Media Player Enhancements in `AudiobookViewer.tsx`
We will modify the existing `AudiobookViewer.tsx` rather than writing a new one, as it already supports m4b transcoding, native streaming, and ePub text sync:
- **Sleep Timer**: Runs a local JavaScript timer. In the final 5 seconds, it gradually reduces `audio.volume` to `0` and then triggers `pause()`. Includes options for 5m, 15m, 30m, 45m, 60m, and "End of Chapter" (monitors chapter transition times).
- **Speed Slider**: We will expand the current speed step controls to a fine-grained slider ranging from 0.5x to 3.0x with 0.05x increments.
- **Bookmarks Panel**: Extend the bookmark creation system to include a text input modal for annotations.
- **Web Media Session API**: Set up `navigator.mediaSession` handlers for `play`, `pause`, `seekbackward`, `seekforward`, `previoustrack`, and `nexttrack` to enable system lock screen controls and hardware media buttons.
- **Smart Silence Skip**: An optional feature using Web Audio API's `ScriptProcessorNode` / `AudioWorklet` or a simplified polling volume analyzer to fast-forward past sections where volume remains below -50dB for over 500ms.

### 4. Listening Statistics
We will introduce a simple storage mechanism to track listening duration per day/week, showing these statistics on the bookshelf dashboard (e.g. "45 minutes listened today").

## Risks / Trade-offs

- **Tauri Mobile Audio Streaming** → *Risk*: On native mobile, large audio files can cause Out Of Memory (OOM) errors if buffered fully into memory via standard asset protocols.
  - *Mitigation*: Use the custom media server protocol that supports HTTP Range requests (already in the backend).
- **Media Session Background Playback** → *Risk*: Mobile browsers or Tauri shells may aggressively throttle audio timers or Web Audio API nodes in the background.
  - *Mitigation*: Ensure the core HTMLAudioElement plays normally so the OS respects background audio, and avoid relying on complex background JS timers for playback controls.
