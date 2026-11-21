## Context

PDF.js owns page annotation layout and the Reader owns navigation tickets, offsets and position persistence.

## Goals and scope

Route embedded internal destinations through existing navigation. Improve page labels, reader layouts and on-demand navigation tools without a second renderer. Follow the [program invariants and verification matrix](../../planning/pdf-first-class-document-platform/README.md).

## Decisions

Use one document-scoped link adapter. Route destinations through the same navigation path as the outline, validate external URLs, and prevent embedded actions from launching privileged commands. Keep navigation physical and present printed labels separately.

Extend existing toolbar/sidebar surfaces with virtualized thumbnails, outline, bookmarks and history. Qualify two-page spreads and cover alignment before persistence. Reader rotation, crop, spread and zoom are view preferences with source geometry mapped through the page viewport.

## Interaction and accessibility

Desktop keeps the document center visible and opens one contextual navigation surface at a time. Mobile uses the existing compact reader controls and dismissible panels. Thumbnail work is requested only while its panel is visible. Keep keyboard access to page input and outline without depending on hover. Page labels have a separate accessible description and never replace the numeric input.

Persist navigation history at settled user destinations, including the reader mode and source point when available. Back and forward use the same navigation ownership tokens as outline, search and citation jumps so slow renders cannot overwrite recent user movement. A link inside an annotation layer receives pointer and keyboard activation, while the layer background allows selection through to the text.

## Risks and verification

Layer hit testing can interfere with selection and OCR. Virtualized navigation must preserve history and never remount all page canvases.

The delta scenarios define the functional gates. Use deterministic fixtures for invariants and record device-dependent verification separately in the program ledger.
