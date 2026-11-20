## Context

See proposal.md for motivation and specs/document-image-viewer/spec.md for the behavior contract. The reader surfaces already represent embedded figures differently: Markdown content is rendered into a content root; HTML/article documents are prepared and displayed in a same-origin `srcDoc` iframe; EPUB sections use content hooks for each section iframe; and PDF reflow already owns a zoomed-asset modal. A standalone image document has its own zoom-and-pan viewer, while Original PDF view zooms the whole page.

Constraints:

- Reader position, selections, theme, and responsive asset resolution belong to each reader and must survive opening and closing an overlay.
- HTML and EPUB content can live in separate iframe documents, so event listeners must be attached to each current content document and removed when it is replaced.
- Reuse existing rendered image sources and avoid introducing a new media dependency or persistence format.

## Goals / Non-Goals

**Goals:**

- Give supported document images a consistent, accessible activation and inspection experience.
- Keep the same fit, zoom, pan, close, and focus-return behavior across Markdown, HTML/article, EPUB, and PDF reflow images.
- Support pointer, keyboard, and touch use without scrolling or navigating the reader behind the viewer.

**Non-Goals:**

- Add gallery navigation, image editing, download, annotation, or image-registry actions to this viewer.
- Extract individual figures from the PDF page canvas in Original view; that view continues to zoom the whole page.
- Replace the standalone image-document viewer or its Mirage/image-occlusion tools.

## Decisions

### 1. Use one reusable image-viewer component with per-reader ownership

Create a shared overlay component for image presentation, zoom state, pan gestures, dialog focus, and dismissal. Each reader owns the selected image and trigger reference, then renders the shared overlay in its existing React surface. This avoids duplicated interaction logic while keeping reader-specific image lifecycle and position state local.

Alternative considered: build separate lightboxes for Markdown, HTML, EPUB, and PDF. Rejected because it would let accessibility, zoom limits, and touch behavior drift across surfaces.

### 2. Activate generated content through delegated reader integration

For Markdown, attach activation and keyboard semantics at the rendered content root. For HTML/article content, attach a delegated listener to the loaded same-origin iframe document. For EPUB, install the equivalent handler in each `rendition.hooks.content` callback and route the request to the owning React reader. PDF reflow can pass its existing asset request directly to the shared overlay.

Use a visible zoom affordance and accessible image label without rewriting source document HTML. Listener setup must be idempotent per content document and cleanup must run when a frame or reader is replaced.

Alternative considered: rewrite source HTML images as button markup. Rejected because it mutates imported or publisher content and risks breaking its layout and semantics.

### 3. Reuse the rendered image source and keep the modal independent of storage

Open the source currently selected by the browser (`currentSrc`, falling back to `src`) or the already-resolved PDF reflow asset URL. Keep the current image's alt text and nearest caption with the viewer state. Do not persist image URLs or fetch a separate original as part of opening the viewer.

Alternative considered: resolve image paths again or request a higher-resolution copy when opening. Rejected because readers may already use resolved local assets, responsive sources, or temporary object URLs; re-resolving could fail or fetch the wrong resource.

### 4. Start at fit and make zoom operations explicit

Initialize each open image to a fit-to-viewport scale with preserved aspect ratio. Provide labeled zoom-in, zoom-out, fit, and 100-percent controls. Use pointer gestures for pan and wheel/pinch gestures for zoom, with bounded scales and pointer capture; keyboard `+`, `-`, and `0` map to the same zoom actions.

This makes the complete image immediately inspectable while still giving users a reliable way to read small details. Reset scale and pan on each new image open.

### 5. Treat the viewer as a modal that restores the reader trigger

Render the overlay above reader chrome with dialog semantics, a visible close button, Escape and backdrop dismissal, focus containment, and focus restoration. Lock background scrolling while open. Keep the original iframe and document mounted so scroll, CFI/page location, text selection, and reader state are preserved without saving/restoring a second copy.

Alternative considered: navigate to a separate image route or replace the document view. Rejected because it would interrupt reading and require extra position restoration logic.

## Risks / Trade-offs

- [Risk] Iframe reloads or EPUB section replacement can leave stale listeners or callbacks. → Mitigation: scope handlers to the current content document, install once, and dispose on reader lifecycle changes.
- [Risk] Reader gestures such as page-turn tap zones can conflict with the new activation or pinch gestures. → Mitigation: stop propagation only for image activation and modal gestures, preserve normal input elsewhere, and verify EPUB/mobile interactions explicitly.
- [Risk] Full-screen overlays can hide useful captions or controls on small screens. → Mitigation: use safe-area-aware layout, fit the image to the remaining viewport, and keep controls at touch-friendly sizes.
- [Risk] A selected image backed by a revoked object URL could fail while the viewer is open. → Mitigation: keep the existing reader/asset owner mounted until the overlay closes and display an accessible failure state if decoding still fails.

## Migration Plan

No data migration or dependency change is required. Implement the shared overlay, wire each supported reader surface, align PDF reflow behavior, then add focused interaction coverage for desktop, keyboard, iframe, EPUB, and touch paths. Rollback consists of removing the activation hooks and shared overlay while retaining the existing reader and standalone image-document zoom behavior.
