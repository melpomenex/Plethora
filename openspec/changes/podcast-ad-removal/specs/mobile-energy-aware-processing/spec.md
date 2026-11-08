## Purpose

Specifies real native hardware and operating-system signal integration on mobile platforms (Android and iOS) to regulate battery drain, thermal output, and background compute for podcast preparation.

## ADDED Requirements

### Requirement: Real Native Mobile Power Signal Integration
The application SHALL query genuine operating-system battery and charging status via native platform APIs on Android and iOS, replacing placeholder mobile stubs.

#### Scenario: Reading battery and charging state on Android
- **WHEN** battery state is queried on an Android device
- **THEN** the native backend SHALL query `BatteryManager.EXTRA_STATUS` and `BatteryManager.EXTRA_LEVEL`
- **AND** return verified boolean charging state and accurate percentage (0.0 to 1.0) to the frontend context

#### Scenario: Reading battery state on iOS
- **WHEN** battery state is queried on an iOS device
- **THEN** the native backend SHALL enable `UIDevice.isBatteryMonitoringEnabled`
- **AND** read `UIDevice.current.batteryState` and `UIDevice.current.batteryLevel` with genuine hardware values

### Requirement: Low Power Mode and Power Saver Signal Detection
The background job scheduler SHALL observe the operating system's Low Power Mode or Battery Saver state and immediately defer heavy on-device compute when active.

#### Scenario: Deferring processing when Android Battery Saver activates
- **WHEN** Android's `PowerManager.isPowerSaveMode()` reports true
- **THEN** all automated background transcription and classification jobs SHALL be paused
- **AND** the UI status badge SHALL indicate "Processing Deferred (Battery Saver Active)"

#### Scenario: Deferring processing when iOS Low Power Mode activates
- **WHEN** iOS `ProcessInfo.processInfo.isLowPowerModeEnabled` reports true
- **THEN** pending on-device inference tasks SHALL yield immediately
- **AND** no new heavy inference jobs SHALL be dispatched until Low Power Mode is disabled

### Requirement: Thermal State Monitoring and Compute Throttling
The system SHALL monitor device thermal status where supported and throttle or pause on-device models to prevent device overheating or thermal throttling of active playback.

#### Scenario: Thermal throttling under severe thermal pressure on iOS
- **WHEN** `ProcessInfo.processInfo.thermalState` reports `.serious` or `.critical`
- **THEN** the background processing manager SHALL pause active local inference
- **AND** prioritize audio playback decoder responsiveness over background transcription

#### Scenario: Thermal monitoring on Android
- **WHEN** an Android device with API level 29+ triggers `PowerManager.OnThermalStatusChangedListener`
- **AND** thermal status exceeds `THERMAL_STATUS_MODERATE`
- **THEN** the processing queue SHALL suspend background batch jobs until the device returns to normal thermal state

### Requirement: OS-Compliant Background Task Scheduling
The mobile application SHALL coordinate background jobs using platform-approved schedulers (Android WorkManager and iOS BGTaskScheduler), respecting system limits on background execution duration.

#### Scenario: Scheduling deferred jobs via Android WorkManager
- **WHEN** an episode is queued for processing under Smart Processing policy
- **THEN** the Android backend SHALL register a `OneTimeWorkRequest` with constraints requiring charging (`setRequiresCharging(true)`) and unmetered network
- **AND** the job SHALL execute when the operating system determines conditions are satisfied

#### Scenario: Handling iOS background task expiration
- **WHEN** an iOS background processing task registered via `BGTaskScheduler` receives an expiration handler callback
- **THEN** the transcription engine SHALL checkpoint current segment progress to SQLite
- **AND** cleanly terminate the active process before the OS-imposed deadline to prevent app termination
