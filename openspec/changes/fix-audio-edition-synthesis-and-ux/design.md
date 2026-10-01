## Context

In Plethora, document queries from the library (`getDocuments()`) return lightweight summaries where `content`, `content_hash`, and `metadata` are `null` to conserve memory and IPC bandwidth. When a user right-clicks a document in `DocumentsView` and selects "Create Audio Edition", `CreateAudioEditionDialog` receives this unhydrated summary.

Because `doc.content` is empty, semantic section extraction produces a fallback dummy section with 0 characters containing only the document's title. Synthesis via Pocket TTS speaks this short title in ~2 seconds, marks the section and edition as "ready", and exits. Furthermore, the application lacks visible progress feedback across the library, toolbar, and audiobooks tab, leaving users confused about what happened.

See `proposal.md` for motivation and `specs/audio-edition-creation-and-ux/spec.md` for behavior requirements.

## Goals / Non-Goals

**Goals:**
- Hydrate full document content and metadata asynchronously inside `CreateAudioEditionDialog` before configuring or launching synthesis.
- Ensure semantic section extraction for EPUB, PDF, and articles reliably extracts body text, falling back to heading or paragraph chunking if TOC/outline mapping yields empty sections.
- Add strict validation to prevent creating or synthesizing audio editions with 0 characters or empty sections.
- Provide end-to-end UX: launch toast with direct navigation to Audiobooks tab, in-progress badges on library document cards/rows, active synthesis indicator on the toolbar Audiobooks button, and an overhaul of the Audiobooks shelf with progress bars, section counters, and job controls (pause/cancel/retry).

**Non-Goals:**
- Modifying the underlying Rust Pocket TTS inference model or audio formats.
- Changing `getDocuments()` to return full content by default (which would regress memory and startup performance).
- Altering existing billing consent or cloud TTS adapter protocols.

## Decisions

### 1. In-Dialog Asynchronous Hydration
- **Choice**: In `CreateAudioEditionDialog`, fetch the complete document using `getDocument(doc.id)` inside a `useEffect` on mount. Maintain local state: `isLoadingDoc`, `hydratedDoc`, and `loadError`.
- **Rationale**: Keeps `DocumentsView` responsive without lag before the modal opens. The dialog renders a clean skeleton/spinner while content is recovered and parsed.
- **Alternatives Considered**: Fetching full content in `DocumentsView` prior to opening the dialog. Rejected because it introduces an unresponsive pause when clicking the context menu item.

### 2. Resilient Section Extraction with Cascading Fallback
- **Choice**: In `src/utils/sectionIndex.ts`, update `extractEpubSemanticSections` and `extractPdfSemanticSections` so that if structural mapping yields empty section bodies or if `contentMap` doesn't match clean hrefs:
  1. Attempt to locate chapter titles within the full text and slice ranges.
  2. If resulting sections still contain 0 characters, cascade to `extractArticleSemanticSections(fullContent)` to partition by headings or 1,500-character paragraph groups.
  3. Filter out completely empty sections so that no section with 0 body characters is queued.
- **Rationale**: EPUBs and PDFs vary wildly in formatting; cascading ensures that whenever readable text exists, it is partitioned into meaningful audio chapters.
- **Alternatives Considered**: Requiring users to manually define chapters. Rejected as poor user experience for quick listening.

### 3. Queue Safety and Synthesis Validation
- **Choice**: In `CreateAudioEditionDialog`, disable the "Create Audio Edition" button and display a warning banner if `totalChars === 0`. In `audioEditionGenerationStore.ts`, check that `rawText.trim().length > 0` before sending text to the TTS adapter; if empty, throw an error to fail the section rather than silently speaking only the title.
- **Rationale**: Eliminates the 2-second false completion bug at both the UI entry point and the execution queue layer.

### 4. Cross-Application Ambient Progress Feedback
- **Toast**: When `handleCreate` submits, trigger `toast.info(t("audioEditions.generationStarted"), t("audioEditions.trackInAudiobooks"), { action: { label: t("audioEditions.viewAudiobooks"), onClick: () => addTab(...) } })`.
- **Toolbar**: In `src/components/Toolbar.tsx`, inspect `useAudioEditionGenerationStore((s) => s.activeJobs.length)`. If > 0, render a pulsing accent badge or waveform indicator on the `audiobook` button.
- **DocumentsView**: Add an indicator on document rows/cards matching `activeJobs.find(job => job.documentId === doc.id)` displaying an animated audio wave and percentage.
- **AudiobooksTab**:
  - Correct the badge logic: if `job?.status === "generating"`, always show "Generating X%" regardless of whether prior sections are ready.
  - Render an animated progress bar with section indicator: `Section ${completed + 1} of ${total} (${progressPercent}%)`.
  - Add Pause, Resume, and Cancel buttons connected to store actions.
  - Automatically re-fetch `editions` when active jobs update or complete.

## Risks / Trade-offs

- **[Risk] Large PDF or EPUB content recovery could take 1-3 seconds.**
  - *Mitigation*: Render an animated loading skeleton in `CreateAudioEditionDialog` with informative status text ("Reading document text...").
- **[Risk] User closes the app while generation is in progress.**
  - *Mitigation*: Audio edition sections are committed to SQLite with their individual `generationStatus`. On reload, incomplete sections remain queued or failed, and users can resume from the Audiobooks shelf.
