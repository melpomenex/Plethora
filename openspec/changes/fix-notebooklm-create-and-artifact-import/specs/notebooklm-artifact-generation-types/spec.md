## ADDED Requirements

### Requirement: User can generate a slide deck
The system SHALL offer slide deck generation from the Studio panel and SHALL support the format and length options exposed by the underlying CLI.

#### Scenario: Generate a slide deck with defaults
- **WHEN** the user requests a slide deck without specifying options
- **THEN** the system generates a detailed deck of default length and tracks it as a job

#### Scenario: Generate a slide deck with options
- **WHEN** the user selects a presenter-slides format and/or a short length before generating
- **THEN** the request carries those options through to generation

#### Scenario: Optional description
- **WHEN** the user supplies a description of what the deck should cover
- **THEN** the description is passed to generation; when omitted, generation proceeds without one

### Requirement: User can generate an infographic
The system SHALL offer infographic generation from the Studio panel and SHALL support the orientation, detail, and style options exposed by the underlying CLI.

#### Scenario: Generate an infographic with defaults
- **WHEN** the user requests an infographic without specifying options
- **THEN** the system generates a landscape, standard-detail, auto-style infographic and tracks it as a job

#### Scenario: Generate an infographic with options
- **WHEN** the user selects an orientation, detail level, and/or visual style before generating
- **THEN** the request carries those options through to generation

### Requirement: Study Guide requests the study-guide report format
The system SHALL request the study-guide report format when the user generates a Study Guide, rather than the default briefing-doc format.

#### Scenario: Study Guide produces a study guide
- **WHEN** the user generates a Study Guide from the Studio panel
- **THEN** the generation request specifies the study-guide report format

### Requirement: User can generate a briefing-doc report
The system SHALL offer report generation as a separate option from Study Guide, producing the briefing-doc report format.

#### Scenario: Report produces a briefing doc
- **WHEN** the user generates a Report from the Studio panel
- **THEN** the generation request produces a briefing-doc report and is tracked as its own job

#### Scenario: Report and Study Guide are distinguishable
- **WHEN** the user has generated both a Report and a Study Guide
- **THEN** the job list distinguishes them so the user can tell which artifact is which

### Requirement: Unsupported artifact types fail with an actionable message
The system SHALL reject generation requests for artifact types it cannot dispatch, with an error naming the type, and SHALL NOT offer generation controls for such types.

#### Scenario: Unsupported type is not offered
- **WHEN** the Studio panel renders its generation options
- **THEN** it offers only artifact types the backend can dispatch

#### Scenario: Unsupported type reaches the backend
- **WHEN** a generation request specifies a type the backend cannot dispatch
- **THEN** the job fails with an error naming the unsupported type rather than failing silently

### Requirement: Generation options are only offered where they apply
The system SHALL present per-type generation options only for the artifact types that accept them.

#### Scenario: Options match the selected type
- **WHEN** the user opens the generation controls for a given artifact type
- **THEN** only the options that type accepts are shown, and options belonging to other types are absent
