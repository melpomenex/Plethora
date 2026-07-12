## ADDED Requirements

### Requirement: Extract Header Occupies Its Own Layout Space

The Extract review screen in scroll mode SHALL render the header (card-type badge, review-state label, review count, progressive-disclosure level, document title, page reference, and save status) as an in-flow layout region that occupies dedicated vertical space, separate from the action buttons and content editor regions. The header SHALL NOT be absolutely positioned over other in-flow content.

#### Scenario: Short extract content does not cause header overlap

- **WHEN** an extract with short content is displayed such that the centered content column is positioned near the top of the viewport
- **THEN** the header region renders above the action buttons without painting over or being occluded by the "Create Flashcard", "Create Cloze", or "Create Q&A" buttons

#### Scenario: Long extract content scrolls independently of the header

- **WHEN** an extract with long content is displayed such that the content editor scrolls
- **THEN** the header region remains visually attached to the top of the centered content column and does not overlap the action buttons or the content editor

### Requirement: Header And Action Buttons Never Share Vertical Space

The header region and the action-button row of the Extract review screen SHALL occupy mutually exclusive vertical bands within the centered content column, so that neither region can ever visually overlap the other regardless of viewport height, content length, or the number of badge labels shown.

#### Scenario: Header with all optional badges present

- **WHEN** the extract has a non-zero review count and a progressive-disclosure level (so review-count and disclosure-level badges render alongside the type and state badges)
- **THEN** the full header still renders entirely above the action-button row with no overlap

#### Scenario: Narrow viewport width

- **WHEN** the Extract review screen is displayed on a narrow width that cannot fit the badges group and the document-title group on a single row
- **THEN** the header row wraps gracefully and still does not overlap the action buttons or content editor below it

### Requirement: Long Document Title Is Bounded Within The Header

The document title in the Extract review screen header SHALL be text-bounded (truncated with an overflow affordance) so that a long title cannot push header elements off-row or force the header into the vertical space of the action buttons.

#### Scenario: Very long document title

- **WHEN** the document title is very long (e.g., a full book title)
- **THEN** the title is truncated within the header row and the full title remains accessible via the element's title/tooltip affordance, while the action buttons remain fully visible and unobstructed below the header
