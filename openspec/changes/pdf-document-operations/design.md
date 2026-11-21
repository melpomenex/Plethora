## Context

PDF.js is the display renderer and lopdf is already shipped. Existing extraction and HTML conversion can be reused where provenance is maintained.

## Goals and scope

Build validated export plans for page operations, text and image export, printing, and supported form fields. Preserve the library source throughout. Follow the [program invariants and verification matrix](../../planning/pdf-first-class-document-platform/README.md).

## Decisions

Represent edits as an ordered sequence of source pages and validated per-page transforms. Make output separate and commit a validated file only after full serialization and reopen. Guard source and output identity, including aliases. Inspect inherited boxes and rotation and reject combinations whose reference graph cannot be preserved safely.

Start with same-document operations and design a dedicated remapping pass for merge, duplication and insertion. Keep form values in PDF.js annotation storage until an authorized Save As. Treat encrypted export, digital signatures, true redaction and arbitrary text edits as independently qualified work.

## Copy transaction

Resolve the input file from the authorized library document. Associate a plan with the original source identity and validate it after the file dialog returns. A page transform is expressed against physical page keys. For structural edits, materialize inherited page resources and boxes before rebuilding the page tree. Check annotation links, outlines, named destinations, form fields and page labels against the output mapping. Reject an edit if the selected operation has no qualified way to repair its references.

Serialize into a temporary file beside the user-selected destination. Reopen the copy and validate page order and transforms before making it visible. Use a no-overwrite finalization so retry or a destination collision preserves both input and existing output. Keep form field export separate from rotation and page-tree edits. Independent verification checks reader-visible values as well as PDF objects.

## Risks and verification

Page tree edits can break named destinations, form field relationships, outlines and page labels. Crop retains source content and provides a viewing/editing operation only.

The delta scenarios define the functional gates. Use deterministic fixtures for invariants and record device-dependent verification separately in the program ledger.
