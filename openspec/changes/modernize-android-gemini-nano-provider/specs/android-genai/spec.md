## MODIFIED Requirements

### Requirement: On-device AI capability detection
The system SHALL continue to expose independent Prompt, Summarization, and image-Prompt states without inference side effects, and SHALL map AICore initialization vs permanent unsupported distinctly.

#### Scenario: Supported device with model ready
- **WHEN** ML Kit reports `AVAILABLE` for Prompt
- **THEN** the snapshot reports Prompt `available`

#### Scenario: Temporarily not ready is not unsupported
- **GIVEN** AICore `FEATURE_NOT_FOUND` immediately after device setup or AICore data clear
- **WHEN** capability is checked
- **THEN** the feature is reported as unavailable-with-not-ready/download semantics suitable for retry
- **AND** the UI does not claim the hardware is permanently incapable solely from a single immediate check after setup

#### Scenario: Unlocked bootloader remains unsupported
- **GIVEN** documentation-level AICore incompatibility (unlocked bootloader) persists after initialization
- **THEN** the feature reports `unavailable` with `device_unsupported` (or equivalent)
- **AND** import still works

### Requirement: Native error codes reach TypeScript
Every Kotlin `ErrorCode` string SHALL appear in `ON_DEVICE_AI_ERROR_CODES` (or a documented alias) and SHALL map to the unified `AIError` categories from `extend-ai-capability-architecture`.

#### Scenario: Background use
- **WHEN** the plugin rejects with `background_use_blocked`
- **THEN** TypeScript surfaces `ForegroundRequired`
- **AND** `runTask` does not mark structured output as validated-complete

#### Scenario: Battery quota
- **WHEN** the plugin rejects with `battery_quota_exceeded`
- **THEN** TypeScript surfaces `BatteryQuotaExceeded`
- **AND** the plugin does not busy-retry that error

#### Scenario: Flashcards stay on-device when ready
- **GIVEN** Prompt available, `preferOnDevice` true, `allowCloudFallback` false
- **WHEN** flashcard generation runs
- **THEN** routing uses the Android on-device provider
- **AND** cards parse into `GeneratedFlashcard` / existing studio contracts
- **AND** the routing layer initiates no cloud request

## ADDED Requirements

### Requirement: Specialized vs Prompt routing
Bullet summarization in supported Summarization languages SHALL use the Summarization API when that capability is `available`. Study-structured generation SHALL use Prompt (+ structured envelopes when compiled and device-supported). Short generic alt text MAY use Image Description when that client is compiled and `available`; image study cards SHALL use Prompt multimodal.

#### Scenario: Unsupported summarization language uses Prompt
- **WHEN** input language is not EN/JA/KO and Prompt is available
- **THEN** a bounded Prompt summary is used
- **AND** Summarization unavailability does not disable Prompt

#### Scenario: Image Description optional
- **WHEN** Image Description is not compiled or not available
- **THEN** alt-text requests degrade to Prompt image or skip without crashing
