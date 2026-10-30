## MODIFIED Requirements

### Requirement: Occlusion image fully visible before reveal
Review, Scroll Mode, and Optimal Sessions SHALL size the authored occlusion source image so its full extent and every region are visible while hidden without requiring reveal. Where a very small viewport still requires overflow, hidden/revealed containers SHALL both allow scrolling. Interaction metadata SHALL determine occlusion behavior even on an underlying QA card, and no additional unmasked source image SHALL leak the answer.

#### Scenario: Tall image with a region near the bottom
- **WHEN** a tall occlusion source is shown hidden in any review mode
- **THEN** it scales to available height and the lowest authored region remains reachable without revealing

#### Scenario: Answer-hidden container overflow fallback
- **WHEN** content exceeds the smallest supported card viewport after scaling
- **THEN** the hidden container is scrollable like the revealed container

#### Scenario: QA card with occlusion metadata
- **WHEN** a QA learning item carries authored occlusion regions and source identity
- **THEN** every mode presents the masked interaction rather than a plain image gallery

### Requirement: Region overlays align with the rendered image
Every review and review-accurate surface SHALL align masks to the actual displayed image content rather than padding/letterboxing, across aspect ratios, responsive resizing, scrolling, and device pixel ratios. Target-region reveal and reveal-all controls SHALL preserve the same authored-region behavior in every mode.

#### Scenario: Image is capped by height
- **WHEN** a wide image scales to satisfy a height cap
- **THEN** overlays remain over authored content without letterbox drift

#### Scenario: Image is capped by width
- **WHEN** a tall narrow image scales to satisfy width constraints
- **THEN** overlays remain aligned with its content

#### Scenario: Resize and reveal multiple regions
- **WHEN** the viewport changes or the user reveals a targeted region then all regions
- **THEN** masks remain aligned and only the intended regions change state

## ADDED Requirements

### Requirement: Missing or corrupt occlusion data cannot become an unmasked review
Local/imported occlusion assets SHALL have explicit loading, ready, and recoverable missing/corrupt states. Missing assets or invalid region geometry SHALL withhold misleading content and grading, explain recovery, and allow retry/edit/skip. Switching cards during loading SHALL NOT attach another card's image or masks.

#### Scenario: Missing source asset
- **WHEN** an authored source image cannot be loaded
- **THEN** every mode shows a clear missing-image error with retry/edit/skip instead of an unmasked basic card

#### Scenario: Stale image load and corrupt geometry
- **WHEN** a prior card's image resolves after navigation or regions contain invalid numeric bounds
- **THEN** no wrong-source/invalid overlay is shown as a valid review
