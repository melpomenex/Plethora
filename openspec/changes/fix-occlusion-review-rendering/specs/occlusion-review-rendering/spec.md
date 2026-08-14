## ADDED Requirements

### Requirement: Occlusion image fully visible before reveal
The review card SHALL size the occlusion image so that the entire image, including every occlusion region, is visible within the card area while the answer is hidden, without requiring the user to reveal the answer or scroll.

#### Scenario: Tall image with a region near the bottom
- **WHEN** an image-occlusion card whose source image is taller than the visible card area is displayed with the answer hidden
- **THEN** the image is scaled down to fit the available height and the occlusion region lowest on the image is fully on screen

#### Scenario: Answer-hidden container overflow fallback
- **WHEN** occlusion card content still exceeds the card area after image scaling (for example on a very small viewport)
- **THEN** the answer-hidden card container is scrollable, matching the answer-shown container's behavior

### Requirement: Region overlays align with the rendered image
The review card SHALL render occlusion region overlays in the same coordinate space as the displayed image, so percentage-based region geometry stays aligned with the image content at any aspect ratio and scale.

#### Scenario: Image is capped by height
- **WHEN** a wide image is scaled down to satisfy the height cap
- **THEN** each overlay remains positioned over its authored region of the image content with no drift from letterboxing or container padding

#### Scenario: Image is capped by width
- **WHEN** a tall narrow image is scaled down to satisfy the width constraint
- **THEN** each overlay remains positioned over its authored region of the image content

### Requirement: Occlusion masks are opaque
Occlusion masks SHALL fully cover the masked image content on review and review-accurate surfaces, using an opaque default color, while still applying an explicit region color authored in the composer when one is set.

#### Scenario: Default mask during review
- **WHEN** an image-occlusion card is displayed with the answer hidden and a region has no explicit color
- **THEN** the mask over that region renders fully opaque so the underlying image content is not readable through it

#### Scenario: Authored region color
- **WHEN** a region carries an explicit color chosen in the occlusion composer
- **THEN** the mask renders in that color as authored

### Requirement: Mask opacity consistent across review-accurate surfaces
The composer's card preview and the occlusion lightbox SHALL render masks with the same opacity semantics as the review card, so authors verify cards under review conditions.

#### Scenario: Composer preview matches review
- **WHEN** a card preview is shown in the occlusion composer or studio lightbox with the answer hidden
- **THEN** the masks are fully opaque by default, matching the review card's rendering
