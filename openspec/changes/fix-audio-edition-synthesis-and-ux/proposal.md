## Why

When a user initiates "Create Audio Edition" from the document library context menu, the dialog receives a document summary object whose `content` and `metadata` are `null` (because library list queries intentionally omit large payload columns). Consequently, section extraction finds no body text, resulting in a single fallback section with 0 characters containing only the document's title. Synthesis via TTS (such as local Pocket TTS) only speaks this title, completing in 2 seconds and erroneously marking the edition as finished. Furthermore, the application provides insufficient visual feedback that an audio edition is being synthesized, failing to reflect background job progress across the Documents view, Toolbar, and Audiobooks tab.

## What Changes

- **Document Hydration in Audio Edition Dialog**: Hydrate the complete document (`getDocument(id)`) upon opening `CreateAudioEditionDialog`, displaying a loading skeleton while content loads and preventing creation if the document contains no readable text.
- **Robust Semantic Section Extraction**: Update EPUB, PDF, and article section extractors to ensure sections contain actual body content, falling back to full-text semantic chunking if TOC/outline matching produces empty section text.
- **Empty & Truncated Synthesis Guardrails**: Guard the synthesis queue against generating sections with empty content or title-only text when source content is available, preventing premature job completion.
- **Cross-Application Synthesis Feedback**:
  - Show a toast notification upon starting generation with a direct action to view progress in the Audiobooks tab.
  - Display active generation indicators and progress percentages on document cards/rows in `DocumentsView`.
  - Display an active background synthesis indicator on the Audiobooks item in `Toolbar`.
  - Overhaul `AudiobooksTab` audio editions shelf with real-time progress bars, section counters (e.g. "Section 2 of 10"), accurate status badges (prioritizing generating state over partial readiness), auto-refreshing on store updates, and user controls for pause, resume, and cancellation.

## Capabilities

### New Capabilities
- `audio-edition-creation-and-ux`: Covers document hydration before audio edition configuration, validated multi-section extraction, end-to-end background synthesis progress tracking, and ambient UX indicators across library, toolbar, and audiobooks views.

### Modified Capabilities

None.

## Impact

- `src/components/audio/CreateAudioEditionDialog.tsx`: Full document hydration, loading states, validation against empty content, launch toast.
- `src/utils/sectionIndex.ts`: Fallback to article/paragraph chunking when EPUB/PDF TOC mapping yields empty chapter bodies.
- `src/stores/audioEditionGenerationStore.ts`: Guardrails against empty text synthesis, enhanced progress events.
- `src/components/tabs/AudiobooksTab.tsx`: Fixed badge prioritization, real-time section progress bars, edition store reactivity, pause/resume/cancel actions.
- `src/components/documents/DocumentsView.tsx`: Active generation badge on document items.
- `src/components/Toolbar.tsx`: Active synthesis indicator badge on the Audiobooks rail button.
