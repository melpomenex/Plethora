## MODIFIED Requirements

### Requirement: Legible data-grid presentation
On supported pane widths, Data grid mode SHALL provide sticky column headers and aligned tabular values for title, type, priority, due state, interval, repetitions, lapses, difficulty, stability, retrievability, progress, and estimated time. Header cells, collapsed row cells, and data-grid expanded metrics SHALL use one shared column definition and equivalent scroll-container geometry so corresponding labels and values remain aligned when vertical or horizontal overflow is present. The grid SHALL preserve date grouping, virtualization, item expansion, and row actions, and SHALL use readable labels or accessible descriptions rather than unexplained abbreviations.

#### Scenario: User compares scheduling metrics
- **WHEN** the user selects Data grid mode
- **THEN** the metric columns align across rows and remain associated with sticky headers while scrolling
- **AND** opening item detail does not remove the row's date context or other visible columns
- **AND** each expanded metric that duplicates a data-grid column aligns with that column rather than an unrelated detail-grid track

#### Scenario: Grid has a vertical scrollbar
- **WHEN** enough scheduled rows are loaded for the body to overflow vertically
- **THEN** the sticky header and virtualized body calculate column positions from the same available inline width or reserved scrollbar gutter
- **AND** the rightmost and intermediate labels remain aligned with their row values

#### Scenario: Grid is wider than its pane
- **WHEN** the available pane cannot display all data-grid columns at a readable width
- **THEN** the grid preserves readable column widths and provides contained horizontal scrolling shared by the header and rows
- **AND** it does not compress labels and values into illegible text

#### Scenario: Schedule pane is resized within grid-supported widths
- **WHEN** the pane width changes while Data grid mode remains supported
- **THEN** header, row, and expanded-detail column boundaries recompute together without progressive offset or stale measurements

