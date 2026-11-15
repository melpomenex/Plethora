# Design: Ingestion Airlock Staging Buffer & Asymmetric Mobile Ergonomics

## Context

- `src/components/tabs/TabRegistry.tsx` mounts `ImportNeedsReviewTab` for staged intake items; `src/components/viewer/SplitDocumentDialog.tsx` provides document splitting dialogs.
- `src/components/mobile/MobileQueueView.tsx` renders the mobile queue surface.

## Goals / Non-Goals

**Goals:**
- Prevent uncurated ingestion shock via fast `[1]`/`[2]`/`[3]` triage and deterministic Chapter/H2 splitting (`splitDocumentByHeadings`).
- Make mobile reading & review genuinely one-handed via Bottom Thumb-Arc controls, Commute Audio Queue mode, and zero-modal double-tap paragraph capture.

**Non-Goals:**
- Writing native Android platform background audio services in Kotlin/Rust beyond existing `audioPlaybackStore` + webview media session controls.

## Decisions

### 1. Deterministic Heading Splitter (`src/utils/documentHeadingSplitter.ts`)

```ts
export interface DocumentHeadingChunk {
  index: number;
  heading: string;
  content: string;
  charLength: number;
}

export function splitDocumentByHeadings(
  rawContent: string,
  options?: { minChunkChars?: number }
): DocumentHeadingChunk[]
```
- Supports both Markdown (`/^#{1,2}\s+(.+)$/gm` prioritizing H2 when present, falling back to H1) and HTML (`/<h[12][^>]*>(.*?)<\/h[12]>/gi`).
- Preserves preamble content before the first heading as `Introduction` when non-empty.
- Returns `[{ index: 0, heading: "Full Document", content: rawContent, charLength }]` cleanly if no headings exist.

### 2. Ingestion Airlock Modal (`src/components/import/IngestionAirlockModal.tsx`)

- Keyboard map (isolated when focus is inside title edit field):
  - `1`: Route as Active Course High-Priority (`prioritySlider: 10`, `status: "active"`)
  - `2`: Route as Evergreen Low-Priority (`prioritySlider: 65`, `status: "active"`)
  - `3`: Route as Reference Only (`prioritySlider: 95`, `status: "archived"`)
  - `c` / Checkbox: Toggle `preChunkByHeadings` (live preview shows resulting chunk count badge: `Will split into N sections`).

### 3. Mobile Queue Ergonomics (`src/components/mobile/MobileQueueView.tsx`)

- **Thumb-Arc Dock (`[data-mobile-thumb-arc="true"]`)**: Positioned fixed at bottom (`pb-safe`) using curved pill layout putting `Again`, `Hard`, `Good`, `Easy` on the primary bottom row and `-10 Urgent` / `+10 Later` / `Audio Commute` along the upper radial arc within single-thumb reach.
- **Double-Tap Paragraph Extraction**: Wrap rendered mobile paragraphs in elements carrying `data-paragraph-index={idx}` and `style={{ touchAction: "manipulation" }}`; bind `onDoubleClick` (plus touch double-tap timing helper `<320ms`) to invoke `onCaptureParagraphToInbox(paragraphText)` -> shows inline pill confirmation `"Saved to Desktop Inbox"`.

## Risks / Trade-offs

- **Malformed HTML Headings in Web Clips**: Nested spans inside `<h2><span>Title</span></h2>` can break naive regexes. **Mitigation**: Strip inner HTML tags from matched heading titles (`headingHtml.replace(/<[^>]+>/g, "").trim()`).

## Migration Plan

1. Implement `documentHeadingSplitter.ts` and `IngestionAirlockModal.tsx` (`UX06-T01`).
2. Enhance `MobileQueueView.tsx` with Commute Audio Queue toggle, Bottom Thumb-Arc dock, and Double-Tap Paragraph Capture (`UX06-T02`).
