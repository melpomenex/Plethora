## Context

See proposal.md. The original implementation used temporary scroll lockouts, page-number-driven pending navigation, and settle polling. Those mechanisms could finish without resolving a heading and could expire before stale restoration ran. Existing EPUB navigation and reader TTS contracts are amended in their original pending changes rather than duplicated.

## Goals / Non-Goals

**Goals:** A small authority model shared by readers, exact anchor resolution, cancellable asynchronous rendering, one initial restoration owner, event-driven readiness, and preservation of continuous and paginated behavior.

**Non-Goals:** Reader UI redesign, a PDF engine replacement, or changing persisted position formats.

## Decisions

1. Use explicit `initial-restoration`, `user-scroll`, `toc-navigation`, and `idle` states with monotonically increasing identities. Direct input and explicit navigation permanently revoke initial-restoration eligibility for the reader lifetime. A new navigation may interrupt user-scroll. Settling never re-enables restoration. Reject time-based authority expiration.
2. PDF TOC claims ownership before asynchronous destination lookup. Apply destinations independently of React page-number changes. Render/slot callbacks supply real page geometry; virtual placeholders cannot settle navigation. Verify actual clamped arrival in a layout frame. Map XYZ/Fit/FitH/FitBH/FitV/FitBV/FitR with PDF.js viewport conversion, including rotation, crop boxes, explicit XYZ zoom, and fit zoom derived from the scale-1 rotated viewport. Wait for the requested scale before applying coordinates.
3. Reflow resolves destination source coordinates against canonical source regions or prototype source rectangles, then scrolls the corresponding rendered block. Delayed analysis reruns only a still-active request. Page-level destinations may use a page section. Do not switch to fixed mode simply because analysis is pending.
4. EPUB fragments load the resolved spine document and become CFIs for the actual ID/name node. No index or chapter-only fallback may discard an anchor. Queue real display completion rather than epub.js's prematurely resolved display deferred; reject obsolete queued work and suppress in-flight stale manager scroll writes. Align the mounted continuous heading with 16px padding. Paginated CFIs retain column/page geometry.
5. Actual geometry changes may resize EPUB using the live CFI; relocation and a quiet-period timer cannot trigger redisplay. Install adapters after `rendition.started` creates the manager. Guard the engine's own resize path as well; geometry changes during TOC ownership defer until they can preserve that heading CFI. Iframe direct input is observed inside its document. Only paginated mode interprets vertical flicks as page turns; selection and horizontal back gestures remain available.
6. DocumentViewer selects initial saved/URL state; PDFViewer owns readiness and arrival verification. Parent verification/retry loops are removed. Standalone PDF fallback runs once per loaded document and uses geometry callbacks. Navigation-start and direct-input callbacks cancel the parent even for same-page TOC navigation. Completion persists the reached position and only the successful latest TOC synchronizes TTS. Returning to a mounted PDF tab cannot replay saved state. Retain measured page heights through virtualization and reuse their prefix offsets instead of replacing them with estimates.
7. TTS follow observes real input inside EPUB documents and pauses immediately, including during programmatic-arrival grace. A navigation-start event scoped to the reader cancels queued follow before asynchronous destination resolution. Re-center remains the explicit way to resume follow. Existing audiobook sync remains a separate explicit host-controlled workflow.

## Risks / Trade-offs

- [EPUB engine internals] → Small adapter, queued/in-flight regression tests, pinned epub.js API, and real Android matrix. Native manager trimming outside display work stays available.
- [Malformed EPUB anchors] → Report a missing heading instead of claiming successful chapter-only navigation.
- [Missing PDF semantic blocks] → Wait for analysis readiness while the request owns the viewport; manual input cancels it. Device verification must include OCR and sparse reflow documents.
- [Physical WebView timing] → Automated jsdom tests cannot certify Android selection handles, renderer layout, inertia or system back gestures. All such rows stay pending until performed.

## Migration Plan

No data migration. Replace conflicting writer paths in place. Keep existing specifications, bookmark and saved-position formats. Run focused reader tests, TypeScript, relevant lint, local benchmark/bundle gate, and OpenSpec validation. Archive only after the outstanding device validation is performed or explicitly deferred by the user.
