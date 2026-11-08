## Purpose

Defines user-configurable podcast preparation policies governing when and how automated transcription and advertising classification are executed across devices, network connections, and feed preferences.

## ADDED Requirements

### Requirement: User-Configurable Processing Modes
The system SHALL provide distinct processing modes controlling the automation level of background transcription and advertising analysis.

#### Scenario: Battery Saver mode operation
- **WHEN** the application is set to "Battery Saver" mode
- **THEN** the system SHALL perform only inexpensive metadata and chapter analysis
- **AND** the system SHALL NOT automatically initiate local speech-to-text or LLM inference on battery power

#### Scenario: Smart Processing mode operation
- **WHEN** the application is set to "Smart Processing" mode
- **THEN** eligible new episodes SHALL be transcribed and classified automatically only while the device is connected to external power
- **AND** the system SHALL defer heavy processing jobs if the device is disconnected from power or enters a low-battery state

#### Scenario: Always Process mode operation
- **WHEN** the user selects "Always Process" mode
- **THEN** the system SHALL process queued episodes automatically on both battery and AC power
- **AND** the system SHALL continue to enforce critical thermal thresholds and operating-system background task limits

#### Scenario: Manual Only mode operation
- **WHEN** the user selects "Manual Only" mode
- **THEN** no podcast transcription or classification jobs SHALL be started automatically
- **AND** jobs SHALL execute only upon explicit user invocation per episode

### Requirement: Granular Feed and Episode Overrides
The user SHALL be able to configure processing policies at the individual podcast feed level and override policies for individual episodes.

#### Scenario: Disabling ad removal for an ad-free subscriber feed
- **WHEN** a user subscribes to a patron-exclusive or paid podcast feed that has no ads
- **THEN** the user SHALL be able to disable ad detection specifically for that feed
- **AND** episodes from that feed SHALL bypass ad classification queues while retaining manual transcription options

#### Scenario: Explicit one-time preparation request
- **WHEN** an episode has not been processed and the user selects "Prepare Ad-Free Playback"
- **THEN** the system SHALL present a pre-flight preparation sheet detailing the required STT engine, model size, and estimated compute
- **AND** start immediate processing upon user confirmation, overriding background policy deferrals

### Requirement: Strict Ad-Free Playback Enforcement
The system SHALL support an optional strict playback policy that guards listeners from hearing unanalyzed episodes until ad removal processing is complete.

#### Scenario: Attempting to play an unprocessed episode under strict policy
- **WHEN** the user attempts to play an episode that has not completed advertising analysis
- **AND** the "Require Ad-Free Preparation" setting is enabled
- **AND** the system SHALL pause playback and present options: "Prepare Now", "Play Original Anyway", or "Wait for Charging"

#### Scenario: User opting to play original audio immediately
- **WHEN** the listener chooses "Play Original Anyway" on an unprocessed episode
- **THEN** playback SHALL start immediately in original-audio mode
- **AND** background analysis SHALL continue concurrently if permitted by device conditions without interrupting audio
