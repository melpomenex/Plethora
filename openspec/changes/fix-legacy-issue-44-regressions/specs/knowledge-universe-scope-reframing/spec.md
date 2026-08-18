## ADDED Requirements

### Requirement: Universe re-frames when the displayed dataset is replaced

When the Knowledge Universe receives a dataset whose scope differs from the currently displayed one (collection/scope switch such as Main → Favorites → All, or a filter/search change that replaces the node set on a live engine), the camera SHALL re-frame to the new dataset's home view regardless of the camera's current pan, zoom, or prior state. Incremental data updates that do not replace the dataset's scope SHALL preserve a deliberately panned or focused camera.

#### Scenario: Switching scope re-centers from any camera state

- **WHEN** the Universe is displaying one collection scope with a camera the user has panned or zoomed away from home
- **AND** the user switches to a different scope (e.g. Favorites to All)
- **THEN** the engine receives the new dataset and re-frames the camera onto the new dataset's home target and fit distance
- **AND** the newly displayed content is centered without requiring a resize, reload, or second navigation

#### Scenario: Same-data edits preserve the user's camera

- **WHEN** the displayed dataset is updated without a scope change (e.g. an incremental content update) while the camera was deliberately panned
- **THEN** the camera target is preserved

#### Scenario: Focus on a surviving node is preserved across scope change

- **WHEN** the scope changes while the camera is focused on a system or node that still exists in the new dataset
- **THEN** the focus is reconciled to that entity's new position rather than dropped

### Requirement: Home target reflects the visible core

The Universe's home camera target SHALL be computed from the core content (clusters and visible system nodes). Rim content (tag halo, orphan belt) SHALL contribute to the fit bounds so it remains visible, but SHALL NOT displace the home target away from the core's center.

#### Scenario: One-sided rim content does not skew centering

- **WHEN** the dataset's rim content (tags or orphaned items) lies predominantly on one side of the core
- **THEN** the home target equals the core envelope's center, so the dense core renders centered on screen
- **AND** the fit distance still includes the rim content so it is not cut off
