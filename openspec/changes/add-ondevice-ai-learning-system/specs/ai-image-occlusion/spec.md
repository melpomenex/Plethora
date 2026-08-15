## ADDED Requirements

### Requirement: OCR-backed label detection with deterministic geometry

For labeled diagram images, the system SHALL obtain text labels with bounding boxes from a
deterministic OCR source (ML Kit Text Recognition on Android; configured OCR providers on
desktop) and SHALL use those boxes as the occlusion geometry. The generative model SHALL NOT
be asked to produce pixel coordinates when OCR boxes exist.

#### Scenario: Labeled PDF figure produces occlusion candidates
- **WHEN** a user invokes occlusion assistance on a rendered PDF figure containing text labels
- **THEN** labels with normalized bounding boxes are detected via OCR and each candidate
  occlusion region maps to a detected OCR box

#### Scenario: OCR unavailable degrades to manual authoring
- **WHEN** OCR fails or is unavailable for an image
- **THEN** the existing manual occlusion composer remains fully usable and the AI flow reports
  an OCRFailed/error-category state instead of inventing regions

### Requirement: AI educational-label selection by reference

The model SHALL receive OCR label texts with their normalized boxes plus document context and
SHALL return, by label reference: which labels are educationally worth testing, grouping of
labels that belong on the same card, question wording, answer wording, and whether the image
is appropriate for occlusion at all. The model SHALL NOT return new geometry.

#### Scenario: Non-educational labels are excluded
- **WHEN** a diagram contains decorative or non-educational text (e.g. figure caption,
  watermark)
- **THEN** those labels are not selected for occlusion cards

#### Scenario: Related labels share one card
- **WHEN** several labels belong to one structure or concept
- **THEN** the model groups them into a single card with multiple occlusion regions

#### Scenario: Image deemed inappropriate
- **WHEN** the model judges the image unsuitable for occlusion (e.g. a photograph without
  learnable labels)
- **THEN** the user is told why and no candidate cards are produced

### Requirement: Coordinate normalization and stability

All occlusion geometry SHALL be persisted normalized to percent 0–100 of the source image,
compatible with the existing image-occlusion interaction metadata, and SHALL handle image
scaling, device pixel ratio, viewport transforms, and cropped sources. When the source image
changes (different hash), AI-proposed regions SHALL be invalidated.

#### Scenario: OCR pixel boxes convert to normalized regions
- **WHEN** OCR returns pixel-coordinate boxes for an image of known dimensions
- **THEN** stored regions are percent-normalized, clamped to bounds, and render correctly at
  any zoom level in review

#### Scenario: Source image change invalidates proposals
- **WHEN** an image asset is replaced with different content after AI regions were proposed
- **THEN** the proposals are marked stale rather than silently applied to the new image

### Requirement: Multi-source image support

Occlusion generation SHALL support PDF-rendered figures, EPUB images, and imported images in
the image registry, using each source's existing extraction/streaming path.

#### Scenario: EPUB image occlusion
- **WHEN** a user invokes occlusion assistance on an EPUB image
- **THEN** the image is obtained via the EPUB resource path and processed identically to other
  sources

### Requirement: Preview, edit, save with user control

Generated occlusion candidates SHALL pass through preview/edit/save where the user can adjust
regions, wording, grouping, and accept individual cards, saving through the existing batch
learning-item creation path with image-asset linkage and provenance.

#### Scenario: Adjusting a region before save
- **WHEN** a user drags or resizes a proposed region in the preview
- **THEN** the saved card uses the edited geometry

### Requirement: Free-form visual occlusion is explicitly experimental

Vision-proposed regions without OCR backing SHALL be gated behind an experimental flag that is
off by default, SHALL be labeled low-precision in the UI, and SHALL never replace the
OCR-backed path.

#### Scenario: Freeform flag off by default
- **WHEN** a user installs or updates the app
- **THEN** free-form vision occlusion is disabled and only OCR-backed assistance is offered
