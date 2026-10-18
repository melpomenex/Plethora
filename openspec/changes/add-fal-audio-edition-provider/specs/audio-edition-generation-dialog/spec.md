## ADDED Requirements

### Requirement: Cross-Platform Provider Selection and Option Layout
The Audio Edition creation dialog SHALL provide responsive provider selection across mobile and desktop viewports, presenting Fal.ai alongside local and other cloud options (OpenAI, ElevenLabs) with non-clipping touch targets, immediate voice roster updates, parameter constraint feedback, and pre-flight billing consent indicators.

#### Scenario: Mobile provider selection
- **WHEN** user views the Audio Edition creation dialog on a mobile device
- **THEN** the dialog displays the quality and provider options in a responsive multi-column grid that does not clip or overflow off-screen, allowing tap selection of Fal.ai, voice preview auditioning, and generation dispatch

#### Scenario: Unsupported parameter feedback on mobile and desktop
- **WHEN** Fal.ai is the selected provider in the Audio Edition creation dialog
- **THEN** the speed slider control SHALL be visibly disabled with explanatory helper text indicating that speed adjustment is not supported by Fal.ai models, while remaining fully interactive when switching back to supported providers
