# Proposal: Ingestion Airlock Staging Buffer & Asymmetric Mobile Ergonomics

## Why

Two ends of the Plethora pipeline overload the user differently:
1. At **ingestion**, incoming web clips, long Markdown/HTML articles, PDFs, EPUBs, and YouTube playlists either dump straight into the priority queue unranked (flooding active study) or sit invisibly in `ImportNeedsReviewTab` without fast keyboard triage or automatic chapter/H2 chunking.
2. On **mobile viewports** (e.g. Android Tauri APK / PWA on commute), desktop top/spread docks force two-handed gripping and awkward text-selection handles, lacking a Commute Audio Queue mode, a one-handed bottom thumb-arc for grading/priority nudging, and double-tap paragraph instant capture to the desktop processing inbox.

## What Changes

### ADDED
- **Ingestion Airlock (Staging Buffer)**: `IngestionAirlockModal.tsx` and deterministic Markdown/HTML heading splitter `documentHeadingSplitter.ts` presenting incoming clips/documents/playlists with 1-keystroke destination routing (`[1]` Active Course High-Priority `P10`, `[2]` Evergreen Low-Priority `P65`, `[3]` Reference Only / Vault) plus a 1-click **Pre-Chunk by Chapter / H2 Headings** toggle for long documents.
- **Asymmetric Mobile Ergonomics**: Upgrade `MobileQueueView.tsx` with:
  - **Commute Audio Queue** toggle binding hands-free playback + audio scrub controls.
  - **One-Handed Bottom Thumb-Arc** hosting SRS rating pills (`Again`, `Hard`, `Good`, `Easy`) and priority nudge buttons within single-thumb arc bounds at the bottom right/center.
  - **Double-Tap Paragraph Instant Extraction**: Double-tapping a rendered paragraph immediately captures it as an inbox extract destined for the desktop processing inbox with subtle tactile visual feedback.

### MODIFIED
- **`ImportNeedsReviewTab` / `TabRegistry.tsx` & `SplitDocumentDialog.tsx`**: Route staged imports through `IngestionAirlockModal` and reuse `splitDocumentByHeadings`.
- **`src/components/mobile/MobileQueueView.tsx`**: Adopt Commute Audio Queue mode, Bottom Thumb-Arc dock, and double-tap paragraph capture.

### REMOVED
- None. Existing import tabs and mobile navigation routes remain functional.

## Capabilities

### New Capabilities
- `ingestion-airlock-mobile-ergonomics`: Keyboard-driven Ingestion Airlock staging buffer with automatic Chapter/H2 pre-chunking, plus asymmetric mobile ergonomics featuring Commute Audio Queue, Bottom Thumb-Arc grading/priority controls, and double-tap paragraph instant extraction.

### Modified Capabilities
- None.

## Impact

- **Frontend Utilities & Import UI**: `src/utils/documentHeadingSplitter.ts` (new), `src/components/import/IngestionAirlockModal.tsx` (new), `src/components/tabs/TabRegistry.tsx`, `src/components/viewer/SplitDocumentDialog.tsx`.
- **Frontend Mobile**: `src/components/mobile/MobileQueueView.tsx` (plus coordinate cleanly with `ux-03` audio commute playlist preset and `audioPlaybackStore`).
- **Risks**: Double-tap detection on touch screens can conflict with browser zoom/selection. **Mitigation**: Handle clean `onDoubleClick` / timed pointer tap gap (`< 320ms` within `16px` radius) specifically on paragraph blocks (`[data-mobile-extractable="true"]`) with `touch-action: manipulation`.
