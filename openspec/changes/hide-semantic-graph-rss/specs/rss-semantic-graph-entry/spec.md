## ADDED Requirements

### Requirement: Semantic Graph entry point shall not consume persistent sidebar space

The RSS reader sidebar SHALL NOT render the Semantic Graph as a persistent always-visible card. The Semantic Graph visualization SHALL be launchable from within the RSS reader via an on-demand control (the sidebar options menu), so that the feed list receives the maximum available vertical space by default.

#### Scenario: Sidebar shows no graph card by default
- **WHEN** the RSS reader tab is open with no articles batched
- **THEN** the sidebar renders no "Semantic Graph Analysis" card and the feed list occupies the space the card previously used

#### Scenario: Graph is reachable from the options menu
- **WHEN** the user opens the sidebar options menu (gear dropdown)
- **THEN** a "Semantic Graph" menu item is present
- **AND WHEN** the user selects that item
- **THEN** the options menu closes and the Semantic Graph overlay opens

#### Scenario: Dashboard entry point still works
- **WHEN** the user activates the Semantic Graph stat tile on the RSS dashboard
- **THEN** the same Semantic Graph overlay opens, unchanged from before this change

### Requirement: Article batch state remains visible without the graph card

When one or more RSS articles are batched for semantic analysis (`selectedRssItems.length > 0`), the system SHALL surface a compact, always-visible indicator of the batch count with a control to clear the batch — without rendering the full graph card. This indicator SHALL NOT consume the ~110px of space the removed card used; it SHALL be a minimal inline element in the sidebar header area.

#### Scenario: Batch badge appears when articles are batched
- **WHEN** the user batches one or more articles for semantic analysis
- **THEN** a compact badge showing the batched article count renders in the sidebar header area
- **AND** the badge includes a control to clear the batch

#### Scenario: Batch badge is hidden when no articles are batched
- **WHEN** no articles are batched (`selectedRssItems.length === 0`)
- **THEN** no batch badge is rendered in the sidebar header

#### Scenario: Clearing the batch from the badge
- **WHEN** the user activates the clear control on the batch badge
- **THEN** the batch is cleared (`selectedRssItems` becomes empty) and the badge disappears

### Requirement: Graph overlay behavior is unchanged

The `SemanticGraphPanel` overlay — its full-screen presentation, the `ObsidianGraph` canvas, the Cluster Inspector drawer, node interactions, and the "start session with filter" flow — SHALL behave identically regardless of which entry point opens it.

#### Scenario: Overlay opens identically from menu and dashboard
- **WHEN** the Semantic Graph overlay is opened from either the sidebar options menu or the dashboard stat tile
- **THEN** the overlay presents the same full-screen visualization with the same capabilities
