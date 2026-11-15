# Design: Multimodal Video Slices, Role-Voice TTS PiP, Breakout Overlays & Socratic Margin

## Context

- `src/components/media/TranscriptSync.tsx` and `src/components/media/TranscriptPanel.tsx` render timed segments and track playback time; `src/api/video-extracts.ts` wraps native `create_video_extract`.
- `src/components/audio/MiniAudioPlayer.tsx` and `src/stores/audioPlaybackStore.ts` drive global audio/TTS playback.
- `src/components/viewer/EPUBViewer.tsx`, `src/components/viewer/MarkdownViewer.tsx`, and `src/components/viewer/htmlReader/readerThemeTokens.ts` handle styled document content and theming.

## Goals / Non-Goals

**Goals:**
- Bind transcript text selections cleanly to `[startTime, endTime]` timestamp intervals with pure helper `resolveTranscriptSelectionBounds`.
- Keep the TTS PiP player persistent across tabs, adding `[B]` 30s rolling capture and distinct Voice A / Chime + Voice B role profiles.
- Make dense tables/math/code readable on any viewport via `BreakoutOverlayModal` pan/zoom (`0.5x–3.0x`).
- Anchor contextual AI Socratic threads beside highlighted text (`Cmd/Ctrl + J`) with 1-click promotion to durable extracts/flashcards.

**Non-Goals:**
- Shipping new local Whisper/Chatterbox native binaries (uses existing TTS/transcript APIs cleanly and degrades gracefully if offline).

## Decisions

### 1. Transcript Selection Bounds Resolver
Pure utility `resolveTranscriptSelectionBounds(segments, selectionRangeOrText)`:
- Maps selected transcript segment `data-segment-index` start & end (or substring match across joined segment texts) -> `{ startTime: Math.floor(first.start), endTime: Math.ceil(last.end), transcriptText }`.
- Rejects collapsed selections (`startTime >= endTime` or empty text).

### 2. Audio Role Voices & `[B]` 30s Rolling Buffer (`src/stores/audioPlaybackStore.ts`)
- Extend store state:
  - `playbackRate: number` (default `1.0`, allowed `1.0 | 1.25 | 1.5 | 2.0 | 2.5`)
  - `pipCollapsed: boolean`
  - `contentRole: "extract" | "qa_prompt" | "summary"`
  - `voiceRoleConfig: { extractVoiceId: string; promptVoiceId: string; chimeEnabled: boolean }`
  - `bookmarkLast30s: () => { startTime: number; endTime: number; text: string } | null`
- When `contentRole` transitions between `"extract"` and `"qa_prompt" | "summary"`, invoke lightweight WebAudio two-tone chime (`playRoleTransitionChime()`) if enabled and non-test/browser-supported, then apply the matching voice ID on next TTS chunk request.

### 3. Table / Math / Code Breakout Overlay (`src/components/viewer/BreakoutOverlayModal.tsx`)
- Props: `{ isOpen: boolean; title?: string; contentHtml?: string; contentNode?: ReactNode; onClose: () => void }`.
- Transform state: `{ scale: number; offsetX: number; offsetY: number }` clamped `0.5 <= scale <= 3.0`.
- High-contrast tokens read directly from `readerThemeTokens` so dark/sepia/high-contrast reader palettes stay cohesive.

### 4. Socratic Margin Thread (`src/components/viewer/SocraticMarginThread.tsx`)
- Props: `{ isOpen: boolean; documentId: string; selectedText: string; onClose: () => void; onConvertToExtract: (payload) => Promise<void>; onConvertToFlashcard: (payload) => Promise<void> }`.
- Shortcut `Cmd/Ctrl + J` registered inside `DocumentViewer.tsx` and `ExtractScrollItem.tsx` when selection text is non-empty (or toggles last thread).
- Coordinates directly with `GracefulAiFallbackCard` (`ux-05`) if AI generation fails or times out so user prompts and selected quotes are never lost.

## Risks / Trade-offs

- **WebAudio Chime in Automated Tests**: Headless JSDOM lacks `window.AudioContext`. **Mitigation**: Guard `typeof window !== "undefined" && typeof window.AudioContext === "function"` inside `playRoleTransitionChime()` so unit tests execute deterministically without mocks failing.

## Migration Plan

1. Add `resolveTranscriptSelectionBounds` & `Capture Video Slice` UI (`UX04-T01`).
2. Upgrade `audioPlaybackStore` & `MiniAudioPlayer` with PiP collapse, speed steps, Role Voices, and `[B]` 30s bookmark (`UX04-T02`).
3. Create `BreakoutOverlayModal` and attach triggers in EPUB/Markdown/Extract viewers (`UX04-T03`).
4. Create `SocraticMarginThread` and bind `Cmd/Ctrl + J` in `DocumentViewer` (`UX04-T04`).
