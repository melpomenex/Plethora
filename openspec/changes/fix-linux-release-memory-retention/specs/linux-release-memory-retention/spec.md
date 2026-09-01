## ADDED Requirements

### Requirement: Release post-close web memory returns near idle

On Linux release builds, after four representative document tabs are opened and then all closed and the application settles, the web-content process proportional memory (PSS) SHALL NOT exceed the pre-open idle web-content PSS by more than the configured post-close allowance.

#### Scenario: All tabs closed releases renderer memory

- **WHEN** a release build completes the harness `all-closed` stage after opening four document tabs
- **THEN** the sum of web-content process PSS values is at most the `idle-fresh` web-content PSS plus the post-close allowance
- **AND** the total tree PSS does not exceed the `four-tabs` total tree PSS

#### Scenario: Post-close allowance is recorded in baselines

- **WHEN** a reviewer reads the memory baseline file for the Linux release profile
- **THEN** the post-close web-content metric lists its baseline, tolerance, and the post-close allowance used to derive the threshold

### Requirement: Release cycle ratchet is bounded

On Linux release builds, after the harness repeated open/close cycle stages complete and the application reaches `idle-final`, the web-content process PSS SHALL NOT grow without bound relative to the warmed-up idle measurement.

#### Scenario: Cycle-final web memory is near idle

- **WHEN** a release build completes the harness `idle-final` stage after single-document and multi-document cycle stages
- **THEN** the web-content process PSS is at most the `idle-fresh` web-content PSS plus the configured cycle-ratchet allowance
- **AND** the trend across the last three cycle samples is not monotonically increasing

#### Scenario: Native memory stays flat across cycles in release

- **WHEN** a release build completes the full harness scenario
- **THEN** the native process PSS at `idle-final` is within the configured native ratchet allowance of the native PSS at `idle-fresh`

### Requirement: First-document open cost is recorded as a diagnostic

The harness SHALL record the web-content PSS delta between `idle-fresh` and the first single-document-open stage as a diagnostic metric for release builds. This metric SHALL be reported but SHALL NOT fail the gate until a baseline is committed with an explicit gate/diagnostic classification.

#### Scenario: One-document delta is present in results

- **WHEN** a release harness run completes successfully
- **THEN** the result JSON includes a derived `one-document-web-delta` value computed from stage samples
- **AND** the gate prints the value in its diagnostic section

### Requirement: Fixes do not regress reader behavior

Memory retention fixes SHALL preserve all reader behaviors verified before this change: password-protected PDF open, outline navigation, text selection, OCR/reflow rendering, tab position restore after eviction, and PDF range transport without silent whole-file fallback.

#### Scenario: Regression suite passes after memory fixes

- **WHEN** the memory retention change is complete
- **THEN** existing PDF viewer unit tests, reflow asset tests, tab store tests, and `npm run bench:check` all pass without modification to their expectations
- **AND** a manual smoke open of a password-protected PDF with outline succeeds on Linux release
