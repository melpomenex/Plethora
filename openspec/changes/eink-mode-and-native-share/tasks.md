## 1. Display Mode & E-Ink Capabilities Foundation

- [x] 1.1 Add display mode types (`DisplayMode: 'standard' | 'eink' | 'auto'`) and E-ink capability interfaces in `src/types/display.ts` or `src/types/settings.ts`.
- [x] 1.2 Implement per-device local storage persistence and conservative auto-detection for E-ink hardware in `src/lib/displayMode.ts`.
- [x] 1.3 Update `PresentationContext.tsx` to manage `displayMode`, `isEinkMode`, and inject `data-display-mode` and `data-reduced-motion` onto document root.

## 2. E-Ink CSS Styling & Ghosting Reduction

- [x] 2.1 Add global high-contrast monochrome styles and eliminate gradients, shadows, and glassmorphism for `:root[data-display-mode="eink"]` in `src/index.css`.
- [x] 2.2 Disable all CSS transitions, animations, shimmer skeletons, and continuous repaints when E-ink mode is active.
- [x] 2.3 Ensure flashcard rating buttons, badges, and status indicators have distinct geometric shapes and borders that do not depend on color.

## 3. Reader E-Ink Optimizations & Minimal Chrome

- [x] 3.1 Implement reader tap-zone helper and minimal chrome toggle in `src/components/viewer/`.
- [x] 3.2 Update `EPUBViewer.tsx` and `PDFViewer.tsx` to default to paginated discrete page replacement in E-ink mode.
- [x] 3.3 Ensure tap zones and page transitions preserve text selection, annotations, and zooming without touch conflicts.

## 4. Hardware Volume Button Page Navigation

- [x] 4.1 Implement reader volume button key handler hook (`useReaderVolumeNavigation`) with media playback and text input checks.
- [x] 4.2 Connect Android key dispatching in `MainActivity.kt` to allow reader `preventDefault()` while keeping standard volume adjustment when audio/video is playing.
- [x] 4.3 Ensure volume key listeners are reliably detached on reader unmount.

## 5. Native Mobile Share Target — Android & Bridge

- [x] 5.1 Update `AndroidManifest.xml` with intent filters for `ACTION_SEND` and `ACTION_SEND_MULTIPLE` supporting URLs, text, PDFs, EPUBs, images, audio, and documents.
- [x] 5.2 Implement native `content://` URI streaming to `<filesDir>/imports/` in `FolderImportPlugin.kt` and `MainActivity.kt` with thread-safe queueing.
- [x] 5.3 Expose native IPC command to consume and listen for structured share payloads (`register_share_listener` / `get_pending_shares`).

## 6. Normalized Shared Payload & Import Routing

- [x] 6.1 Define normalized `SharedPayload` model in `src/types/share.ts` and handle payload deserialization in `src/lib/shareTarget.ts`.
- [x] 6.2 Wire shared URLs and files into `useDocumentStore` (`importFromUrl`, `importFromFiles`, text+provenance extraction, offline URL queue).
- [x] 6.3 Add multi-file batch share handling with progress indication and error resilience.

## 7. Settings UI & User Feedback

- [x] 7.1 Add E-Ink display mode and reader preference controls in `src/components/settings/`.
- [x] 7.2 Add share capture settings and feedback toasts with direct "Open" actions.
- [x] 7.3 Update localization strings for E-Ink and Share settings.

## 8. Verification & Regression Tests

- [x] 8.1 Add unit tests for display mode resolution, persistence, and reduced motion overrides.
- [x] 8.2 Add unit tests for `SharedPayload` parsing, text+URL provenance, and batch file staging.
- [x] 8.3 Add unit tests for reader tap zones and volume key handling lifecycle.
- [x] 8.4 Run test suite, typecheck, and ensure performance/bundle budget checks pass.
