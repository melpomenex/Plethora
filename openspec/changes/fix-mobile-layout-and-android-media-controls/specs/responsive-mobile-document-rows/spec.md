# Responsive Mobile Document Rows

## ADDED Requirements

### Requirement: Primary row actions SHALL remain visible regardless of metadata width

In document and list rows on phone-sized layouts, a primary row action (such as **Open / Read**) SHALL remain fully visible inside the viewport. Optional metadata regions (tags, categories, authors, source labels, timestamps) SHALL occupy only the remaining available width and SHALL NOT enlarge a row beyond its container.

#### Scenario: A document has one extremely long tag

- **WHEN** the mobile Documents view renders a row whose tag text is wider than the remaining space next to the action button
- **THEN** the tag region shrinks and truncates within its allotted width and the Open / Read button remains fully visible at the right edge of the row

#### Scenario: A document has many tags

- **WHEN** a mobile document row contains more tags than fit in the available width
- **THEN** the collapsed preview shows approximately one useful visible tag followed by a `+N` indicator, without horizontal overflow of the row or page

### Requirement: Flexible content SHALL have explicit shrink ownership

Row layouts that combine flexible metadata with fixed-width actions SHALL give the flexible side `min-width: 0` (or equivalent) shrink semantics so truncation can engage, and SHALL mark actions as non-shrinking. Shared components used for inline metadata editing (including `CompactTagEditor`) SHALL be safe to place in constrained flex containers: their trigger SHALL be able to shrink below its intrinsic content width, truncate chip contents, and never force ancestor overflow.

#### Scenario: CompactTagEditor is placed in a constrained flex container

- **WHEN** `CompactTagEditor` is rendered as a flex child with constrained width
- **THEN** its trigger and chips truncate gracefully instead of retaining intrinsic width, and it does not push sibling elements out of the container

#### Scenario: The tag editor is opened from a truncated preview

- **WHEN** the user activates the collapsed tag editor on a phone
- **THEN** the full tag list remains accessible through the editor popover, including tags hidden behind the `+N` indicator

### Requirement: Intentional horizontal-scroll regions SHALL be preserved

Filter/chip bars and card rails that intentionally scroll horizontally (`overflow-x-auto`) SHALL remain horizontally scrolling. Overflow fixes for rows MUST NOT remove or alter intentional scrolling behavior of unrelated regions.

#### Scenario: The compact filter chip bar is scrolled

- **WHEN** the user swipes the Documents filter chip bar horizontally on a phone
- **THEN** the bar scrolls horizontally as before and is not converted to wrapping or clipping

### Requirement: Desktop and tablet tag previews SHALL retain richer presentation

Desktop and tablet layouts that have sufficient space SHALL continue to show richer tag previews (existing preview limits and chip widths). Mobile-specific constraints SHALL be applied responsively rather than degrading desktop presentation.

#### Scenario: A wide viewport renders the documents grid

- **WHEN** the Documents view is viewed at desktop/tablet widths
- **THEN** tag previews render as they do today (unchanged richer preview) and no mobile-only truncation styles affect them
