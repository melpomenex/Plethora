## Purpose

Extend existing sidecar annotations and render supported native markup and comments. Add selection actions and verified embedded interoperability.

## ADDED Requirements

### Requirement: Persistent PDF annotation editing

The reader SHALL persist supported text markup, notes, region and drawing annotations with physical geometry and provide keyboard-accessible editing, filtering and review.

#### Scenario: Persistent PDF annotation editing acceptance

- **WHEN** a user saves markup and reopens in either view
- **THEN** the annotation retains its color or content and can navigate to the original region

### Requirement: Embedded annotation interchange

The reader SHALL display supported native annotations and export supported sidecar edits as standard PDF objects in a separate copy.

#### Scenario: Embedded annotation interchange acceptance

- **WHEN** an exported highlight and note are opened in an independent reader
- **THEN** the annotation types, positions and contents remain readable and reimport does not create duplicates

### Requirement: Annotation learning actions

The reader SHALL expose eligible annotation actions through existing learning and Assistant workflows.

#### Scenario: Annotation learning actions acceptance

- **WHEN** a user creates an extract or cloze from a supported markup annotation
- **THEN** its source remains navigable through the same stored page and quote

### Requirement: Annotation geometry and provenance

Sidecar annotations SHALL retain physical page coordinates independently of zoom with anchored quotes or region geometry and a stable document identifier.

#### Scenario: Annotation geometry and provenance acceptance

- **WHEN** a cross-page highlight is viewed after rotation and reflow
- **THEN** its per-page geometry and quote remain resolvable and source navigation can return to Original

### Requirement: Supported markup controls

The reader SHALL provide source-linked editing for highlights, underline, strikethrough, notes and comments, with color selection and consistent Delete and Undo behaviors.

#### Scenario: Supported markup controls acceptance

- **WHEN** a user deletes existing markup and uses Undo
- **THEN** the same annotation ID, geometry, selected text and color return to the active list and overlay

### Requirement: Annotation collection and discovery

The reader SHALL provide count, sorting, filtering, search and navigation for saved annotations without requiring all pages to render.

#### Scenario: Annotation collection and discovery acceptance

- **WHEN** a reader filters annotations to one color and a matching note on an unrendered page
- **THEN** the list updates and jump mounts only the required page window

### Requirement: Editable region tools

Ink, shape, free-text and stamp annotations SHALL persist their edit data against source geometry using existing annotation storage.

#### Scenario: Editable region tools acceptance

- **WHEN** a user commits a stylus annotation then zooms in after reopening
- **THEN** the stroke is rendered from its stored shape and remains editable through the annotation inspector
