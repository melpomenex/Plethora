## Purpose

Route embedded internal destinations through existing navigation. Improve page labels, reader layouts and on-demand navigation tools without a second renderer.

## ADDED Requirements

### Requirement: Safe document links

The reader SHALL open internal destinations in the active PDF and accept only approved external URL schemes through explicit activation.

#### Scenario: Safe document links acceptance

- **WHEN** a reader activates an internal destination or an unsupported external scheme
- **THEN** internal navigation uses the existing page jump path and unsupported URLs do not open

### Requirement: Printed versus physical pages

The reader SHALL keep printed labels distinct from the physical locator.

#### Scenario: Printed versus physical pages acceptance

- **WHEN** a roman-numeral cover precedes the numbered body
- **THEN** the toolbar can identify both label and physical position and internal jumps use physical pages

### Requirement: Responsive reader tools

The reader SHALL keep reading and selection usable with fit controls, history, thumbnails, spreads and immersive layout across supported screen sizes.

#### Scenario: Responsive reader tools acceptance

- **WHEN** a user changes layout or zoom after visiting a bookmarked page
- **THEN** they can return to the original physical page and preserve its underlying source location

### Requirement: Reader navigation surfaces

The reader SHALL provide hierarchical outline, thumbnails, search results, bookmarks and back and forward locations using physical page numbers.

#### Scenario: Reader navigation surfaces acceptance

- **WHEN** a landmark has multiple outline destinations on one physical page
- **THEN** each destination preserves its target position and leaving and returning restores the prior visible location

### Requirement: Reading layouts and preferences

The reader SHALL preserve position and zoom across single-page, continuous and spread layouts, including an optional cover and applicable RTL ordering.

#### Scenario: Reading layouts and preferences acceptance

- **WHEN** a user resumes a right-to-left document with a cover in two-page view
- **THEN** the cover and spread align to reading order while the stored page locator still opens the same source page

### Requirement: Accessible reader interactions

Navigation SHALL be available through labelled keyboard controls and through touch on narrow screen layouts. Presentation SHALL return focus to the reader on exit.

#### Scenario: Accessible reader interactions acceptance

- **WHEN** a keyboard user opens a navigation panel and activates a destination
- **THEN** focus follows the destination or remains in a logical reader control and the user can resume reading without a pointer

### Requirement: Reversible view transforms

Reader zoom, rotation and whitespace crop SHALL be reversible view transforms linked to original-region selection coordinates.

#### Scenario: Reversible view transforms acceptance

- **WHEN** a reader rotates and crops a page before opening a saved highlight
- **THEN** the highlight marks the same source passage at the new viewport transform
