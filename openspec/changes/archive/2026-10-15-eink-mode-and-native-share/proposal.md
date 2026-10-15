## Why

Incrementum on mobile devices currently runs the same general visual presentation and relies heavily on manual in-app file/URL dialogs for content capture. On E-ink Android devices (such as BOOX/Onyx, Palma-class hardware, and e-readers), standard mobile UI suffers from ghosting, slow animated transitions, low contrast, and unoptimized touch/hardware controls. Concurrently, capturing articles, books, PDFs, and excerpts on mobile requires launching Incrementum and navigating import modals rather than sharing directly from external apps (browsers, email, file managers, reading apps).

This change introduces two tightly coupled mobile capabilities: **True E-Ink Mode** (a dedicated high-contrast, zero-unnecessary-animation, paginated, hardware/tap-friendly reading profile with conservative auto-detection) and **Native Mobile Share Sheet / Share Target Integration** (Android share intents and iOS share handling that securely stages content and feeds Incrementum's existing document and URL import pipelines).

## What Changes

- **E-Ink Display Mode & Capabilities**:
  - Add a dedicated Display Mode setting (`Standard`, `E-Ink`, `Auto`) persisted per-device.
  - Implement conservative device auto-detection (e.g. Onyx/BOOX hardware heuristics) with manual override always available.
  - Provide a monochrome, high-contrast visual profile via `data-display-mode="eink"` stripping glassmorphism, gradients, backdrop blurs, shadows, and decorative animations while preserving original document media by default.
  - Enforce `effectiveReducedMotion = true` and `scroll-behavior: auto` when E-Ink mode is active.
  - Provide paginated reading defaults and discrete page advancement for EPUB, PDF, and reflowed articles.
  - Add optional reader tap zones (left: prev, right: next, center: toggle chrome) that do not interfere with text selection or zooming.
  - Add optional hardware volume-button page navigation for active reading sessions (with media playback precedence and clean listener disposal).
  - Provide an extensible `EinkCapabilities` / `EinkController` abstraction layer for optional vendor-level refresh control.
- **Native Mobile Share Target & Universal Capture**:
  - Implement Android native share intent filters (`ACTION_SEND`, `ACTION_SEND_MULTIPLE`) for URLs, text, PDFs, EPUBs, images, audio, and documents.
  - Safely resolve and stage Android `content://` URIs natively into app-private storage without passing huge binary blobs across the JS bridge.
  - Implement a durable native share payload queue and state machine ensuring cold-start, warm-start, and repeated background shares are never lost.
  - Normalize incoming OS shares into a typed `SharedPayload` model and route directly into Incrementum's existing URL, arXiv, and file import pipelines.
  - Preserve provenance for shared text + source URLs (capturing both excerpt and source context).
  - Retain offline URL shares with pending status indicators for deferred fetching.
  - Support batch multi-file sharing with per-item progress and fault-tolerant completion.
  - Add iOS Share Extension integration architecture using App Group container staging.

## Capabilities

### New Capabilities
- `eink-display-mode`: Dedicated high-contrast, zero-animation rendering profile, device detection, paginated reading, tap zones, and hardware volume key navigation for E-ink devices.
- `native-mobile-share-target`: Native OS share sheet receiver and universal capture pipeline for Android and iOS routing into Incrementum document stores.

### Modified Capabilities
<!-- None: existing capability requirements in openspec/specs/ remain unchanged. -->

## Impact

- **Mobile Native Layers**: Android `MainActivity.kt`, `FolderImportPlugin.kt` / native share bridge, `AndroidManifest.xml`, iOS plugins/extension contracts.
- **Presentation & Theme Architecture**: `PresentationContext.tsx`, `usePresentation.ts`, `theme.ts`, `index.css`, and global CSS tokens.
- **Readers & Viewers**: `EPUBViewer.tsx`, `PDFViewer.tsx`, `DocumentViewer.tsx`, and reader navigation hooks.
- **Import Pipeline & Stores**: `documentStore.ts`, `documents.ts`, `documentImport.ts`, `MainLayout.tsx`.
- **Settings**: Appearance & Capture/Share settings sections in `settingsStore.ts` and `SettingsPage.tsx`.
