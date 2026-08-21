## ADDED Requirements

### Requirement: Deterministic local OCR label detection
The Image Occlusion Composer SHALL support automated label detection on open diagrams using local OCR without requiring an active internet connection or paid LLM inference.

#### Scenario: Running automatic label detection on diagram
- **WHEN** the user clicks "Auto-detect labels" in the composer
- **THEN** the system SHALL run local OCR (`ocrImageLabelsForOcclusion`) to detect text bounding boxes
- **AND** render candidate occlusion regions over detected diagram labels

### Requirement: Interactive preview and user control of proposed masks
The system MUST present detected or suggested masks as editable proposals, requiring explicit user review before any cards are saved.

#### Scenario: Reviewing candidate label masks
- **WHEN** automatic detection produces candidate occlusion boxes
- **THEN** the candidate masks SHALL appear in a distinct preview state on the canvas
- **AND** the user SHALL be able to accept all, accept individual boxes, resize boundaries, edit label text, or reject candidates

#### Scenario: Saving accepted candidate masks
- **WHEN** the user confirms accepted candidate masks and clicks Save
- **THEN** the system SHALL generate sibling Image Occlusion cards adhering to the shared `occlusionSetId` and default "Hide All, Guess One" review architecture

### Requirement: Optional Vision LLM semantic enhancement
When the user has configured an enabled vision-capable LLM provider, the system SHALL allow refining OCR labels into structured question-and-answer pairs.

#### Scenario: Refining labels with vision model
- **WHEN** the user selects "Refine with AI" while an eligible vision provider is active
- **THEN** the system SHALL execute `occlusionLabelSelectionTask` to structure the detected labels into semantic cards
- **AND** preserve the deterministic OCR bounding coordinates for visual mask alignment
