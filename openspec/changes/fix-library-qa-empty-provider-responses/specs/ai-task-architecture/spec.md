## ADDED Requirements

### Requirement: Completion metadata survives provider transport boundaries

AI task responses SHALL preserve available provider stop reason and token usage consistently across native and browser execution. Equivalent output-limit stop reasons SHALL have a consistent interpretation. Responses that explicitly report refusal, tool-only output, or reasoning without final answer text SHALL remain distinguishable from a final textual answer. Missing metadata SHALL remain unknown, and reasoning or tool payloads SHALL NOT be substituted for answer content.

#### Scenario: Native output exhaustion reaches task recovery
- **WHEN** a native provider response contains empty final text, an output-limit stop reason, and token usage
- **THEN** the task receives the normalized stop reason and token counts
- **AND** the empty response remains distinguishable from a nonempty malformed JSON document

#### Scenario: Browser output exhaustion matches native behavior
- **WHEN** the equivalent response is received through browser execution
- **THEN** the task receives the same interpretation of stop reason and token usage

#### Scenario: Older response lacks optional metadata
- **WHEN** a provider returns final text without stop reason or usage
- **THEN** valid output can still be accepted
- **AND** absent metadata is not interpreted as evidence of output exhaustion, refusal, or an embedding failure

#### Scenario: Reasoning-only output cannot become a library answer
- **WHEN** a provider explicitly returns reasoning content without final answer text
- **THEN** the task treats final answer content as empty
- **AND** neither answer rendering nor diagnostics exposes the reasoning text

## MODIFIED Requirements

### Requirement: Structured output is validated and fail-closed

Structured AI outputs SHALL pass schema validation before any downstream use. When native schema-enforced structured output is unavailable, the system SHALL use a strict-JSON prompt mode followed by validation, with at most one corrective generation per provider execution; unresolved output-contract failures SHALL surface `InvalidStructuredOutput` and SHALL NOT produce partially valid objects. Empty-response recovery and JSON repair SHALL share this single corrective allowance, and task-managed transport calls SHALL NOT introduce additional hidden empty-response retries. Correction SHALL respect the resolved output ceiling, context capacity, timeout, cancellation, and provider selection. An explicit safety refusal SHALL surface `SafetyBlocked` without a corrective generation attempting to bypass it. Cancellation and provider failures during correction SHALL preserve their mapped terminal categories instead of being replaced by the original validation error. Existing consent-controlled provider fallback SHALL retain its authorization and cancellation rules.

#### Scenario: Invalid structured output is rejected
- **WHEN** a model returns output that fails validation after the repair retry
- **THEN** the caller receives an `InvalidStructuredOutput` error and no domain object is created from the response

#### Scenario: Native structured output round-trips
- **WHEN** the on-device build supports schema-compiled structured output and a task declares a schema
- **THEN** the response arrives as a validated structured object and the JSON-fallback path is not used

#### Scenario: Empty response recovers within the single corrective allowance
- **WHEN** the initial final answer content is empty and one correction returns a valid structured answer
- **THEN** the validated answer is returned
- **AND** exactly two generation requests occurred for that provider execution, including transport-level requests

#### Scenario: Output-limit correction remains within configured limits
- **WHEN** the initial response exhausts its output allowance
- **THEN** the single correction requests compact valid output within the resolved provider and context limits
- **AND** no retry silently raises the user's configured output ceiling

#### Scenario: Two empty responses fail with a specific output diagnosis
- **WHEN** the initial response and the single correction both contain no final answer
- **THEN** the caller receives `InvalidStructuredOutput` with an empty-response failure kind and any known output-limit diagnosis
- **AND** no third generation request is sent to that provider
- **AND** no unsupported answer or embedding-failure claim is produced

#### Scenario: Explicit refusal is preserved
- **WHEN** a provider explicitly refuses the request for safety reasons
- **THEN** the caller receives `SafetyBlocked`
- **AND** no corrective generation or fallback attempts to bypass the refusal

#### Scenario: Corrective request fails at the provider
- **WHEN** an initial empty or invalid response is followed by a corrective request that fails with a provider error
- **THEN** the terminal error preserves the mapped provider-error category
- **AND** safe failure details distinguish the initial output failure from the corrective request failure

#### Scenario: Cancellation interrupts correction
- **WHEN** the user cancels during corrective generation
- **THEN** the operation ends as `Cancelled` without another corrective request or cloud fallback

### Requirement: Diagnostics without user content

The diagnostics store SHALL record per-task provider, model class, capability snapshot, timings, token estimates, retrieval counts and chunk ids, validation outcome, fallback path, and error category. It SHALL NOT record full document text, user answers, or complete prompts unless the user explicitly enables a developer debug mode. Structured-response recovery diagnostics SHALL additionally retain bounded attempt counts, first and terminal failure kinds, and available stop reason and token usage for the accepted or failed corrective attempt. These additional fields SHALL be whitelisted categories and numeric values; raw completions, reasoning content, tool payloads, credentials, endpoints, and arbitrary exception strings SHALL NOT be stored in ordinary diagnostics.

#### Scenario: Diagnostics entry for a failed structured task
- **WHEN** a card-generation task fails validation twice
- **THEN** the diagnostics entry contains the task id, provider, latencies, validation outcome `invalid-structured-output`, and error category, and contains neither the source passage nor the model's raw output

#### Scenario: Corrective attempt metadata is retained
- **WHEN** an empty first response is followed by a correction that also fails
- **THEN** diagnostics retain the retrieval count, both bounded failure kinds, the attempt count, and available terminal stop reason and usage
- **AND** the record contains no source text, raw response, reasoning text, tool payload, or arbitrary provider-error string

#### Scenario: Successful correction reports accepted completion metadata
- **WHEN** the corrective attempt produces the validated answer
- **THEN** completion diagnostics report the accepted response's available usage and stop reason
- **AND** the record indicates that one corrective attempt was used
