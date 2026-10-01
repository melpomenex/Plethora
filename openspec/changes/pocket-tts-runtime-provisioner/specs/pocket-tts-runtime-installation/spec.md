## Purpose

Lets users provision a working local Pocket TTS text-to-speech runtime from the app itself, with real install progress, cancellation, and removal, so the advertised "Download" control installs the engine instead of failing with an OS error code.

## ADDED Requirements

### Requirement: Install command provisions a Pocket TTS runtime
The system SHALL expose an install operation that creates a Pocket TTS runtime under the application's data directory and makes it usable for synthesis, without requiring the user to run a package manager by hand. The operation SHALL complete only after the provisioned runtime has been verified by executing it.

The provisioned runtime SHALL live under the application's own data directory rather than a system or user-global location, and SHALL NOT modify any Python environment the user already owns.

#### Scenario: Successful install from a clean machine
- **WHEN** the user requests the install on a machine with no Pocket TTS runtime present
- **THEN** the system creates the runtime under the application data directory, reports each install phase as progress, and on completion the status check reports the runtime as available with a source identifying the provisioned copy

#### Scenario: Install is verified before reporting success
- **WHEN** the install has finished creating the runtime
- **THEN** the system executes the provisioned runtime to confirm it loads, and reports success only if that execution succeeds

#### Scenario: Install does not touch a pre-existing user environment
- **WHEN** the install runs on a machine that already has a Pocket TTS installation managed by the user
- **THEN** the system creates its runtime under the application data directory and does not modify, upgrade, or uninstall the user's existing installation

#### Scenario: Install failure leaves no partial runtime
- **WHEN** any step of the install fails
- **THEN** the system removes the partially created runtime from the application data directory and reports a failure describing what failed

#### Scenario: Install on an unsupported platform
- **WHEN** the install is requested on a platform that has no supported provisioning path
- **THEN** the system reports a failure naming the platform, and does not leave partial state behind

### Requirement: Install progress is reported to the user
The system SHALL report install progress as a stream of progress events carrying the install identifier, the current phase, the bytes received so far, the total bytes when known, and a percentage. Progress SHALL be reported for the phases of obtaining the runtime, preparing its environment, and preloading the model weights.

Progress events SHALL never report a percentage or byte count lower than one already reported for the same install, so a retried or restarted step never makes the progress bar move backwards.

The system SHALL emit a terminal completion event carrying the install identifier, whether the install succeeded, and a message, on every install outcome — success, failure, and cancellation.

#### Scenario: Progress advances through phases
- **WHEN** an install runs to completion
- **THEN** the user sees progress events for the runtime, environment, and weight-preload phases, followed by exactly one completion event reporting success

#### Scenario: Progress never moves backwards
- **WHEN** an install step is retried after a partial failure
- **THEN** every emitted percentage and byte count is greater than or equal to the previously emitted value for the same install

#### Scenario: Failure emits a terminal event
- **WHEN** an install fails partway through
- **THEN** the user receives a completion event reporting failure with a readable message, and no progress indicator remains active

#### Scenario: Unknown total size still reports bytes
- **WHEN** the total size of the artifact being fetched is not known in advance
- **THEN** progress events still carry the running byte count so the user can see the install advancing

### Requirement: Install can be cancelled
The system SHALL allow an in-flight install to be cancelled. Cancellation SHALL stop the install promptly, SHALL remove the partial runtime, and SHALL report cancellation through the terminal completion event rather than as a failure the user must interpret.

#### Scenario: Cancel during install
- **WHEN** the user cancels while an install is in progress
- **THEN** the install stops, the partial runtime is removed, and a completion event reports the install as cancelled

#### Scenario: Cancel with nothing in flight
- **WHEN** a cancel is requested while no install is running
- **THEN** the system reports success without error and changes no state

### Requirement: Duplicate installs are rejected
The system SHALL run at most one install at a time. A second install request while one is in flight SHALL be rejected with a message that the user can act on, and SHALL NOT interfere with the running install.

#### Scenario: Second install request while one is running
- **WHEN** the user requests an install while another install is already in progress
- **THEN** the second request is rejected with a message saying an install is already running, and the first install continues uninterrupted

#### Scenario: Install can be started again after completion
- **WHEN** an install request is made after a previous install has finished
- **THEN** the new install proceeds normally

### Requirement: Disk space is checked before installing
The system SHALL check that the volume holding the application data directory has enough free space for the install before starting, and SHALL refuse to start when it does not. The refusal message SHALL state how much space the install needs and how much is free. When free space cannot be measured, the install SHALL proceed.

#### Scenario: Not enough free space
- **WHEN** the free space on the application data volume is less than the size the install requires
- **THEN** the system refuses to start, reports the required and available space, and downloads nothing

#### Scenario: Enough free space
- **WHEN** the free space on the application data volume is at least the size the install requires
- **THEN** the install proceeds

#### Scenario: Free space cannot be measured
- **WHEN** the free space on the application data volume cannot be determined
- **THEN** the install proceeds without a space refusal

### Requirement: Runtime resolution reports its source
The system SHALL resolve the Pocket TTS executable by checking the provisioned runtime first, then a runtime bundled with the application, then system search paths, and SHALL report which of these produced the executable. When no source yields a working executable, the system SHALL report the runtime as unavailable together with a reason code.

#### Scenario: Provisioned runtime is preferred
- **WHEN** a provisioned runtime exists and a Pocket TTS installation is also present on the system search path
- **THEN** the system uses the provisioned runtime and reports its source as the provisioned copy

