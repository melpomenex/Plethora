## MODIFIED Requirements

### Requirement: Sections context mode
Flashcard Studio SHALL support sections mode alongside its existing context modes. Explicit sections mode SHALL resolve all selected sections against current canonical source text using the same scope and budget contract as Chat, Learning Agent, and Document Q&A. Only selected bodies SHALL be included; outside-section neighbor context SHALL NOT broaden explicit scope. Failures SHALL stop generation instead of sending a full-document fallback.

#### Scenario: Generation uses only the focused section
- **WHEN** the user generates with focused sections
- **THEN** only their resolved bodies within the configured budget reach the provider, without unrelated neighbor text

#### Scenario: Section range resolved against current document text
- **WHEN** a stored range is stale
- **THEN** current structural matching and outline recovery resolve it or generation stops with a clear error

#### Scenario: Token budget enforced
- **WHEN** selected bodies exceed the provider budget
- **THEN** the shared scoped-budget policy preserves section starts and explicitly reports truncation
