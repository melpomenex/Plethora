## ADDED Requirements

### Requirement: One extract editor serves every creation and editing path

All extract creation paths — selection-menu quick extract, lightbulb/dialog extract, paste-extract, and any programmatic creation — SHALL produce extracts that are editable to the same capability set through one shared editor providing annotation formatting, article-image attachment, Image Registry embedding, and metadata (notes, category, tags, color, disclosure). No creation path SHALL produce an extract that can never gain images or formatting.

#### Scenario: Quick-extract gains images later

- **WHEN** the user creates an extract via text selection without a dialog and later opens it for editing
- **THEN** the shared editor offers the image registry and article-image attachment
- **AND** attaching an image persists and renders after reopen

#### Scenario: Both creation funnels converge on the same editor

- **WHEN** an extract is edited that was created by the lightbulb path or by the quick path
- **THEN** the same editor with the same capabilities opens for both

### Requirement: Extract content updates persist rich content

Updating an extract SHALL be able to write rich content (rendered HTML including attached images) in addition to plain text, and SHALL regenerate rich content from the text's formatting when no images are attached, so text-only formatting survives a round trip. An update that does not supply rich content SHALL preserve the stored rich content.

#### Scenario: Formatting round-trips without images

- **WHEN** the user applies bold/italic/list formatting to a text-only extract and saves, then reopens it
- **THEN** the formatting is present in the editor and rendered in the reading surface

### Requirement: Annotation controls are operational

The extract editor's formatting controls (bold, italic, code, bullets) SHALL apply to the current text selection when the control is clicked — including when the click moves focus off the textarea — and keyboard shortcuts (Cmd/Ctrl+B/I/U at minimum bold and italic) SHALL be bound. Every reading surface for extracts (list, reader, scroll item) SHALL render the content's markdown formatting when no rich HTML exists, while the Extract reader SHALL remain a reading presentation without in-document search.

#### Scenario: Toolbar button applies to the selection

- **WHEN** the user selects text in the extract editor and clicks the Bold control
- **THEN** the selection is wrapped/assigned bold formatting without losing the selection or requiring a refocus

#### Scenario: Formatting renders in reading surfaces

- **WHEN** a formatted extract is displayed in the extracts list, the queue reader, or scroll mode
- **THEN** markdown formatting is rendered rather than shown as raw markup

#### Scenario: Extract reader stays search-free

- **WHEN** the extract reading surface is opened
- **THEN** no in-document search affordance is presented, preserving the reading experience
