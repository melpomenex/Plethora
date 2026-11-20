## Why

Images embedded in a document are constrained to the reading layout, which makes diagrams, figures, and scanned details difficult to inspect. A focused image viewer lets readers see those details clearly and return to the same place in the document.

## What Changes

- Make embedded images in Markdown, imported HTML/article documents, EPUBs, and PDF reflow content open in an enlarged viewer, with a visible activation affordance and keyboard access.
- Provide a responsive image viewer with fit-to-screen display, zoom and pan controls, descriptive alt text or captions, and clear dismissal behavior.
- Preserve the reader's position and interaction state when the image viewer closes, and align the existing PDF reflow image zoom with the shared behavior.

## Capabilities

### New Capabilities
- `document-image-viewer`: Open and inspect embedded document images in an accessible, responsive viewer.

### Modified Capabilities
- None.

## Impact

- Affected readers: `MarkdownViewer`, HTML/article iframe content in `DocumentViewer`, EPUB content hooks in `EPUBViewer`, and PDF reflow image assets.
- Affected UI: a shared image-viewing overlay and the image activation affordance in supported reader surfaces.
- Affected coverage: reader interaction, accessibility, mobile gesture, and localization tests and strings.
- Existing whole-page PDF zoom and image-only document viewing remain supported.
