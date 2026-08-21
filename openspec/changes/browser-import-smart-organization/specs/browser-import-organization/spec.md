# Browser Import Organization

## ADDED Requirements

### Requirement: Browser captures SHALL use the canonical Smart Tagging pipeline

Every browser-created target SHALL be eligible for the same normalization, candidate retrieval, confidence policy, user exclusions, and local/LLM fallback used by existing Smart Tagging. The target types SHALL include page documents, selected extracts, generated Q&A, generated cloze items, and image-occlusion items.

#### Scenario: A page is saved from the extension

- **WHEN** the native browser endpoint durably creates or updates a page document
- **THEN** it SHALL enqueue or mark the document for the canonical Smart Tagging pipeline without delaying the save response for classification

#### Scenario: A selected extract is saved

- **WHEN** the endpoint durably creates an extract linked to a source document
- **THEN** the extract SHALL be scheduled as a tagging target and SHALL retain its source document identity for context resolution

#### Scenario: A generated card or image-occlusion item is saved

- **WHEN** a browser request creates a Q&A, cloze, or image-occlusion learning item
- **THEN** that learning item SHALL be scheduled as a tagging target and SHALL retain its card/image interaction metadata

### Requirement: Browser organization context SHALL be bounded and structured

The extension and native endpoint SHALL accept a versioned capture-context envelope with optional URL/domain, title, author, heading path, nearby text, caption/alt text, content kind, source identity, and source tags. Each field and the total envelope SHALL have explicit size limits, and malformed or over-budget optional fields SHALL be truncated or omitted without rejecting an otherwise valid save.

#### Scenario: A content script provides rich context

- **WHEN** a capture includes a heading path and surrounding selection text
- **THEN** the organizer SHALL pass those fields to Smart Tagging as bounded evidence associated with the target

#### Scenario: An older extension sends only legacy fields

- **WHEN** a capture omits the new envelope
- **THEN** the save SHALL remain valid and the organizer SHALL use the legacy title, URL, content, and available source lookup fields

#### Scenario: A request exceeds a context budget

- **WHEN** optional context would exceed the configured field or total limit
- **THEN** the transport SHALL trim optional evidence first, preserve the target’s core content, and record that context was reduced

### Requirement: Source context SHALL influence children without blind tag copying

For an extract or learning item with a resolvable source document, Smart Tagging SHALL rank item-local evidence before source evidence. Source tags MAY become inherited semantic tags only after canonicalization, relevance/confidence policy, duplicate checks, and provenance recording.

#### Scenario: A source has a relevant canonical tag

- **WHEN** a card’s question and nearby heading support a source tag
- **THEN** the organizer MAY apply that tag with `source-inherited` provenance and SHALL preserve the source document ID

#### Scenario: A source tag is broad or unsupported by the child

- **WHEN** the source tag is not supported by the child’s evidence
- **THEN** the organizer SHALL leave it off the child rather than copying the source tag unconditionally

### Requirement: Operational capture data SHALL remain separate from semantic taxonomy

New browser saves SHALL store source, item type, source URL, capture time, source document ID, extension/schema version, and organization status in structured provenance metadata. Explicit user-supplied tags SHALL remain manual semantic tags. Generated transport labels SHALL NOT be added to new semantic tag arrays.

#### Scenario: A browser image-occlusion item is created

- **WHEN** the item is persisted
- **THEN** its image asset, regions, prompt, source URL, and capture provenance SHALL remain in interaction metadata while its semantic tags contain only user or Smart Tagging assignments

#### Scenario: A user supplies tags in the extension

- **WHEN** the capture payload includes explicit user tags
- **THEN** those tags SHALL be preserved as manual tags even if automatic organization later fails

### Requirement: Organization SHALL be asynchronous, offline-capable, and user-authoritative

Saving SHALL complete before asynchronous organization. The organizer SHALL use the local deterministic fallback when an LLM is unavailable and SHALL record a reviewable no-result or failure state when neither path can produce a meaningful result. Late automatic output SHALL NOT overwrite a manual tag or a dismissal.

#### Scenario: The application is offline

- **WHEN** a browser save succeeds but the LLM is unavailable
- **THEN** local Smart Tagging SHALL run if possible, otherwise the item SHALL remain saved with an explicit reviewable state

#### Scenario: A user edits before a job finishes

- **WHEN** a user adds, removes, or dismisses a tag while organization is running
- **THEN** the completion handler SHALL preserve the user action and SHALL not reintroduce the affected tag

### Requirement: Organization SHALL be recoverable and idempotent

The organizer SHALL persist enough status and fingerprint information to recover queued or expired work after event loss or WebView suspension. Repeated save/retry events for an unchanged target SHALL coalesce and SHALL NOT create duplicate tags, provenance records, or review entries.

#### Scenario: The browser event is missed during startup

- **WHEN** a browser-created target remains queued or incomplete after the event listener is unavailable
- **THEN** startup or refresh reconciliation SHALL discover and schedule it later

#### Scenario: The extension retries the same request

- **WHEN** the same target and content/source fingerprint are observed more than once
- **THEN** the organizer SHALL reuse the existing organization result or one in-flight job

### Requirement: Browser organization SHALL preserve existing transport security limits

The native endpoint SHALL continue to enforce loopback/origin checks, request-body limits, image limits, URL validation, and untrusted-content handling for the new context fields.

#### Scenario: A capture contains unsafe or oversized optional context

- **WHEN** context violates validation or budget rules
- **THEN** the endpoint SHALL reject or trim only the unsafe optional data and SHALL never execute it as instructions
