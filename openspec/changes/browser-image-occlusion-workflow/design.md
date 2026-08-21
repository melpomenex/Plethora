## Context

Creating Image Occlusion flashcards from online diagrams (anatomy, architecture, scientific diagrams, language charts) is currently a detached, multi-step process. Users must save the image to disk, open Plethora, navigate to the Image Registry, click "Create Occlusion Cards", and manually draw every box.

This design connects browser image capture directly to Plethora's desktop `ImageOcclusionComposer` using deep linking and event bridges, and adds assistive label detection (deterministic local OCR + optional vision LLM) to turn labeled diagrams into review-ready sibling occlusion cards with minimal friction.

## Goals / Non-Goals

**Goals:**
- Provide a browser context menu action "Create Image Occlusion in Plethora".
- Seamlessly ingest the image into the Image Registry and open the desktop `ImageOcclusionComposer` with the image pre-loaded.
- Support deep linking (`plethora://occlusion/create?assetId=...`) and Tauri event bridge dispatching to bring the desktop window to focus.
- Offer deterministic OCR-based label detection (`ocrImageLabelsForOcclusion` / Tesseract.js / Rust OCR) to automatically propose bounding boxes for printed text callouts.
- Offer optional vision model enhancement via `useOcclusionAssist` when the user has configured an enabled provider.
- Keep the preview assistive and non-destructive: users inspect, toggle, resize, or delete proposed masks before saving.
- Output cards adhering to the shared `occlusionSetId` and default "Hide All, Guess One" review architecture from Change 1.
- Operate fully offline when no AI provider is available.

**Non-Goals:**
- Autonomous background card creation without user preview (always requires user confirmation).
- In-browser mini canvas editor (authoring stays in Plethora's desktop composer).
- Mandating paid cloud vision models for diagram capture.

## Decisions

### 1. Unified Pipeline: Browser Capture → Registry Asset → Composer Handoff
- **Decision**: The browser extension captures the image, posts it to the Image Registry ingestion API (`POST /api/image-registry/ingest`), and upon success, triggers the desktop composer via Tauri event / deep link (`plethora://occlusion/create?assetId=<asset_id>`).
- **Rationale**: Reuses the canonical Image Registry storage from Change 2, ensuring the image is a first-class reusable asset rather than an orphaned temporary payload.
- **Alternatives Considered**:
  - *Sending base64 directly to composer memory*: Rejected because the image would not be saved in the Image Registry, breaking reusability.
  - *Opening web editor in browser tab*: Rejected because Plethora is a local desktop application and all card/database management lives locally.

### 2. OCR-First Deterministic Label Detection
- **Decision**: Use local OCR (`ocrImageLabelsForOcclusion` via Android ML Kit / Rust Tesseract) as the primary detection mechanism for diagram text boxes, with optional vision LLM refinement (`useOcclusionAssist`).
- **Rationale**: Printed labels on anatomy, biology, and systems diagrams are text callouts. Deterministic OCR is fast, free, runs offline, and produces exact pixel coordinates without spending user inference tokens.
- **Alternatives Considered**:
  - *Vision LLM only for bounding boxes*: Rejected because general LLMs are prone to coordinate hallucination, high latency, and require internet/API keys.

### 3. Assistive Proposal Canvas State
- **Decision**: Detected or AI-suggested masks land in `session.suggestions` (distinct dashed bounding boxes) in `ImageOcclusionComposer.tsx`. Users can click "Accept All", accept individual boxes, or tweak boundaries before committing.
- **Rationale**: Prevents junk or unwanted cards from polluting the user's review queue.

## Risks / Trade-offs

- [Risk] Operating system window focus stealing rules might prevent background Plethora window from coming to the front. -> Mitigation: In `browser_sync_server.rs`, invoke `app_handle.get_webview_window("main").unwrap().set_focus()` and unminimize.
- [Risk] Diagram text might be rotated, handwritten, or low-contrast. -> Mitigation: OCR filtering drops low-confidence noise, and the user can easily draw or adjust manual boxes in the canvas.
- [Risk] AI provider rate limits or latency during refinement. -> Mitigation: "Auto-detect labels" runs local OCR immediately; "Refine with AI" is an explicit secondary button that never blocks manual authoring.

## Migration Plan

1. Add `save-and-create-occlusion` context menu item in `browser_extension/background.js`.
2. Add deep-link / IPC trigger in `src-tauri/src/browser_sync_server.rs` that emits `plethora:create-image-occlusion` and focuses the window.
3. Update `src/components/occlusion/OcclusionComposerHost.tsx` to handle auto-detection flags if requested.
4. Add "Auto-detect labels" button in `src/components/occlusion/ImageOcclusionComposer.tsx` wired to `ocrImageLabelsForOcclusion`.
5. Verify end-to-end flow from browser right-click to desktop composer to review card generation.

## Open Questions

- None blocking. Support for mobile capture can utilize the native Android share intent receiver in a subsequent update.
