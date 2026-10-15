## ADDED Requirements

### Requirement: Mobile device capability evaluation
Before recommending or allowing local Nemotron installation on Android or iOS, the system SHALL evaluate architecture compatibility, available RAM, storage, runtime/backend support, and expected memory requirements.

#### Scenario: Unsupported mobile device
- **WHEN** the device cannot safely execute local Nemotron
- **THEN** the UI SHALL show that local Nemotron is unsupported and SHALL NOT offer a broken install action

#### Scenario: Supported but slow device
- **WHEN** the device can run Nemotron but performance is likely poor
- **THEN** the UI SHALL warn that cloud transcription may be faster and SHALL offer Install Anyway

### Requirement: Device performance classification
The system SHALL classify expected local ASR performance as Excellent, Good, Usable, Slow, or Unsupported based on benchmark thresholds, without exposing raw metrics to ordinary users unless useful.

#### Scenario: High-performance device classification
- **WHEN** post-install benchmark indicates greater than 2× realtime factor
- **THEN** the device SHALL be classified as Excellent for Nemotron local ASR

### Requirement: Android local Nemotron support
On supported Android ARM64 devices, Plethora SHALL support Nemotron installation through the same model manager and local transcription via Vulkan or CPU backends.

#### Scenario: Android supported device transcription
- **WHEN** Nemotron is installed on a supported Android device and the user selects Local provider
- **THEN** transcription SHALL execute on-device without uploading audio

#### Scenario: Android offline guarantee
- **WHEN** offline-only mode is active on Android
- **THEN** no audio SHALL be sent to cloud providers

### Requirement: iOS local Nemotron support
On supported iOS/iPadOS ARM64 devices, Plethora SHALL support Nemotron installation and local transcription via Metal or CPU backends using the same transcript APIs as desktop and Android.

#### Scenario: iOS app suspend during transcription
- **WHEN** the app is suspended during a long transcription job
- **THEN** the job SHALL pause or checkpoint safely and resume without corrupting partial transcript state

### Requirement: Shared LocalTranscriptionProvider across platforms
Android, iOS, and desktop SHALL use the same logical `LocalTranscriptionProvider` abstraction and model registry, differing only in native runtime backends.

#### Scenario: Cross-platform model identity
- **WHEN** a user installs Nemotron on phone and desktop
- **THEN** both platforms SHALL reference the same logical model with platform-appropriate runtime paths

### Requirement: Mobile thermal and battery awareness
Mobile local ASR SHALL account for sustained load, thermal throttling, and battery impact; the system SHALL warn when sustained realtime transcription may not be reliable on the current device.

#### Scenario: Extended realtime session on mobile
- **WHEN** sustained local realtime transcription falls behind realtime (factor > 1.0)
- **THEN** the system SHALL warn the user rather than silently accumulating unbounded latency
