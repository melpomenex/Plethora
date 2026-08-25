## Purpose

Extends the memory benchmark harness to macOS, to idle-soak durations, and to the audio synthesis subsystems implicated in the 74 GB incident. macOS collection reports physical footprint per process instead of PSS, but plugs into the same scenario, settle, result, baseline, and gate machinery; soak stages sample periodically so an overnight run is attributable the morning after; TTS and audio-edition stages drive the previously unexercised synthesis lifetimes.

## ADDED Requirements

### Requirement: Memory collection is supported on macOS via physical footprint

The harness SHALL support memory collection on macOS. For every process belonging to the launched instance, each sample SHALL report the process's physical footprint as the headline field, alongside resident size and any additionally available per-process fields, using the operating system's process-resource API (not parsing of human-readable command output) as the collection mechanism. The tree total on macOS SHALL be the sum of per-process physical footprints, and SHALL never sum resident-set sizes.

The settle protocol's convergence check SHALL use the tree total on macOS just as it uses the proportional tree total on Linux.

#### Scenario: A macOS run produces per-process samples in the shared result shape

- **WHEN** the harness runs on macOS with the native collector available
- **THEN** the result contains, for each sample and each discovered process, the process's PID, role, physical footprint, and resident size, keyed identically to Linux samples
- **AND** the tree total equals the sum of per-process physical footprints for that sample

#### Scenario: macOS is refused cleanly when the collector is unavailable

- **WHEN** the harness runs on macOS and the native collector binary is absent or not executable
- **THEN** the platform gate reports an unsupported environment naming the missing collector
- **AND** no result file is produced

#### Scenario: Settle convergence uses footprint on macOS

- **WHEN** a macOS stage waits for the settle condition
- **THEN** the three-consecutive-reads convergence check is evaluated against the tree physical-footprint total
- **AND** the settle parameters and the field used are recorded with the run

### Requirement: macOS process discovery excludes unrelated processes

Process discovery on macOS SHALL enumerate the launched instance's processes by walking the process tree from the launched PID via parent-PID relationships, and SHALL classify each process by role (native application, web content, networking, other) from its executable identity. Where the operating system permits reading a candidate's environment, the launch-time run-ID marker SHALL be used as a secondary verification; where it does not, ancestry from the driver-launched root SHALL be the authoritative membership signal and the sample SHALL record that the marker could not be verified.

#### Scenario: An unrelated application's WebContent process is never counted

- **WHEN** another application's WebKit web-content process exists during a macOS run
- **THEN** it is absent from every sample because it is not reachable from the launched PID
- **AND** no name-based matching alone ever admits a process

#### Scenario: A process that exits mid-run is recorded absent

- **WHEN** a discovered process exits between two samples
- **THEN** the later sample records that PID as absent with a reason
- **AND** the sample and the run continue

### Requirement: The environment block is platform-aware

The machine-profile environment recorded with every result SHALL be collected per platform: on macOS the OS version, kernel version, CPU model, total RAM, and WebKit engine (identified by OS version) are recorded, and the profile carries a platform discriminator so a result is never compared against a baseline recorded on a different platform.

#### Scenario: A macOS result carries a complete macOS profile

- **WHEN** a run completes on macOS
- **THEN** the environment block contains the macOS OS version, kernel, CPU model, and total RAM, with Linux-only fields absent rather than null-filled
- **AND** the profile's platform discriminator identifies darwin

#### Scenario: Cross-platform comparison is refused

- **WHEN** a result from one platform is checked against baselines recorded on another
- **THEN** the gate refuses to issue a verdict, names the differing profile fields, and exits as unusable input

### Requirement: The scenario includes an idle-soak stage with periodic sampling

The harness SHALL support an idle-soak stage that holds the application idle for a configured duration and takes samples at a fixed interval throughout, each keyed by elapsed time, in addition to (not instead of) settle-point samples. Soak durations SHALL be configurable through named tiers (a quick tier of minutes, a development tier of tens of minutes, a nightly tier of multiple hours, an extended tier of ten or more hours), with documented defaults, so no ordinary developer run requires an overnight wait while unattended hardware can run one.

#### Scenario: A soak run samples throughout the idle period

- **WHEN** the harness runs a soak stage of duration D with sampling interval I
- **THEN** the result contains approximately D/I soak samples, each keyed by stage and elapsed time
- **AND** the samples are retained even when the run ultimately fails or is marked unreliable

#### Scenario: Tiers select durations without changing the scenario otherwise

- **WHEN** the harness is invoked with a named soak tier
- **THEN** the scenario's non-soak stages, corpus, settle parameters, and result format are identical to an untiered run
- **AND** the chosen tier and duration are recorded in the result's environment block

### Requirement: The scenario includes TTS and audio-edition lifecycle stages

The scenario SHALL include staged cycles for TTS synthesis (synthesize, play, stop, dispose — including both persistent-cache hits and misses) and for audio-edition generation (generate multiple sections, play, cancel mid-generation, delete the edition, retry, and clean up), driven through the same application-level operations the UI uses, without network access to paid providers, and with synthesis volume determined by deterministic fixtures.

#### Scenario: TTS cycles exercise both cache outcomes

- **WHEN** the TTS cycle stage runs for N cycles
- **THEN** it performs a documented, reproducible mix of cache-miss and cache-hit syntheses
- **AND** each cycle completes playback teardown before the next begins

#### Scenario: Edition cycles exercise every lifecycle exit

- **WHEN** the audio-edition cycle stage runs
- **THEN** it completes at least one full generation, one cancellation mid-generation, one deletion of a generated edition, and one retry of a failed section
- **AND** a stage whose synthesis machinery fails exits non-zero rather than emitting a clean result

### Requirement: A failed or growing run leaves attributable artifacts

When a run fails, is marked unreliable, or exceeds slope thresholds, the harness SHALL have retained enough data to attribute the growth the next morning: per-sample per-process values with roles and elapsed time, the environment block, and the in-application resource diagnostics snapshot for stages that support it. The harness SHALL also provide a documented one-command capture of operating-system diagnostic artifacts (process listing, memory-map summary, leak report, sample) for a live reproduction.

#### Scenario: An overnight soak that grows is diagnosable from its artifacts alone

- **WHEN** a soak run's samples show sustained growth or the run fails
- **THEN** the retained artifacts identify which process and role grew, the growth shape over time, and the application-side resource counts at each sample
- **AND** no re-run is required to begin attribution

#### Scenario: Incident recurrence is capturable before the harness exists

- **WHEN** the incident reproduces on a machine without the harness configured
- **THEN** the documented capture command produces a timestamped artifact directory of per-process listings and per-PID memory-map, leak, and sample reports
- **AND** the command requires no application build steps
