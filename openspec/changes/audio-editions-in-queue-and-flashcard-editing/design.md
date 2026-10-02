## Context

See `proposal.md` for motivation.

Plethora currently generates multi-section Audio Editions stored in `audio_editions`, `audio_edition_sections`, and `audio_edition_anchors` tables. Playback occurs in `AudiobookViewer.tsx`, which unifies single-file audio, multi-part audiobooks, and AI Audio Editions into a playlist of parts.

However:
1. `AudiobookViewer` attempts to restore playback position during its mount effect via `getDocumentPosition(document.id)`. Because Audio Edition loading (`getAudioEditionByDocument`) is asynchronous, `multiPartInfo` is null when the mount restore executes. This causes `fromGlobalSeconds` to fall back to `partIndex: 0`, and the multi-part position is never restored once the edition loads.
2. In `AudiobooksTab.tsx`, `handleListenToEdition` passes `fromSeconds = 0` by default as `initialJump: { kind: "audio", timeSeconds: 0 }`. In `AudiobookViewer.tsx`, `typeof initialSeekTime === "number"` evaluates to true, bypassing saved position loading and forcing a seek to 0s.
3. Audio Editions exist only in the Audiobooks tab; they do not appear in the study Queue, and `QueueScrollPage` does not pass `listenToEdition: true` when rendering document queue items.
4. `FlashcardScrollItem` in `QueueScrollPage` lacks edit buttons or `Cmd/Ctrl+E` listeners, unlike `ReviewCard` and `ReviewSession` which integrate `InlineCardEditor`.

## Goals / Non-Goals

**Goals:**
- Provide rock-solid Audio Edition position tracking that accurately saves and resumes both `partIndex` and `timeInPart`.
- Store Audio Edition listening positions independently from text CFI/page positions so reading and listening never clobber each other.
- Support adding Audio Editions to the user's Queue on creation and from library menus.
- Enable consuming Audio Editions within Queue list views and directly inside Queue Scroll Mode.
- Add seamless in-place flashcard editing in Queue Scroll Mode and Queue list views using the existing `InlineCardEditor`.

**Non-Goals:**
- Modifying speech synthesis or TTS engine adapters (audio generation logic is untouched).
- Changing spaced repetition scheduling math (FSRS / SM-2 intervals remain as-is).
- Rebuilding the entire Queue data layer or replacing `QueueScrollPage`.

## Decisions

### 1. Dedicated Audio Edition Position Manager (`audioEditionPosition.ts`)
- **Decision**: Create a dedicated client-side position store (`src/utils/audioEditionPosition.ts`) following the proven pattern in `src/utils/ttsListeningPosition.ts`. It stores:
  ```ts
  export interface AudioEditionPosition {
    editionId: string;
    documentId: string;
    partIndex: number;
    timeInPart: number;
    globalTimeSec: number;
    totalDurationSec: number;
    updatedAt: number;
  }
  ```
- **Rationale**: Storing `partIndex` alongside `timeInPart` eliminates ambiguity in multi-part editions. Storing in IndexedDB with a synchronous fallback to `localStorage` on window `beforeunload` guarantees that positions survive sudden app exits or tab closures. It decouples audio position from `document_position` (which stores page/CFI for text readers).
- **Alternatives Considered**:
  - *Storing solely in `document_position`*: Fails because reading the document in EPUB or PDF mode writes CFI or page numbers, overwriting the audio timestamp.
  - *Adding SQLite schema migration*: Unnecessary overhead and migration risk; IndexedDB + localStorage provides instant, low-latency, offline-first access with zero IPC latency.

### 2. Dual-Phase Position Lifecycle in `AudiobookViewer`
- **Decision**: Update `AudiobookViewer.tsx` to handle position restoration in two phases:
  1. If an explicit `initialSeekTime` is passed (from an explicit seek or "Listen from Beginning"), seek directly to that offset.
  2. If resuming an Audio Edition, wait until `edition` and its ready sections are resolved. Then load the saved `AudioEditionPosition`, set `currentPartIndex = saved.partIndex`, load the corresponding section audio source, and seek to `saved.timeInPart`.
  3. Fix `AudiobooksTab.tsx`: "Listen to Audio Edition" leaves `fromSeconds` undefined (triggering automatic resume), while "Listen from Beginning" explicitly sets `fromSeconds = 0` and resets the saved position.
- **Alternatives Considered**:
  - *Blocking AudiobookViewer render until edition loads*: Causes visible delay and breaks single-file audiobooks that don't have editions.

### 3. Queue Representation & In-Stream Audio Consumption
- **Decision**:
  - When an Audio Edition is created in `CreateAudioEditionDialog`, add a checkbox "Add to Queue" (checked by default). When checked, schedule the source document for review today (`next_reading_date = now()`).
  - Extend `QueueItem` with `hasAudioEdition?: boolean; audioEditionId?: string;`.
  - In `ReviewQueueView` and `routes/queue.tsx`, render an Audio Edition badge (🎧) with audio duration and listening progress. The primary action triggers `handleOpenDocument` with `listenToEdition: true`.
  - In `QueueScrollPage.tsx`, when an item has `hasAudioEdition`, render `DocumentViewer` with `listenToEdition={true}` (or `AudiobookViewer` directly), allowing full audio playback, chapter navigation, and automatic advance upon completion.
- **Alternatives Considered**:
  - *Creating a new `item_type: "audio-edition"` in SQLite*: Would require database migrations and updates to all queue ranking algorithms. Using existing document queue items with audio-edition metadata keeps ranking and FSRS scheduling completely intact.

### 4. In-Queue Flashcard Editing via `InlineCardEditor`
- **Decision**:
  - In `FlashcardScrollItem.tsx`: Add an Edit button (`review-card-edit`) in the card header and a `Cmd+E` / `Ctrl+E` keyboard listener that calls `onEdit()`.
  - In `QueueScrollPage.tsx`: Mount `InlineCardEditor` in a modal dialog when `editingCard` is set. On save, patch `renderedItem.learningItem` and the matching item in `scrollItems` in place.
  - In `ReviewQueueView.tsx`: Add "Edit Flashcard" to the context menu and action sheet for `itemType === "learning-item"`, opening `InlineCardEditor` and updating the row in place.
- **Rationale**: Directly mirrors the behavior of `ReviewSession.tsx`, providing UI consistency. Users do not lose their place in the queue.
- **Alternatives Considered**:
  - *Full page navigation to Flashcard Studio*: Disrupts queue flow and causes loss of scroll position.

## Risks / Trade-offs

- **[Risk] Section audio URL resolution latency during multi-part resume** → When resuming on part 3, the browser must resolve the section URL before seeking.
  - *Mitigation*: `goToPart` in `AudiobookViewer` already handles on-demand section URL resolution; setting `pendingSeekTimeRef.current` ensures the seek executes as soon as the `<audio>` element fires `canplay` or `loadedmetadata`.
- **[Risk] Sync conflicts between reading text and listening audio** → If a user reads an EPUB and also listens to an Audio Edition.
  - *Mitigation*: Text reading position (`current_cfi`, `current_page`) and Audio Edition position (`audioEditionPosition`) are persisted in separate stores with their own keys.
