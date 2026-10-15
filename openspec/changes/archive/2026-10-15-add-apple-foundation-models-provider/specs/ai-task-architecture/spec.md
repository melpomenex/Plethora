## MODIFIED Requirements

### Requirement: Unified AI task execution layer

All AI features SHALL execute through `runTask`. Apple Foundation Models SHALL participate as `AppleFoundationProvider` (`ondevice-apple-foundation`) when routed. Prompt strings SHALL remain exclusively in TypeScript task definitions (`src/lib/ai/tasks/`), including `smart-tagging`, `learn-this`, `ask-library`, and Studio tasks.

#### Scenario: Existing passage action on Apple FM
- **WHEN** a user triggers Explain, Summarize, Simplify, or Key terms and the router selects `ondevice-apple-foundation`
- **THEN** the action executes via the task layer with the same containment, validation, streaming, and cancellation contracts as other providers
- **AND** React does not call Foundation Models directly

#### Scenario: Smart tagging uses the existing task
- **WHEN** smart tagging runs on Apple FM
- **THEN** `src/lib/ai/tasks/definitions/smartTaggingTask.ts` is the only tagging task
- **AND** Tier 1 `classifyDocumentBaseline` remains the no-LLM fallback

### Requirement: Capability-aware availability

Feature UI SHALL treat Apple FM as available only when `getCapabilities()` reports the required live flags. Device SKUs SHALL NOT be assumed.

#### Scenario: Apple FM not ready
- **WHEN** availability is `modelNotReady` or Apple Intelligence is disabled
- **THEN** generation controls are not presented as on-device-ready
- **AND** the UI maps to `ModelDownloading` or `FeatureDisabled`

### Requirement: Structured output is validated and fail-closed

Guided `@Generable` output from Apple FM SHALL still pass TypeScript schema validation (`smartTagging`, `learningMaterialProposal`, `libraryAnswer`, `generatedFlashcards`) before downstream use.

#### Scenario: Invalid Apple FM structured output
- **WHEN** guided output fails validation after the repair retry
- **THEN** the caller receives `InvalidStructuredOutput`
- **AND** no domain object is created

### Requirement: Unified AI error taxonomy with graceful degradation

Apple-specific failures SHALL map into A's categories (`FeatureDisabled`, `UnsupportedDevice`, `ModelDownloading`, `UnsupportedLanguage`, `PermissionDenied` if used, plus existing `Cancelled` / `SafetyBlocked` / `InputTooLarge`). Cancelled Apple FM requests SHALL never fall back to cloud.

#### Scenario: Cancelled Apple FM never falls back
- **WHEN** a user cancels an on-device Apple FM request that would have fallen back to cloud on failure
- **THEN** cancellation propagates without invoking `CloudProvider`

### Requirement: Untrusted content containment in prompts

Document text sent to Apple FM SHALL already be inside `<untrusted_source>` blocks built by TS tasks. Swift SHALL NOT lift that text into trusted `Instructions`.

#### Scenario: Injected directive is still contained
- **WHEN** source document text attempts to issue instructions
- **THEN** the task treats it as content
- **AND** Apple FM receives it only inside the task-built `text` field

### Requirement: Diagnostics without user content

Diagnostics for Apple FM runs SHALL record `providerId` `ondevice-apple-foundation` and MUST NOT record prompts, documents, or completions.

#### Scenario: Diagnostics for Apple FM structured failure
- **WHEN** a structured task fails validation on Apple FM
- **THEN** the diagnostics entry contains task id, provider id, validation outcome, and error category
- **AND** contains neither the source passage nor the model output
