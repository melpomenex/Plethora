## ADDED Requirements

### Requirement: Reading-progress timestamps SHALL use one explicit internal unit

The position API SHALL convert transport-level Unix-second timestamps to JavaScript millisecond timestamps exactly once before constructing `DocumentWithProgress` values. Dashboard and Continue Reading consumers SHALL use the normalized value and SHALL NOT subtract Unix seconds directly from `Date.now()`.

#### Scenario: Current document returned by native backend

- **WHEN** the native position command returns a current `date_modified` Unix timestamp in seconds
- **THEN** the API model contains the equivalent timestamp in milliseconds and relative-time formatting reports a current/recent value rather than a decades-old value

#### Scenario: Current document returned by browser backend

- **WHEN** the browser backend returns the same document timestamp contract
- **THEN** the API produces the same normalized millisecond value and the same relative-time output as the native path

### Requirement: Relative-time labels SHALL describe last modification activity

Dashboard and Continue Reading SHALL use a shared relative-time formatter for `date_modified`. The visible label or its accessible tooltip SHALL identify the value as last updated/modified activity, not document creation time.

#### Scenario: Recently modified document

- **WHEN** a document was modified within the supported recent intervals
- **THEN** the UI displays the shared formatter’s appropriate minutes, hours, days, or weeks label

#### Scenario: Invalid or missing timestamp

- **WHEN** a document has an invalid, missing, or non-finite modification timestamp
- **THEN** the UI displays a safe localized fallback and does not emit `NaN`, an implausibly large unit, or a misleading “2947w ago” value
