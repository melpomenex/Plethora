## ADDED Requirements

### Requirement: Text-layer geometry matches rendered glyphs

The PDF text layer SHALL use PDF.js's own text-layer stylesheet for layout. App CSS MUST NOT override the layout-affecting properties of `.textLayer`, `.textLayer :is(span,br)`, `.textLayer .markedContent`, or `.textLayer .endOfContent`. App CSS MAY set selection tint, cursor, and stacking context.

#### Scenario: Marked-content pages select accurately

- **WHEN** a user drags across a line on a PDF page whose text layer contains `.markedContent` wrappers
- **THEN** the selected range covers exactly the glyphs the pointer passed over, with no offset to a different line or column

#### Scenario: Selection accuracy holds at non-default zoom

- **WHEN** the user zooms to any supported zoom level and drags across a line
- **THEN** the painted selection aligns with the rendered glyphs to within one character on each end

#### Scenario: App CSS does not re-declare upstream layout rules

- **WHEN** the project's stylesheets are checked for text-layer rules
- **THEN** no app rule sets `display`, `height`, `top`, `line-height`, `box-sizing`, `margin`, `padding`, `border`, `overflow`, `position`, or `transform` on `.textLayer` or its span/marked-content/endOfContent descendants

### Requirement: Drags starting in whitespace begin a selection

A pointer-down on the text-layer root (the gaps between text spans) SHALL be delegated to PDF.js's `endOfContent` / `selecting` handling. The viewer MUST NOT call `preventDefault()` or clear the document selection on that event.

#### Scenario: Drag starting between lines

- **WHEN** the user presses the pointer in the whitespace between two lines and drags across following text
- **THEN** a selection is created starting at the nearest text position, and the drag extends it normally

#### Scenario: Whitespace drag does not destroy an existing selection prematurely

- **WHEN** the user has a committed selection and begins a new drag from whitespace
- **THEN** the previous selection is replaced by the new one when the drag completes, and is not cleared before the new drag produces text

### Requirement: Committed selection stays visible

On pointer-up over a valid PDF text selection, the viewer SHALL commit the selection and paint a persistent per-page overlay derived from the range's client rectangles. The overlay SHALL remain visible even when the native document selection is dropped by the webview (for example when focus moves to the selection popup, the assistant panel, or another control).

#### Scenario: Focus moves to the selection popup

- **WHEN** the user finishes a selection and then clicks a button in the selection popup
- **THEN** the selected passage remains visibly highlighted while the action runs

#### Scenario: Focus moves to another panel

- **WHEN** the user finishes a selection and then clicks into the assistant input or another panel control
- **THEN** the selected passage remains visibly highlighted and the committed selection text and context remain available to actions

#### Scenario: Selection survives an unrelated viewer re-render

- **WHEN** viewer state unrelated to selection changes (for example a toast appears or the page indicator updates)
- **THEN** the persisted highlight remains visible and unchanged

### Requirement: Explicit clear semantics

The persisted selection overlay and its committed state SHALL be cleared only by an explicit user or system event: a new pointer-down that starts a selection inside a page, a click outside any PDF page, the `Escape` key, navigation to a different document, or completion of an action that consumes the selection.

#### Scenario: Escape clears the selection

- **WHEN** a selection is persisted and the user presses `Escape`
- **THEN** the overlay is removed, the selection popup closes, and downstream selection state is cleared

#### Scenario: Clicking outside a page clears the selection

- **WHEN** a selection is persisted and the user clicks outside any PDF page area
- **THEN** the overlay is removed and downstream selection state is cleared

#### Scenario: Idle time does not clear the selection

- **WHEN** a selection is persisted and the user takes no action for an extended period
- **THEN** the overlay remains visible

### Requirement: Overlay tracks page geometry

While a selection is persisted, the overlay SHALL be recomputed from the page viewport whenever page geometry changes, so it continues to cover the same passage.

#### Scenario: Zoom while a selection is persisted

- **WHEN** the user changes zoom while a selection is persisted
- **THEN** the overlay is repositioned to cover the same passage at the new scale, or is cleared if the passage's page is no longer rendered

#### Scenario: Scrolling a persisted selection out of view and back

- **WHEN** the user scrolls the selected passage out of view and back
- **THEN** the overlay is still covering the same passage

### Requirement: Only valid PDF text selections are committed

A selection SHALL be committed only when it is non-collapsed, anchored inside a rendered PDF text layer, and yields non-empty trimmed text with resolvable page context. Selections in other UI, or in image-only pages with no text layer, MUST NOT produce an overlay or enable selection actions.

#### Scenario: Selection in the assistant panel

- **WHEN** the user selects text in the assistant panel rather than a PDF page
- **THEN** no PDF selection overlay is painted and the PDF selection popup does not appear

#### Scenario: Drag on an image-only page

- **WHEN** the user drags across a page that has no selectable text layer
- **THEN** no overlay is painted and the existing no-text-layer messaging path is used
