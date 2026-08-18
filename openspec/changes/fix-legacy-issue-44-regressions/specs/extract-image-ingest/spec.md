## ADDED Requirements

### Requirement: Image paste reaches the image registry regardless of dialog focus

While the extract editor (or any surface with an embedded Image Registry) is open, pasting an image from the clipboard SHALL ingest it into the registry through the canonical asset pipeline, regardless of which control inside the dialog currently holds focus (textarea, search box, or the registry list). Text pasting into text inputs SHALL be unaffected.

#### Scenario: Paste with focus in the content textarea

- **WHEN** the user's focus is in the extract content textarea and they paste clipboard image bytes (Cmd/Ctrl+V)
- **THEN** the image is ingested into the registry and visible in the library
- **AND** the paste is not silently dropped

#### Scenario: Text paste is unaffected

- **WHEN** the user pastes plain text while focused in the content textarea
- **THEN** the text is inserted into the textarea as normal

### Requirement: Drag-and-drop of images is accepted through the canonical pipeline

Dragging image files onto the extract editor or the Image Registry SHALL ingest them through the canonical asset pipeline (type and size validation, persisted storage, registry update) with a visible drop-target state. Non-image drops SHALL be ignored without producing rendering errors or broken image elements.

#### Scenario: Image drop ingests and renders

- **WHEN** the user drags a supported image file onto the extract editor or registry
- **THEN** the asset is ingested, appears in the registry, and can be attached to the extract
- **AND** reopening the extract renders the image correctly

#### Scenario: Non-image drop is ignored

- **WHEN** the user drags a non-image file or selection onto the editor
- **THEN** nothing is ingested and no rendering error occurs

### Requirement: Attached images use full-resolution assets

Attaching a registry image to an extract SHALL embed the full-resolution asset, not a list-thumbnail rendition, so the rendered extract shows the original quality.

#### Scenario: Registry pick embeds full resolution

- **WHEN** the user attaches an image chosen from the registry list
- **THEN** the embedded asset is the full-resolution rendition
- **AND** the rendered extract does not show upscaled thumbnail artifacts
