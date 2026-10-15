## 1. Document Hydration and Dialog Safety

- [x] 1.1 Add asynchronous document hydration (`getDocument(doc.id)`) inside `CreateAudioEditionDialog`, displaying a loading skeleton/spinner while content is being retrieved, and verify with unit test that unhydrated library summaries trigger hydration.
- [x] 1.2 Add empty content validation in `CreateAudioEditionDialog`, disabling the creation button and showing an alert banner when total character count is 0, and verify through unit tests.

## 2. Resilient Semantic Section Content Extraction

- [x] 2.1 Update `extractEpubSemanticSections` in `src/utils/sectionIndex.ts` to fallback to chapter title matching in `rawContent` or `extractArticleSemanticSections` when `contentMap` href matching yields empty bodies, and verify with EPUB fixture tests.
- [x] 2.2 Update `extractPdfSemanticSections` in `src/utils/sectionIndex.ts` to fallback to semantic article chunking when outline title matching in `fullContent` fails or yields 0 characters, and verify with PDF outline tests.
- [x] 2.3 Filter and discard empty/whitespace-only sections from extracted results in `sectionIndex.ts`, ensuring every section has character count > 0, and verify with unit tests.

## 3. Queue Safety and Section Synthesis Guardrails

- [x] 3.1 In `src/stores/audioEditionGenerationStore.ts`, validate that each section has non-empty text before passing to the TTS adapter, throwing a clear error to fail the section rather than synthesizing the title alone, and verify with unit tests.
- [x] 3.2 Ensure `audioEditionGenerationStore` correctly reports failed sections and marks edition status as "failed" when all sections fail or "error" if any fail, and verify with queue status tests.

## 4. Cross-Application UX and Ambient Progress Indicators

- [x] 4.1 In `CreateAudioEditionDialog.tsx` and `DocumentsView.tsx`, trigger an informative toast notification upon audio edition creation with an action button to open the Audiobooks tab, and verify toast dispatch.
- [x] 4.2 In `src/components/documents/DocumentsView.tsx`, display an active audio edition synthesis indicator (pulsing waveform icon and progress percentage) on document list rows/cards corresponding to active generation jobs, and verify with rendering test.
- [x] 4.3 In `src/components/Toolbar.tsx`, display an active synthesis badge or animation on the Audiobooks navigation button when `activeJobs.length > 0`, and verify via Toolbar test.

## 5. Audiobooks Shelf Generation Monitoring and Controls

- [x] 5.1 In `src/components/tabs/AudiobooksTab.tsx`, fix the badge status logic so `job?.status === "generating"` takes precedence over partial readiness, preventing partially generated editions from appearing as "ready", and verify with component tests.
- [x] 5.2 In `src/components/tabs/AudiobooksTab.tsx`, render real-time progress bars, section counters ("Section X of Y"), and pause/resume/cancel buttons wired to `useAudioEditionGenerationStore`, and verify interactive controls.
- [x] 5.3 In `src/components/tabs/AudiobooksTab.tsx`, subscribe to store updates so the editions list reactively updates when jobs start, advance, or finish without requiring manual tab reload, and verify reactivity.

## 6. End-to-End Verification and Regression Gate

- [x] 6.1 Run full unit and integration test suite (`npm run test`) to ensure all existing and new tests pass.
- [x] 6.2 Run benchmark check (`npm run bench:check`) and script tests (`npm run test:scripts`) to pass the repository gate.
