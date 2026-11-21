## Context

The generic SQLite annotations table contains page, type, color and rectangle data. Existing highlight overlays and selection anchors already support reader workflows.

## Goals and scope

Extend existing sidecar annotations and render supported native markup and comments. Add selection actions and verified embedded interoperability. Follow the [program invariants and verification matrix](../../planning/pdf-first-class-document-platform/README.md).

## Decisions

Use the existing annotation repository and additive versioned geometry for quads, paths and compound regions. Keep quotes and source identity alongside geometry and preserve current IDs, colors and authored text. Map native annotation identity from source fingerprint and object ID. Store edits as sidecar state until explicit export.

Use the PDF.js native display layer and independent validation for embedded interchange. Stage text markup and notes before shapes, ink, stamps and region workflows. Reuse learning actions and source navigation.

## Persistence and conflict handling

Store annotation fragments per physical page in the existing sidecar record. Text markup uses ordered quads plus a quote and contextual text. Shape and ink retain original geometry and style. Native annotation identity includes the file revision and native object identifier. Preserve opaque fields for types that are displayable but cannot yet be edited.

Use the existing annotation identity and optimistic update model when storing edits. The versioned payload is additive and older rows continue to render from the legacy rectangle. Treat create, edit, delete and undo as explicit mutations. An undo restores the same annotation identity. Import compares a stable native key before creating a sidecar record. Non-destructive export creates a new PDF with standard annotation objects and appearance data qualified in an independent reader.

## Risks and verification

Appearance streams and QuadPoints have renderer-dependent edge cases. Unsupported or ambiguous imports need a clear read-only state. Embedded export requires exact geometry and independent verification.

The delta scenarios define the functional gates. Use deterministic fixtures for invariants and record device-dependent verification separately in the program ledger.
