## Why

Learners encountering diagrams, anatomical charts, process maps, and foreign-language infographics online want to convert them into Image Occlusion flashcards without breaking their reading flow. Currently, creating occlusion cards from a web image requires a fragmented multi-step workflow: saving the file locally, opening Plethora, navigating to the registry, opening the composer, manually locating the image, and drawing every mask from scratch. Furthermore, diagram labels are usually printed text that deterministic OCR and vision models can detect automatically to save authoring effort.

## What Changes

- **Direct Browser Handoff**: Add a "Create Image Occlusion in Plethora" context menu action that captures the web image into the Image Registry and immediately opens Plethora's desktop `ImageOcclusionComposer` with that image pre-loaded.
- **Deep-Link / Bridge Protocol**: Use `plethora://occlusion/create?assetId=<id>` and Tauri event bridges to bring the Plethora window to the front and open the composer directly.
- **Automatic Label Detection (OCR-First)**: Provide an "Auto-detect labels" action powered by deterministic local OCR (`ocrImageLabelsForOcclusion` / Tesseract.js / Rust OCR) to automatically detect text callouts and propose candidate occlusion boxes.
- **Optional Vision Model Enhancement**: When a vision-capable LLM is configured (cloud or on-device), enhance OCR boxes with semantic question and answer pairing via `useOcclusionAssist`.
- **Assistive User-Controlled Preview**: Proposed masks are displayed in a non-destructive preview where users can toggle, resize, edit, or reject candidate boxes before saving. No cards are ever generated without explicit user review.
- **Offline & No-LLM Friendly**: The manual occlusion composer works completely offline without requiring any AI provider or paid inference.

## Capabilities

### New Capabilities
- `browser-occlusion-handoff`: Browser context menu, image capture, and deep-link / IPC triggering of the desktop Image Occlusion Composer with the captured asset preloaded.
- `automatic-label-occlusion`: OCR and Vision-assisted label detection, candidate mask generation, and interactive proposal preview in the composer.

### Modified Capabilities

## Impact

- **Browser Extension**: `browser_extension/background.js`, `browser_extension/content.js` updated to add the occlusion context menu and trigger the handoff.
- **Desktop Handoff & Router**: `src-tauri/src/browser_sync_server.rs`, `src/components/occlusion/OcclusionComposerHost.tsx` updated to handle deep links and incoming occlusion requests.
- **Composer & AI Assist**: `src/components/occlusion/ImageOcclusionComposer.tsx`, `src/components/occlusion/useOcclusionAssist.ts`, `src/api/ocrCommands.ts` updated to support automatic label proposal upon open.
