## ADDED Requirements

### Requirement: Every extension request is fitted to the transport budget

Every request the browser extension sends to the desktop application SHALL pass through the shared payload-fitting step before transmission. No call site SHALL construct and post a request body directly, bypassing the budget. This applies to page saves, extract saves, AI processing requests, image-occlusion requests, and any future endpoint.

#### Scenario: An AI processing request is fitted before sending

- **WHEN** the extension sends page content for AI processing
- **THEN** the request body has been fitted to the transport budget before transmission

#### Scenario: No call site posts an unfitted body

- **WHEN** the extension's source is inspected for request construction
- **THEN** every request body sent to the desktop application originates from the shared fitting step

### Requirement: Transport size limits derive from one shared definition

The extension's request budget, the desktop server's request-body limit, and any endpoint-specific limits SHALL derive from a single documented set of constants, with the extension's budget strictly below the server's limit. Changing a limit SHALL require editing one definition.

#### Scenario: The extension budget stays below the server limit

- **WHEN** the transport limits are evaluated
- **THEN** the extension's request budget is strictly less than the server's request-body limit

### Requirement: Oversized requests are retried with progressively reduced content

When the desktop application rejects a request because it is too large, the extension SHALL retry with reduced content. The retry SHALL NOT be conditional on any particular field being present in the original payload. Content SHALL be shed in order of decreasing richness — inline styling, then rich markup, then embedded media references, then text truncation — so that a save preserves as much value as the limit allows rather than failing outright. Embedded media references are shed after rich markup rather than before it: they are image URLs, not embedded bytes, small enough that they rarely need to go at all, and they feed a separate feature (images attached to extracts) independent of whether the article's HTML formatting survives — so they are worth preserving longer than the comparatively heavy, cosmetic markup.

#### Scenario: A rejected request is retried without rich content

- **WHEN** a save is rejected for exceeding the size limit
- **THEN** the extension retries with rich content removed
- **AND** the user's save succeeds if the reduced request fits

#### Scenario: A rejected request with no rich content is still retried

- **WHEN** a save carrying neither rich markup nor media references is rejected for exceeding the size limit
- **THEN** the extension still retries with further-reduced content rather than reporting failure immediately

#### Scenario: An unrecoverable oversize is reported clearly

- **WHEN** a request cannot be reduced enough to fit the limit
- **THEN** the user is told the capture was too large to import
- **AND** the message names the page and the limit rather than a bare status code

### Requirement: Size-limit rejections carry diagnostic detail

When the desktop server rejects a request for exceeding its body limit, the response SHALL carry a structured body identifying the received size, the configured limit, and the endpoint. The extension SHALL surface that detail rather than a bare status code.

#### Scenario: A body-limit rejection is diagnosable

- **WHEN** the desktop server rejects a request for exceeding its body limit
- **THEN** the response body identifies the received size, the configured limit, and the endpoint

#### Scenario: The user sees a meaningful message, not a status code

- **WHEN** a save is rejected for exceeding the size limit
- **THEN** the message shown to the user describes the size problem
- **AND** it is not the bare text "Server error: 413"

### Requirement: Degraded saves tell the user what was dropped

When a save succeeds only after content was shed to fit the transport budget, the extension SHALL tell the user what was lost — article styling, images, rich markup, or truncated text. A degraded save SHALL NOT be reported as an unqualified success, and SHALL NOT report the loss only to the developer console.

#### Scenario: Dropping images is disclosed

- **WHEN** a page is saved successfully after its images were dropped to fit the budget
- **THEN** the user is told the page was saved without images

#### Scenario: Truncating text is disclosed

- **WHEN** a page is saved successfully after its text was truncated to fit the budget
- **THEN** the user is told the content was truncated

#### Scenario: An undegraded save is reported as a plain success

- **WHEN** a page is saved with no content shed
- **THEN** the user sees an ordinary success confirmation with no degradation notice
