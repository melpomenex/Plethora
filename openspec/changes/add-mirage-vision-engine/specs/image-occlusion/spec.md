## ADDED Requirements

### Requirement: Automated Image Occlusion Generation
The system SHALL run Mirage on imported diagrams, charts, maps, or schematics to detect text labels and distinct object segmentation polygons, and auto-generate `image-occlusion` flashcards with toggleable occlusion layers.

#### Scenario: Diagram auto-occlusion creates cards per detected label/object
- **WHEN** the user triggers automated occlusion generation on an image asset
- **THEN** Mirage detections are converted from `0–1000` coordinates to `0–100` `ImageOcclusionRegion` entries (including polygon `points`) and saved as `image-occlusion` learning items

### Requirement: Interactive Tap-to-Mask Reader Overlay
Plethora's React reader SHALL render Mirage's returned polygon masks (`mask_format="polygons"`) and text regions as interactive, hoverable SVG overlays over images, creating a masked flashcard in the user's review queue when clicked.

#### Scenario: Clicking a polygon mask creates a masked flashcard
- **WHEN** a user hovers and clicks a detected polygon or text region in the reader overlay
- **THEN** a new `image-occlusion` flashcard targeting that region is created immediately in the review queue
