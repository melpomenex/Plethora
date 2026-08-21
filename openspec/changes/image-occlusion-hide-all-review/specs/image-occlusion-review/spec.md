## ADDED Requirements

### Requirement: Default Hide All Guess One review rendering
The system SHALL mask all sibling occlusion regions on the source image by default during review, while rendering the target occlusion region with distinct active styling so that neighboring labels do not leak contextual answers.

#### Scenario: Displaying front of card in Hide All mode
- **WHEN** a learner reviews an image occlusion card configured with mode "hide-all" having one target region and three sibling regions
- **THEN** the system SHALL render all four regions as opaque occlusion masks over the source image
- **AND** the target region SHALL display distinct active visual styling (accent border and centered question mark) distinguishing it from sibling blocker masks
- **AND** all labels on the image SHALL remain concealed

#### Scenario: Active target styling does not leak answer
- **WHEN** the target mask is rendered on the front face of the card
- **THEN** the mask styling SHALL indicate which region to recall without displaying the label text, hint text, or answer content

### Requirement: Target-only answer reveal
The system MUST reveal only the active target region when the learner requests the answer, keeping all sibling regions concealed.

#### Scenario: User reveals answer in Hide All mode
- **WHEN** the learner clicks "Show Answer" or triggers the answer reveal shortcut
- **THEN** the system SHALL uncover only the target region to expose the underlying diagram detail and display its associated answer text
- **AND** all sibling occlusion regions SHALL remain concealed as opaque masks

### Requirement: On-demand reveal all sibling labels
The system SHALL provide an optional post-reveal affordance allowing the learner to uncover all sibling masks on demand.

#### Scenario: Revealing all labels after answering
- **WHEN** the learner has revealed the target answer and clicks "Reveal all labels"
- **THEN** the system SHALL uncover all sibling masks on the image to show the complete diagram
- **AND** the card rating buttons (Again, Hard, Good, Easy) SHALL remain functional and unobstructed

#### Scenario: Reveal all reset on next card
- **WHEN** the learner rates the card and navigates to the next review item
- **THEN** the reveal-all state SHALL reset so the next card initializes with its standard concealed mask configuration

### Requirement: Support for Hide One Guess One mode
The system SHALL support an optional "hide-one" occlusion mode where only the target region is concealed and sibling labels remain visible.

#### Scenario: Reviewing card in Hide One mode
- **WHEN** a learner reviews an image occlusion card configured with mode "hide-one"
- **THEN** the system SHALL mask only the active target region
- **AND** sibling regions SHALL NOT be masked, remaining visible as intentional context

### Requirement: Responsive and accessible coordinate scaling
The system MUST scale occlusion mask overlays in lockstep with the rendered image dimensions across window resizes, screen densities, touch devices, and theme modes.

#### Scenario: Responsive window resize during review
- **WHEN** the user resizes the window, rotates the mobile display, or toggles zoom
- **THEN** the image container SHALL shrink-wrap the bitmap
- **AND** all percent-based mask overlays SHALL maintain exact alignment with their corresponding source image features

#### Scenario: High contrast and dark/light theme visibility
- **WHEN** viewing cards in high contrast, dark theme, or light theme
- **THEN** active target borders and sibling blocker masks SHALL maintain sufficient luminance contrast (WCAG AA) against both the background image and surrounding card UI
