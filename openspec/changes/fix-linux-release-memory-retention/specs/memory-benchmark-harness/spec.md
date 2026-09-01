## ADDED Requirements

### Requirement: Results record the application build profile

The harness result JSON SHALL include a `buildProfile` field with value `release` or `debug`, derived from the launched binary path or an explicit `--profile` flag. The gate SHALL use this field when selecting a baseline profile.

#### Scenario: Release binary is classified correctly

- **WHEN** the harness is invoked with `--app target/release/plethora-tauri`
- **THEN** the emitted result JSON contains `"buildProfile": "release"`

#### Scenario: Debug binary is classified correctly

- **WHEN** the harness is invoked with the default debug binary or `--profile debug`
- **THEN** the emitted result JSON contains `"buildProfile": "debug"`

### Requirement: Linux WebKit processes are classified despite comm truncation

On Linux, process role classification SHALL correctly identify WebKitGTK web-content and network auxiliary processes even when `/proc/<pid>/comm` is truncated to 15 characters. Classification SHALL use prefix matching on `comm` and, when readable, the full executable name from `/proc/<pid>/exe` or `cmdline`.

#### Scenario: Truncated WebKitWebProcess comm maps to web-content

- **WHEN** a process has `comm` equal to `WebKitWebProce` and belongs to the launched instance
- **THEN** the harness classifies it as `web-content`
- **AND** its PSS is aggregated into the web-content bucket, not `other`

#### Scenario: Truncated WebKitNetworkProcess comm maps to network

- **WHEN** a process has `comm` equal to `WebKitNetworkPr` and belongs to the launched instance
- **THEN** the harness classifies it as `network`

#### Scenario: Role classification is unit-tested with synthetic proc trees

- **WHEN** the discovery unit tests run with a synthetic proc tree containing truncated WebKit comm names
- **THEN** the tests assert web-content and network roles are assigned correctly
