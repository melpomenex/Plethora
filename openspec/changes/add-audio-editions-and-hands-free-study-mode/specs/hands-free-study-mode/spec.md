# hands-free-study-mode Specification

## Purpose
Specifies native mobile and desktop media session integration, remote command normalization, Normal vs. Study control profiles, configurable remote mapping, audio confirmation feedback, and offline hands-free operation.

## ADDED Requirements

### Requirement: Native Platform Media Session Integration
The system SHALL integrate with native host OS media session services across all supported platforms:
- Android: Android Media3 `MediaSession` connected to `MediaSessionService` foreground service
- iOS: `MPRemoteCommandCenter` and `AVAudioSession` background audio
- Desktop (macOS, Windows, Linux): Platform media keys and Web MediaSession / MPRemoteCommandCenter

#### Scenario: Audio playback persists when device is locked
- **WHEN** user locks their mobile device while an Audio Edition is playing
- **THEN** audio playback SHALL continue uninterrupted and the system lockscreen media notification SHALL reflect the title, author, chapter name, and playback progress

### Requirement: Normalized Remote Command Architecture
The system SHALL intercept hardware and Bluetooth remote media events and map them into a normalized internal command stream (`Play`, `Pause`, `TogglePlayPause`, `Next`, `Previous`, `SeekForward`, `SeekBackward`).

#### Scenario: Bluetooth headphone media button pressed
- **WHEN** user double-taps their Bluetooth earbud (emitting standard OS Next command)
- **THEN** the native media session bridge SHALL capture the OS event and dispatch the normalized `Next` command to the Plethora media controller

### Requirement: Headphone Compatibility Standard
The system SHALL support remote interaction through any standard Bluetooth earbuds, wired headsets, car media buttons, or Bluetooth remotes that emit standard operating system media commands without requiring manufacturer-specific SDKs.

#### Scenario: Third-party wireless earbuds connected
- **WHEN** any Bluetooth earbud sends an OS media command (such as Next or Previous)
- **THEN** Plethora SHALL process the resulting command identically regardless of hardware brand (e.g. AirPods, Galaxy Buds, Pixel Buds, Sony, Bose)

### Requirement: Normal Controls vs. Study Controls Mode
The system SHALL support two distinct headphone control profiles:
- Normal Mode: Standard audio navigation (`Next` -> next section/track, `Previous` -> previous section/track, `SeekForward` -> +30s, `SeekBackward` -> -15s)
- Study Mode: Hands-free learning actions (`Next` -> Save Recent Extract, `Previous` -> Replay Recent 15s, `SeekForward` -> +30s, `SeekBackward` -> -15s).

#### Scenario: Study mode activated
- **WHEN** user switches the headphone control profile to "Study Mode"
- **THEN** incoming `Next` remote commands SHALL trigger "Save Recent Extract" rather than skipping to the next chapter

### Requirement: Configurable Remote Command Mapping
The system SHALL allow users to customize the action assigned to each normalized remote command in Study Mode in Settings.

#### Scenario: User customizes Previous command mapping
- **WHEN** user configures `Previous` to trigger "Mark Confusing / Needs Explanation" in Study Mode
- **THEN** receiving a `Previous` command during playback SHALL save the recent passage tagged with the "Needs Explanation" marker

### Requirement: Non-Intrusive Audio Feedback
When a hands-free learning action (such as Save Recent Extract or Mark Interesting) is executed, the system SHALL play a subtle confirmation chime and temporarily duck playback volume without pausing audio.

#### Scenario: Extract saved hands-free during walking
- **WHEN** user triggers Save Recent Extract via headphone button while their phone is locked
- **THEN** the system SHALL smoothly duck playback volume, play a short confirmation tone, restore playback volume within 500ms, and keep narration playing continuously

### Requirement: Offline Hands-Free Operation
The system SHALL execute hands-free extract saving, bookmark creation, and passage marking completely offline whenever the playing Audio Edition and its anchor metadata are stored locally on the device.

#### Scenario: Extract saved in airplane mode
- **WHEN** user triggers Save Recent Extract while the device has no network connection
- **THEN** the system SHALL resolve the source text using local anchor metadata and save the extract to the local SQLite database without error
