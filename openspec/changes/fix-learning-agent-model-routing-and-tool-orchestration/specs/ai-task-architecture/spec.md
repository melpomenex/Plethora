# Task architecture: repair payload, finish-reason fidelity, and pinned selection

## ADDED Requirements

### Requirement: Explicit model selection pins the serving provider

When a caller supplies an explicit, user-authorized provider/model selection to an AI feature
that supports pinning, the task layer SHALL serve every generation request of that logical run
from a provider instance resolved from exactly that frozen configuration. Pinned runs SHALL NOT
resolve providers through the general router, SHALL NOT fall back to another provider or model,
and SHALL record the selected and actually serving provider/model in diagnostics. The shared
provider registry SHALL remain unchanged for callers that do not opt in.

#### Scenario: Pinned run ignores registry drift

- **GIVEN** a pinned Learning Agent run with the user's selected configuration
- **WHEN** an unrelated provider row is enabled, disabled, or reordered during the run
- **THEN** all of the run's requests are served from the frozen configuration

#### Scenario: Failure is typed, not substituted

- **GIVEN** the pinned configuration fails generation
- **WHEN** the run observes the failure
- **THEN** a typed error is surfaced to the caller
- **AND** no other enabled provider serves any request without the user's explicit action

#### Scenario: Non-pinned callers unchanged

- **WHEN** existing features execute through the task layer without an explicit selection
- **THEN** routing, fallback, and consent behavior is identical to the pre-change task layer

## MODIFIED Requirements

### Requirement: Structured output is validated and fail-closed

Structured AI outputs SHALL pass schema validation before any downstream use. When native
schema-enforced structured output is unavailable, the system SHALL use a strict-JSON prompt
mode followed by validation, with at most one repair retry; unresolved failures SHALL surface
`InvalidStructuredOutput` and SHALL NOT produce partially valid objects.

In addition, the single repair retry SHALL include bounded information about the rejected
response (the response text capped at a fixed length with a truncation marker), the exact
parse or validation errors, and the expected output contract, and a provider-reported
output-limit finish reason SHALL feed repair guidance and diagnostics. Provider transports
SHALL surface provider finish reasons to the task layer, and diagnostic outcomes SHALL
distinguish empty, truncated, and contract-invalid responses. Repair payload storage SHALL
obey the existing no-user-content diagnostic constraints.

#### Scenario: Invalid structured output is rejected

- **WHEN** a model returns output that fails validation after the repair retry
- **THEN** the caller receives an `InvalidStructuredOutput` error and no domain object is
  created from the response

#### Scenario: Native structured output round-trips

- **WHEN** the on-device build supports schema-compiled structured output and a task declares
  a schema
- **THEN** the response arrives as a validated structured object and the JSON-fallback path is
  not used

#### Scenario: Repair knows what it is fixing

- **GIVEN** a structured task whose strict-JSON response failed parsing or validation
- **WHEN** the repair request is sent
- **THEN** the request contains the bounded rejected response text, the concrete validation
  errors, and the expected contract
- **AND** the bounded excerpt never exceeds its fixed character cap

#### Scenario: Truncation is diagnosable

- **GIVEN** a provider that reports `finish_reason: "length"`
- **WHEN** the response is truncated JSON
- **THEN** the task layer's validation outcome and diagnostics distinguish the truncation case
- **AND** the repair instruction directs the model to shorten rather than re-emit

#### Scenario: Empty provider body stays fail-closed

- **GIVEN** an OpenAI-compatible transport whose assistant message content is null (reasoning-only or refusal turn)
- **WHEN** the structured task validates
- **THEN** the empty text is classified as an empty response, the repair path proceeds once, and unresolved results surface `InvalidStructuredOutput`
- **AND** no fallback fabricates a valid object from the empty body