#### Scenario: Bundled runtime is used when nothing is provisioned
- **WHEN** no provisioned runtime exists but a runtime bundled with the application does
- **THEN** the system uses the bundled runtime and reports its source as the bundled copy

#### Scenario: System installation is the last resort
- **WHEN** neither a provisioned nor a bundled runtime exists but a Pocket TTS installation is reachable on the system search path
- **THEN** the system uses it and reports its source as the system installation

#### Scenario: No runtime anywhere
- **WHEN** no source yields a working Pocket TTS executable
- **THEN** the status check reports the runtime as unavailable with a reason code indicating that no runtime is installed, and does not report an operating-system error as the reason

#### Scenario: Runtime present but broken
- **WHEN** a runtime is found but fails to load
- **THEN** the status check reports the runtime as unavailable with a reason code indicating a broken runtime, distinct from the not-installed reason, and names the failing executable path

### Requirement: Install state is reported structurally
The status check SHALL report an install state drawn from a fixed set of values — not installed, installing, installed, broken, or failed — rather than only a boolean and a free-text error. The status response SHALL NOT report an install in progress or a download percentage unless an install is genuinely in flight.

#### Scenario: Idle state before any install
- **WHEN** no install has been started and none is running
- **THEN** the status check reports the install state as not installed, with no active download and no download percentage

#### Scenario: State during an install
- **WHEN** an install is in progress
- **THEN** the status check reports the install state as installing

#### Scenario: No fabricated download percentage
- **WHEN** no install is in progress
- **THEN** the status response contains no download percentage and no active-download flag, regardless of any previous install

### Requirement: Synthesis failures are actionable
Every failure to start or run the Pocket TTS executable SHALL be reported with a message that names the executable that was tried and states the recovery step. A raw operating-system error code SHALL NOT be the user-visible message. The same standard applies to the status check, which SHALL report an unavailable status rather than failing with an error when the executable cannot be started.

#### Scenario: Executable cannot be started
- **WHEN** synthesis is requested and the resolved executable cannot be started
- **THEN** the user sees a message naming the executable path that was tried and the recovery step, and does not see a bare operating-system error code

#### Scenario: Executable runs but exits non-zero
- **WHEN** the executable starts but exits with a failure code
- **THEN** the user sees the executable's own error output alongside the recovery step

#### Scenario: Status check with no executable
- **WHEN** the status check runs on a machine with no Pocket TTS executable
- **THEN** it reports an unavailable status with a reason code, and does not fail with an operating-system error

#### Scenario: Text longer than the argument limit
- **WHEN** synthesis is requested with text long enough to exceed the operating system's argument length limit
- **THEN** the request succeeds by passing the text to the executable by a means that does not rely on the command line

### Requirement: Model weights are preloaded during install
The install SHALL preload the model weights after the runtime is provisioned, so that the first user-initiated synthesis does not block on fetching them. The weight preload SHALL be reported as its own install phase, and a preload failure SHALL be reported as an install failure rather than silently leaving the user to discover it later.

#### Scenario: Weights are fetched during install
- **WHEN** an install runs on a machine where the model weights have never been fetched
- **THEN** the weights are fetched during the install and the preload is reported as a distinct phase

#### Scenario: Weights already present
- **WHEN** an install runs on a machine where the model weights are already cached
- **THEN** the preload phase completes without re-fetching the weights

#### Scenario: Preload failure fails the install
- **WHEN** the model weights cannot be fetched during the install
- **THEN** the install is reported as failed with a message describing the weight preload failure

### Requirement: Install can be removed
The system SHALL allow the provisioned runtime to be removed, SHALL stop reporting it as available afterwards, and SHALL leave a runtime the user installed themselves untouched. A removal requested while an install is in flight SHALL be refused.

#### Scenario: Remove the provisioned runtime
- **WHEN** the user removes the provisioned runtime
- **THEN** the status check no longer reports the provisioned copy as available, and the runtime is absent from the application data directory

#### Scenario: Remove leaves a user installation alone
- **WHEN** the user removes the provisioned runtime and a Pocket TTS installation they made themselves is still reachable
- **THEN** that installation is still reported as available and is not modified

#### Scenario: Remove with no provisioned runtime
- **WHEN** the user requests removal and no provisioned runtime exists
- **THEN** the system reports success without error and changes no state

#### Scenario: Remove during an install
- **WHEN** a removal is requested while an install is in progress
- **THEN** the removal is refused with a message, and the running install is not disturbed

### Requirement: Settings panel drives a real install
The settings panel SHALL offer a control that starts the install, SHALL reflect the reported install state, and SHALL show progress driven by install events rather than by a fixed or invented percentage. While an install is in flight the panel SHALL offer a way to cancel it, and once a provisioned runtime exists it SHALL offer a way to remove it.

The panel SHALL NOT start an install by performing a synthesis.

#### Scenario: Download control starts an install
- **WHEN** the user activates the install control and no runtime is present
- **THEN** the system starts the install and no synthesis is attempted

#### Scenario: Progress bar reflects events
- **WHEN** progress events arrive during an install
- **THEN** the panel's progress indicator reflects the reported percentage and byte counts from those events

#### Scenario: Cancel and remove controls are offered in the right states
- **WHEN** an install is in flight
- **THEN** the panel offers a cancel control; and once a provisioned runtime exists and no install is running, it offers a remove control

#### Scenario: Failure is shown in the panel
- **WHEN** an install fails
- **THEN** the panel shows the failure message and returns to a state where the install control can be used again
