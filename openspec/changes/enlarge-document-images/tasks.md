## 1. Shared Image Viewer

- [x] 1.1 Build the reusable, accessible image overlay with fit, zoom-in, zoom-out, 100-percent, and pan behavior; verify scale, bounds, aspect ratio, and pan with component tests.
- [x] 1.2 Add modal focus containment, Escape and backdrop dismissal, focus restoration, and background scroll locking; verify these behaviors with accessibility and interaction tests.
- [x] 1.3 Add touch pinch/drag support and safe-area-aware mobile controls; verify touch gestures do not scroll the document behind the overlay.

## 2. Reader Integrations

- [x] 2.1 Add keyboard-reachable image activation, accessible names, captions, and an enlarge affordance in Markdown content; verify pointer, Enter, and Space activation in MarkdownViewer tests.
- [x] 2.2 Add delegated activation to the loaded HTML/article iframe and clean up handlers when its document changes; verify the viewer opens and closes without duplicate callbacks in HTML reader tests.
- [x] 2.3 Add activation to each mounted EPUB content document and route open/close through the owning reader; verify clicking an image does not trigger page-turn zones and EPUB location is preserved.
- [x] 2.4 Reuse the shared viewer for PDF reflow visual assets; verify figure, table, equation, and unknown-visual assets still open and Original PDF page zoom remains unchanged.

## 3. Compatibility and Validation

- [x] 3.1 Add localized strings for viewer controls and generic image descriptions; verify the strings resolve across supported app locales.
- [x] 3.2 Add regression coverage for responsive and resolved local asset sources, alt text/caption display, selection preservation, and focus return when the source image is no longer mounted.
- [x] 3.3 Run focused Markdown, HTML, EPUB, and PDF reflow viewer tests plus `openspec validate enlarge-document-images --strict`; verify all scenarios pass and the change validates.
