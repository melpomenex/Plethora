## Purpose

Provide dependable, semantic native tactile feedback on supported mobile hardware while preserving safe behavior across unsupported devices, app lifecycle changes and non-mobile environments.

## ADDED Requirements

### Requirement: Native Android tactile delivery
The native Android application SHALL deliver admitted semantic effects through the device's native touch-feedback facility on supported hardware. It SHALL use SDK-compatible semantic fallbacks, honor system and view-level touch-feedback controls, and SHALL NOT add a vibration permission, override system suppression or substitute arbitrary duration patterns for native delivery.

#### Scenario: Supported Android interaction
- **WHEN** a foreground Android user commits an eligible action with haptics enabled and compatible hardware/system settings
- **THEN** the native driver submits the mapped semantic effect and the phone produces tactile feedback
- **AND** the action requires no additional permission prompt

#### Scenario: Older supported Android release
- **WHEN** a semantic effect requests a constant unavailable on the device's supported SDK
- **THEN** the driver uses the documented compatible semantic fallback without crashing or raising the minimum application SDK

#### Scenario: System or view suppression
- **WHEN** system touch feedback or the target view's haptics are disabled, or the platform refuses an effect
- **THEN** no forced effect or louder retry occurs and the UI action completes normally

### Requirement: Native iOS tactile delivery
The native iOS application SHALL deliver native selection, impact and success/warning/error effects on supported hardware. It SHALL use public system-managed facilities, SHALL NOT rely on browser vibration for native iOS, and SHALL NOT use alert vibration or private preference APIs to bypass system behavior.

#### Scenario: Supported iPhone feedback
- **WHEN** the user changes a discrete grade, crosses a gesture threshold or completes a significant action on a supported foreground iPhone with haptics enabled
- **THEN** the device produces the appropriate native selection, impact or outcome feedback

#### Scenario: iOS unsupported hardware
- **WHEN** the app runs on an iPad, simulator or other device whose native haptic capability reports unavailable
- **THEN** delivery is a no-op and existing visible/action outcomes remain functional

#### Scenario: System-controlled iOS output
- **WHEN** the system suppresses native haptic output
- **THEN** the app accepts suppression without a fallback or retry and does not report an unobservable system preference as enabled

### Requirement: Honest cached capability reporting
The feedback boundary SHALL distinguish native mobile, mobile browser/PWA, desktop and unsupported surfaces using authoritative native platform classification. It SHALL expose hardware support, driver kind, supported intensity control and enabled/disabled/unknown system status independently of user preference. Capability discovery SHALL be cached and refreshed at startup/resume without per-frame or per-interaction queries. A native failure SHALL NOT silently switch to browser vibration.

#### Scenario: Native iOS lacks browser vibration
- **WHEN** a supported native iPhone has no browser vibration API
- **THEN** native capability remains discoverable and native effects are available

#### Scenario: Unknown system preference
- **WHEN** the platform offers no public getter for its relevant system preference
- **THEN** the UI reports system-controlled or unknown status without claiming the preference is enabled or requesting an unrelated permission

#### Scenario: Wide mobile and desktop spoofed user agent
- **WHEN** a native mobile window becomes tablet-width or a desktop window reports a mobile-looking user agent
- **THEN** the mobile app retains native delivery and the desktop app retains no-op delivery

### Requirement: Restricted and bounded native requests
Native haptic commands SHALL be accessible only from the trusted mobile main application webview. Requests SHALL validate supported semantic effects, protocol/session/configuration identity, bounded interaction identifiers and expiry. Desktop, remote content, unrelated webviews and invalid/stale requests SHALL NOT trigger hardware output.

#### Scenario: Untrusted or invalid invocation
- **WHEN** remote content, an unauthorized webview or a request with an unknown effect or invalid configuration attempts haptic output
- **THEN** output is denied or skipped and no hardware effect occurs

#### Scenario: Duplicate native request
- **WHEN** the same admitted interaction identity reaches native twice
- **THEN** native submits at most one effect and reports the duplicate as skipped

### Requirement: Nonblocking failure-safe delivery
Haptic delivery SHALL be fire-and-forget for its associated action and SHALL NOT determine action success. Missing plugin, driver rejection, hardware absence and delivery exceptions SHALL be isolated, SHALL NOT create user-facing feedback loops, and SHALL NOT cause unhandled promise rejections. Submission status SHALL NOT be represented as proof of a physically felt effect.

#### Scenario: Driver failure during save or Back
- **WHEN** a save or Back transition succeeds but native invocation fails
- **THEN** the successful action, UI update and native Back acknowledgement remain successful without waiting for haptic recovery

### Requirement: Lifecycle and configuration safety
App-driver effects SHALL occur only while the app is active/foreground. The driver SHALL start disabled until hydrated configuration is applied, suppress stale configuration/session requests and discard pending expired work on pause, teardown or driver replacement. It SHALL NOT replay missed effects on resume or retain a growing effect queue. Physically started effects need not be cancelable.

#### Scenario: Preference changes with native work pending
- **WHEN** haptics are disabled while an effect has been admitted but has not started
- **THEN** frontend admission stops immediately and native work using an obsolete applied configuration is suppressed once the new configuration is applied
- **AND** no new effects are queued to replay after enabling

#### Scenario: Background and resume
- **WHEN** a domain task completes while the app is inactive and the app later resumes
- **THEN** no app-driver effect fires in the background or replays at resume, while other allowed notification channels remain independent

### Requirement: Safe browser fallback and desktop compatibility
Supported mobile browsers/PWAs SHALL use a short bounded best-effort fallback subject to the same preferences and policy. Unsupported browsers SHALL no-op. Desktop hardware delivery SHALL no-op without changing existing sound, visual, toast or notification behavior. Browser refusal SHALL NOT lead to retries or longer vibration.

#### Scenario: Mobile browser accepts or rejects output
- **WHEN** an admitted mobile browser effect reaches an available vibration API
- **THEN** it requests one bounded pulse and handles success, false return or exception safely

#### Scenario: Desktop or unsupported web surface
- **WHEN** the same eligible action runs on desktop or a mobile browser without vibration support
- **THEN** no hardware output or native haptic bridge invocation occurs and the action retains its other permitted feedback

### Requirement: Physical device verification
Native delivery acceptance SHALL include recorded Android and iPhone hardware verification, including system preference and lifecycle cases. Unit tests, simulators and browser API mocks SHALL NOT be treated as evidence that a physical device produces haptics.

#### Scenario: Device evidence is missing
- **WHEN** automated tests pass but either Android or iPhone physical delivery has not been verified
- **THEN** native haptic implementation acceptance remains incomplete and the missing device gate is explicitly recorded
