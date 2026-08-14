## ADDED Requirements

### Requirement: Image Prompt capability and fallback
The system SHALL expose image Prompt availability independently and SHALL route image-study actions only to providers that accept image input.

#### Scenario: Image Prompt is available
- **WHEN** base Prompt and its image-input feature are available
- **THEN** image-study actions may use Nano without requiring a cloud vision provider

#### Scenario: Text Prompt only is available
- **WHEN** base Prompt is available but image input is not
- **THEN** text-only Nano actions remain available
- **AND** image-study actions use a configured cloud vision provider or report unavailable

#### Scenario: Image action falls back
- **WHEN** an on-device image request fails and a cloud vision provider is configured
- **THEN** the action retries through that provider and reports the fallback

### Requirement: Bounded native image preparation
The system SHALL validate and bound images before inference and SHALL release decoded native image resources after the request terminates.

#### Scenario: Supported image is submitted
- **WHEN** an Image Registry asset has a supported MIME type and bounded encoded size
- **THEN** native code applies orientation and downsizes it to the configured maximum dimension while preserving aspect ratio

#### Scenario: Image exceeds encoded limit
- **WHEN** an image payload exceeds the configured IPC limit
- **THEN** the frontend rejects or preprocesses it before native inference
- **AND** reports a specific image-size error

#### Scenario: Image cannot be decoded
- **WHEN** native decoding fails or yields invalid dimensions
- **THEN** the request terminates with `invalid_image`
- **AND** no Prompt inference begins

#### Scenario: Image run terminates
- **WHEN** image inference completes, errors, or is cancelled
- **THEN** decoded bitmaps and request registry entries are released

### Requirement: On-device image descriptions and metadata
The system SHALL generate reviewable descriptions and searchable metadata for Image Registry assets without silently overwriting user-authored metadata.

#### Scenario: Describe image
- **WHEN** a user requests an on-device description for an image
- **THEN** the system returns concise descriptive text suitable for preview or alt-text review

#### Scenario: Suggest searchable metadata
- **WHEN** a user requests image organization assistance
- **THEN** Nano returns a bounded set of normalized labels or concepts
- **AND** the suggestions remain uncommitted until accepted

#### Scenario: Existing user metadata exists
- **WHEN** an image already has a user-authored title, description, or tags
- **THEN** generated suggestions do not replace those fields without explicit confirmation

### Requirement: Image-derived study cards
The system SHALL generate grounded, reviewable study-card drafts from an image and optional nearby document context.

#### Scenario: Generate cards from diagram
- **WHEN** a user selects an image and requests study cards
- **THEN** image input and the bounded user/context instruction are sent in one on-device Prompt request
- **AND** valid results enter the existing Flashcard Studio draft flow

#### Scenario: Multiple images are selected
- **WHEN** the runtime supports only one image per Prompt request
- **THEN** images are processed as separate reviewable runs rather than silently dropping images

#### Scenario: Multi-image feature is available
- **WHEN** the runtime explicitly advertises multi-image support and the user selects multiple images
- **THEN** the adapter may submit a bounded multi-image request
- **AND** preserves source asset provenance for each generated draft

#### Scenario: Generated card is invalid
- **WHEN** required card fields, grounding evidence, or source provenance are missing
- **THEN** the card is discarded and is not saved

### Requirement: Reviewable image-occlusion suggestions
The system SHALL allow Nano to propose occlusion rectangles while preserving the composer's existing suggestion/accept workflow.

#### Scenario: Occlusion proposals are returned
- **WHEN** a user requests region suggestions for an image
- **THEN** each proposal contains normalized finite coordinates and an optional concise label or rationale

#### Scenario: Proposal is outside bounds or duplicated
- **WHEN** a proposed rectangle is out of bounds, below minimum usable area, or duplicates an existing region/suggestion
- **THEN** it is clamped when safe or discarded by the existing normalization pipeline

#### Scenario: Suggestions land in composer
- **WHEN** valid proposals remain after normalization
- **THEN** they are placed only in the suggestion layer
- **AND** existing committed regions and undo history are unchanged

#### Scenario: User accepts suggestion
- **WHEN** the user explicitly accepts an individual or selected group of proposals
- **THEN** only those proposals become committed occlusion regions through the existing composer action

#### Scenario: Model or parse failure
- **WHEN** image Prompt or output validation fails
- **THEN** existing regions, suggestions, selection, and undo history remain intact

### Requirement: Image-study privacy and diagnostics
The system SHALL keep on-device image inputs local and SHALL exclude image content and model completions from logs and diagnostics.

#### Scenario: On-device image task runs
- **WHEN** Nano handles an image-study action successfully
- **THEN** image bytes and related text remain on the device
- **AND** no network request is made by the action

#### Scenario: Image diagnostics are recorded
- **WHEN** an image task records diagnostics
- **THEN** diagnostics may include dimensions, bounded byte counts, timing, model name, finish reason, and error code
- **AND** MUST NOT include raw image bytes, data URLs, source text, prompts, or completion content

#### Scenario: Cloud fallback is offered
- **WHEN** on-device image input is unavailable and a cloud vision provider exists
- **THEN** the UI identifies that continuing will use the cloud provider before sending the image when the action was explicitly selected as private/on-device only

