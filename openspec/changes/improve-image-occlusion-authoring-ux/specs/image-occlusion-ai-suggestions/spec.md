## ADDED Requirements

### Requirement: AI region suggestion is available inside the composer

The composer SHALL provide a "Suggest regions" action that asks the configured vision-capable model to propose occlusion regions for the image currently open. The action SHALL NOT require the user to first select images in another surface. When no vision-capable model is configured, the action SHALL be disabled with an explanation of what is missing.

#### Scenario: Suggesting regions for the open image

- **WHEN** the user activates "Suggest regions" in the composer with a vision-capable model configured
- **THEN** the currently open image is sent to the model
- **AND** the returned regions appear on the canvas as pending suggestions

#### Scenario: No vision model configured

- **WHEN** no vision-capable model is configured
- **THEN** the "Suggest regions" action is disabled
- **AND** the composer states that a vision-capable model must be configured

#### Scenario: Suggestion is in progress

- **WHEN** a suggestion request is in flight
- **THEN** the composer shows a busy state and prevents a second concurrent request
- **AND** the user can still pan, zoom, and inspect existing regions

### Requirement: Suggested regions are reviewed individually before they become real

Suggested regions SHALL be rendered visually distinct from accepted regions and SHALL each offer accept and reject controls, plus bulk "accept all" and "reject all". A suggestion SHALL NOT enter the region list, the card preview, or the saved output until it is accepted. Accepting a suggestion SHALL make it an ordinary editable region and SHALL be undoable.

#### Scenario: Accepting one suggestion

- **WHEN** the user accepts a single suggested region
- **THEN** that region joins the region list as an ordinary region
- **AND** the remaining suggestions stay pending

#### Scenario: Rejecting a suggestion

- **WHEN** the user rejects a suggested region
- **THEN** it is removed from the canvas and does not appear in the region list

#### Scenario: Pending suggestions do not affect the preview

- **WHEN** suggestions are pending and none have been accepted
- **THEN** the card preview reports the same card count as before the suggestion request

#### Scenario: Editing a suggestion accepts it

- **WHEN** the user moves or resizes a pending suggestion
- **THEN** the suggestion is accepted and becomes an ordinary region carrying the edit

#### Scenario: Accepting is undoable

- **WHEN** the user accepts a suggestion and then undoes
- **THEN** the region returns to the pending suggestion state

### Requirement: Suggestions can be refined without losing accepted work

The composer SHALL allow re-running suggestion with an optional free-text hint. A re-run SHALL replace the pending suggestions only; regions the user has drawn or already accepted SHALL be preserved. The re-run request SHALL tell the model which areas are already covered so it can propose different ones.

#### Scenario: Re-running with a hint

- **WHEN** the user has accepted two suggestions and re-runs with the hint "hide the axis labels"
- **THEN** the two accepted regions remain
- **AND** the previously pending suggestions are replaced by the new proposals

#### Scenario: Manual regions survive a re-run

- **WHEN** the user has drawn a region by hand and then re-runs suggestion
- **THEN** the hand-drawn region is unchanged

### Requirement: Unusable AI output is reported, never silently swallowed

Proposed regions SHALL be clamped to the image bounds; a proposal that clamps to zero area, or that duplicates an existing region beyond a similarity threshold, SHALL be dropped. When any proposal is dropped, or when the model returns no usable proposal at all, the composer SHALL state how many proposals were dropped and why, and SHALL leave the user in the composer with manual authoring fully available.

#### Scenario: Some proposals are dropped

- **WHEN** the model returns four proposals of which one clamps to zero area
- **THEN** three suggestions are shown
- **AND** the composer reports that one proposal was discarded as out of bounds

#### Scenario: No usable proposals

- **WHEN** every returned proposal is unusable
- **THEN** the composer reports that the model produced no usable regions
- **AND** the image and manual drawing tools remain available

#### Scenario: Duplicate proposals are collapsed

- **WHEN** the model returns a proposal that substantially overlaps an already-accepted region
- **THEN** that proposal is not shown as a new suggestion

#### Scenario: Request failure keeps the session intact

- **WHEN** the suggestion request fails or the response cannot be parsed
- **THEN** an error is reported in the composer
- **AND** all existing regions and undo history are preserved
