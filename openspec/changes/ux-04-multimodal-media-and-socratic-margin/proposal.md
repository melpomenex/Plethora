# Proposal: Multimodal Video Slices, Role-Voice TTS PiP, Breakout Overlays & Socratic Margin

## Why

Video, audio/TTS, complex tables/equations, and AI dialogue currently fracture reading continuity in Plethora:
1. Video viewers (`YouTubeViewer.tsx` + `TranscriptSync.tsx`) display synchronized transcripts, yet highlighting transcript prose does not automatically bind `[start_time, end_time]` bounds into a scheduled `createVideoExtract` slice.
2. `MiniAudioPlayer.tsx` and `ReaderTTSControls.tsx` lack a persistent cross-tab collapsible bottom-right PiP dock with waveform scrubbing, 1.0x–2.5x speed control, a `[B]` "Bookmark & Extract Last 30s" capture trigger, and content-aware Role Voice switching (e.g., Voice A for extracts vs. chime + Voice B for Q&A/summaries).
3. Wide data tables, KaTeX display formulas, and wide code blocks clip or wrap unreadably in narrow EPUB/Markdown/Extract panes.
4. Learners wanting AI clarification on a tricky passage or equation must leave the document for a detached assistant drawer instead of opening a selection-anchored margin thread.

## What Changes

### ADDED
- **Transcript-First Video Extraction**: Selecting text across one or more transcript segments in `TranscriptSync.tsx` / `TranscriptPanel.tsx` displays `Capture Video Slice [mm:ss - mm:ss]`, persisting the transcript excerpt alongside exact `start_time` / `end_time` via `createVideoExtract` (`src/api/video-extracts.ts`).
- **Role-Voice TTS PiP Enhancements & `[B]` 30s Bookmark Extract**: Upgrade `MiniAudioPlayer.tsx` and `audioPlaybackStore.ts` with a persistent collapsible bottom-right PiP bar, waveform scrubber, `1.0x–2.5x` playback rate switcher, `[B]` Bookmark & Extract Last 30s action, and automatic Voice A / Chime + Voice B role switching by item role (`extract` vs `qa_prompt` / `summary`).
- **Table, Math & Code Breakout Overlay**: `BreakoutOverlayModal.tsx` attached via hover/focus "Breakout View" triggers on wide `<table>`, `.katex-display`, and `<pre><code>` blocks inside `EPUBViewer.tsx`, `MarkdownViewer.tsx`, and `ExtractScrollItem.tsx` supporting pan/zoom (`0.5x–3.0x`) and high-contrast `readerThemeTokens`.
- **Selection-Anchored Socratic Margin Threads (`Cmd/Ctrl + J`)**: `SocraticMarginThread.tsx` opened via `Cmd/Ctrl + J` or `SelectionActionBar`, anchored to the active quote/equation with streaming/local Q&A dialogue and a 1-click **Convert Explanation to Extract / Flashcard** action.

### MODIFIED
- **`TranscriptSync.tsx`, `TranscriptPanel.tsx`, `YouTubeViewer.tsx`**: Wire transcript selection range -> timestamp bounds resolver and `Capture Video Slice` action.
- **`MiniAudioPlayer.tsx`, `audioPlaybackStore.ts`**: Persist PiP dock state across tab switches and track rolling 30s spoken/played transcript buffer for `[B]` capture.
- **`EPUBViewer.tsx`, `MarkdownViewer.tsx`, `ExtractScrollItem.tsx`, `DocumentViewer.tsx`**: Inject Breakout triggers and `Cmd/Ctrl + J` Socratic Margin anchor support.

### REMOVED
- None.

## Capabilities

### New Capabilities
- `multimodal-media-socratic-margin`: Transcript-range video slice extraction, persistent role-voiced TTS PiP player with 30s bookmark extraction, pan/zoom table & math breakout viewer, and selection-anchored Socratic margin threads.

### Modified Capabilities
- None.

## Impact

- **Frontend Media & Audio**: `src/components/media/TranscriptSync.tsx`, `src/components/media/TranscriptPanel.tsx`, `src/components/viewer/YouTubeViewer.tsx`, `src/api/video-extracts.ts`, `src/components/audio/MiniAudioPlayer.tsx`, `src/stores/audioPlaybackStore.ts`, `src/components/common/ReaderTTSControls.tsx`.
- **Frontend Viewers**: `src/components/viewer/BreakoutOverlayModal.tsx` (new), `src/components/viewer/SocraticMarginThread.tsx` (new), `src/components/viewer/EPUBViewer.tsx`, `src/components/viewer/MarkdownViewer.tsx`, `src/components/review/ExtractScrollItem.tsx`, `src/components/viewer/DocumentViewer.tsx`.
- **Risks**: Web Audio chime synthesis or Tauri Chatterbox TTS voice profiles may be unavailable in test/browser runtimes; mitigate cleanly via capability guards and subtle WebAudio/silent fallback when `AudioContext` is absent.
