## Purpose

Build validated export plans for page operations, text and image export, printing, and supported form fields. Preserve the library source throughout.

## ADDED Requirements

### Requirement: Original-preserving document operations

The app SHALL validate page operations and produce a separate PDF before exposing the output.

#### Scenario: Original-preserving document operations acceptance

- **WHEN** a user reorders pages, rotates a page and exports a range
- **THEN** the output reopens with the requested content and geometry and the source bytes retain their identity

### Requirement: Form and print output

The reader SHALL preserve supported PDF form values when the user explicitly exports a filled copy and shall provide print through the supported platform flow.

#### Scenario: Form and print output acceptance

- **WHEN** a user edits a text field or checkbox and saves a copy
- **THEN** a compatible independent reader can read the saved values

### Requirement: Lossless or explicit failure

The operations service SHALL reject unqualified transforms and clean up temporary output on failure.

#### Scenario: Lossless or explicit failure acceptance

- **WHEN** a requested edit would invalidate supported document-level references
- **THEN** the user receives an actionable error and both the source and any existing destination remain intact

### Requirement: Page plan validation

The editing service SHALL validate source identity, page order, page ranges, transforms and output destination before committing a new file.

#### Scenario: Page plan validation acceptance

- **WHEN** the source changes while an edit plan is open
- **THEN** the commit is refused and the user can reopen the current revision

### Requirement: Structural editing compatibility

Merge, insertion, duplication, deletion, crop and split SHALL preserve applicable resources and remap dependent references or report why the requested edit is unavailable.

#### Scenario: Structural editing compatibility acceptance

- **WHEN** a selected page is referenced by an outline and a form field
- **THEN** the export preserves valid references under its documented operation contract or rejects the plan before finalization

### Requirement: Explicit format and permission boundaries

Text, HTML, image and form exports SHALL be initiated by the user and retain available source mapping. Open and export SHALL handle passwords via supported platform flows.

#### Scenario: Explicit format and permission boundaries acceptance

- **WHEN** a protected document is open for reading and editing is unavailable
- **THEN** the reader stays usable and copy/export reports the restriction

### Requirement: Signature and content removal semantics

A visual signature operation SHALL describe its appearance-only effect. A redaction operation SHALL remove target content from the output objects and extracted text before it can be presented as redaction.

#### Scenario: Signature and content removal semantics acceptance

- **WHEN** a PDF includes content underneath a visible mask
- **THEN** the reader treats the mask as a visual annotation until independent object and text checks prove actual removal
