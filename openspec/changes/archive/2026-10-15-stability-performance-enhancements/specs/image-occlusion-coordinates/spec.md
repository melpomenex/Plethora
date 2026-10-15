## ADDED Requirements

### Requirement: Manual occlusion canvas coordinate mapping
Manual occlusion mask drawing in FlashcardStudio SHALL account for CSS scaling, device pixel ratio (DPR), and scroll offsets when mapping mouse/touch coordinates to canvas coordinates.

#### Scenario: Drawing on scaled canvas
- **WHEN** the user draws an occlusion rectangle on a canvas that is CSS-scaled (e.g., displayed at 50% of natural size)
- **THEN** the captured coordinates SHALL map to the correct position on the underlying image regardless of CSS transform or DPR

#### Scenario: Drawing on scrolled canvas
- **WHEN** the user draws an occlusion rectangle on a scrolled canvas
- **THEN** the scroll offset SHALL be factored into coordinate calculations so the mask aligns with the visible content

### Requirement: AI occlusion bounding box normalization
AI-generated occlusion bounding boxes SHALL use normalized relative coordinates in `[ymin, xmin, ymax, xmax]` format with values in the `0–1000` range. The vision model prompt SHALL enforce this schema.

#### Scenario: AI returns valid bounding boxes
- **WHEN** the AI vision model generates occlusion regions for an image
- **THEN** all bounding boxes SHALL be in `[ymin, xmin, ymax, xmax]` format with integer values between 0 and 1000

#### Scenario: AI bounding boxes render correctly on image
- **WHEN** AI-generated bounding boxes are rendered over the source image
- **THEN** each box SHALL visually cover the intended region within ±2% positional tolerance
