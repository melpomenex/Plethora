## Purpose

Ensure Android users can tell when local data is still loading, see populated data after a slow cold start without navigating away, and distinguish a genuinely empty library from an unsuccessful startup read.

## ADDED Requirements

### Requirement: Android startup distinguishes loading from an empty result

The application SHALL NOT present an empty-library or empty-queue state on Android until the initial local-data request for the active surface has completed successfully. While database readiness or the request is pending, the active surface SHALL show a loading state; after success, it SHALL show the returned data or the appropriate empty state.

#### Scenario: Populated database responds after a slow cold start
- **WHEN** an Android app starts with local documents or queue items and the initial database or IPC response is delayed
- **THEN** the active surface remains in a loading state while the request is unresolved
- **AND** the returned items appear without requiring the user to switch views or relaunch the app

#### Scenario: Database is confirmed empty
- **WHEN** the initial local-data request completes successfully and returns no items for the active surface
- **THEN** the surface presents its normal empty state
- **AND** it does not continue retrying that successful empty result as if it were a startup failure

### Requirement: Android recovers from transient startup data failures

If the initial local-data request times out or fails while Android startup is in progress, the application SHALL retry it automatically with bounded backoff while the affected surface remains relevant. If automatic attempts are exhausted, the application SHALL keep the failure distinguishable from an empty result and provide an explicit way to retry. A successful result for the active collection SHALL be applied without waiting for user navigation.

#### Scenario: Startup request times out before the backend is ready
- **WHEN** the first local-data request times out or fails because the Android database or bridge is not ready
- **THEN** the application starts a bounded retry sequence without requiring a view change
- **AND** a later successful request hydrates the active surface with its returned items

#### Scenario: Retries cannot load local data
- **WHEN** the bounded automatic retries fail
- **THEN** the surface shows a recoverable error state rather than an empty-library state
- **AND** the user can explicitly retry the local-data request

#### Scenario: Collection changes during a delayed request
- **WHEN** the active collection changes before an Android startup request completes
- **THEN** results for the old collection are not presented as the new collection's data
- **AND** the active collection receives its own startup request and readiness state

### Requirement: Android startup preserves available data during retries

An Android startup retry or app-resume refresh SHALL NOT clear previously loaded local items while a new request is pending or after it fails. Only a successful response for the active collection may replace or update the visible data.

#### Scenario: App resumes while local data is already visible
- **WHEN** a backgrounded Android app refreshes local startup data and the request is delayed or fails
- **THEN** previously loaded items remain visible
- **AND** the surface communicates refresh progress or the recoverable failure without presenting a false empty state
