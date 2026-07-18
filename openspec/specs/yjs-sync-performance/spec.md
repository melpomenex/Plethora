## ADDED Requirements

### Requirement: Batched Sync Replay on Boot
The system SHALL verify and replay Yjs map elements during startup synchronization in batches to avoid flooding the database and locking the local SQLite file.

#### Scenario: Startup sync processing
- **WHEN** the sync subsystems initialize on application boot
- **THEN** the system fetches and checks the existence and versions of sync elements in SQLite in batches rather than querying the database individually for every key.

### Requirement: Batched Review Projections
The system SHALL insert append-only review results into SQLite using bulk write transactions to minimize disk write locks and fsync operations.

#### Scenario: Replaying reviews
- **WHEN** a batch of remote review events is replayed to the database
- **THEN** the system performs the database insertions within a single transaction rather than executing individual writes per review record.

### Requirement: Sync Telemetry Long Task Warning Throttling
The system SHALL throttle or suppress verbose PerformanceObserver warnings in development mode to prevent IPC channel saturation and UI freezing.

#### Scenario: Long tasks detected during sync
- **WHEN** long tasks are observed by the performance monitoring utility in dev mode
- **THEN** the system logs warnings at a throttled rate and does not flood the terminal console.

### Requirement: Target-Gated GPU Acceleration Configuration
The system SHALL only apply WebKitGTK and Mesa software-rendering workarounds on platforms that require it.

#### Scenario: Running dev mode on macOS
- **WHEN** the application is started on macOS in development mode
- **THEN** GPU rendering workarounds are bypassed, allowing the app to run with native hardware acceleration.
