## Purpose

Defines the reproducible memory benchmark: a fixed scenario driven against a real running instance of the application, and the process-memory accounting that turns each stage into comparable numbers, so memory claims rest on measurement rather than manual observation.

## ADDED Requirements

### Requirement: The harness drives a fixed, ordered scenario

The harness SHALL launch the application, drive it through a fixed ordered sequence of stages, and record a memory sample at each stage. The sequence SHALL include, at minimum: fresh idle after launch, one document open, two document tabs open, four document tabs open, all tabs closed, repeated open/close cycles of a single document, repeated open/close cycles across multiple documents, and a final idle state after the cycles.

The scenario SHALL be driven through explicit application-level operations rather than by synthesizing coordinate-based input, so that a run is deterministic and does not depend on window geometry, theme, or animation timing. The number of repeated cycles SHALL be configurable, with a documented default.

#### Scenario: Full scenario runs unattended

- **WHEN** the harness is invoked
- **THEN** it launches the application, performs every stage in order without manual intervention, and terminates the application
- **AND** it emits one sample per stage plus one per repeated cycle

#### Scenario: Two runs of the same build measure the same work

- **WHEN** the harness is run twice against the same build with the same corpus and cycle count
- **THEN** both runs perform an identical sequence of operations on identical documents
- **AND** the reported values differ only by measurement variance

#### Scenario: A stage that cannot complete fails the run

- **WHEN** a document fails to open, a tab fails to close, or the application exits unexpectedly during a stage
- **THEN** the harness reports which stage failed and why
- **AND** it exits with a non-zero status rather than emitting a partial result that could be mistaken for a passing measurement

### Requirement: Samples are taken at stabilization points

Each sample SHALL be taken after the application has reached a defined settle condition for that stage, not immediately after the triggering operation. The settle condition SHALL be applied identically at every stage and SHALL be recorded in the results so that two runs can be compared knowing they settled the same way.

#### Scenario: Sampling waits for the settle condition

- **WHEN** a stage's operations complete
- **THEN** the harness waits for the stage's settle condition before reading memory
- **AND** the settle parameters used are recorded alongside the sample

#### Scenario: Settle timeout is reported, not silently ignored

- **WHEN** a stage does not reach its settle condition within the configured timeout
- **THEN** the harness records that the sample was taken after a settle timeout
- **AND** the run is marked as unreliable rather than reported as a clean measurement

### Requirement: Memory is collected per process and for the whole process tree

On Linux, each sample SHALL read `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, and `Swap` from `/proc/<pid>/smaps_rollup` for every process belonging to the launched instance. Values SHALL be reported separately for the native application process, the web content process or processes, the network process, and any other child process, together with a tree total. The tree total SHALL be the sum of the per-process proportional values, not a sum of resident-set sizes.

A process that exits between discovery and sampling SHALL be recorded as absent rather than causing the run to fail.

#### Scenario: Per-process and total values are reported

- **WHEN** a sample is taken
- **THEN** the result contains a per-process entry for the native process, each web content process, and the network process, each with all collected fields
- **AND** it contains a tree total computed from the proportional values

#### Scenario: Missing rollup data is attributed

- **WHEN** a process's rollup file cannot be read because the process exited
- **THEN** the sample records that process as absent with the reason
- **AND** the remaining processes are still sampled

#### Scenario: Rollup parsing is exact

- **WHEN** a rollup file is parsed
- **THEN** each field is read from its labelled line with its unit, and unrecognized or absent fields are reported as absent rather than defaulted to zero
- **AND** a malformed file produces an attributed error rather than a plausible-looking number

### Requirement: Process discovery is scoped to the launched instance

Discovery SHALL include only processes belonging to the instance the harness launched. It SHALL identify them by their relationship to the launched process — its process group and descendants — combined with a launch-time marker that the harness sets in the launched process's environment and verifies on each candidate. A process that does not carry the marker SHALL NOT be counted, even if it is a web content process of the same engine.

Discovery SHALL be re-evaluated at every sample so that processes started or stopped mid-scenario are accounted for.

#### Scenario: Another application's engine processes are excluded

- **WHEN** an unrelated application with web content processes of the same engine is running during the benchmark
- **THEN** none of its processes appear in any sample
- **AND** the tree total reflects only the launched instance

#### Scenario: A reparented child is still counted

- **WHEN** a child process of the launched instance is reparented away from the launched process
- **THEN** it is still discovered through the launch marker
- **AND** it appears in the sample with its role identified

#### Scenario: Processes appearing mid-scenario are counted

- **WHEN** a process is spawned by the instance after the first sample
- **THEN** it appears in every subsequent sample
- **AND** its absence from earlier samples is not treated as an error

### Requirement: The benchmark corpus is fixed and reproducible

The scenario SHALL use a fixed corpus covering at minimum one representative PDF and one representative EPUB, plus any additional content type shown by investigation to have its own large-memory path. Each corpus item SHALL be identified by a recorded content hash. The harness SHALL verify each item's hash before running and SHALL refuse to run against a corpus that does not match, rather than producing numbers that cannot be compared to the baseline.

Corpus files SHALL NOT be committed as binaries to the repository; the harness SHALL provision them reproducibly and record how.

#### Scenario: Corpus mismatch stops the run

- **WHEN** a corpus item's content hash does not match the recorded hash
- **THEN** the harness refuses to run and names the item and both hashes
- **AND** it exits with a non-zero status

#### Scenario: Missing corpus is provisioned or explained

- **WHEN** the corpus is not present locally
- **THEN** the harness either provisions it reproducibly or reports the exact command to provision it
- **AND** it does not silently substitute a different document

### Requirement: Results are machine-readable and carry their environment

The harness SHALL write a machine-readable result file containing every sample, keyed by stage and cycle, together with the environment that materially affects the numbers: operating system and kernel version, web engine version, application version and build profile, CPU model, total system memory, display server, cycle count, corpus identity, and the settle parameters used. The result file SHALL also record whether the run was marked unreliable.

#### Scenario: Results can be compared without the original terminal output

- **WHEN** a result file from one machine is compared with one from another
- **THEN** every recorded environment field needed to judge comparability is present in both
- **AND** each sample can be matched to its stage and cycle index

#### Scenario: An unreliable run is machine-detectable

- **WHEN** a run hit a settle timeout or recorded an absent process at a gated stage
- **THEN** the result file marks the run unreliable with the reason
- **AND** a consumer can reject it without parsing prose

### Requirement: Unsupported platforms are reported, not approximated

The harness SHALL treat process-memory collection as platform-specific. On a platform for which no collector is implemented, it SHALL report that memory measurement is unsupported and exit without producing samples. It SHALL NOT substitute a different metric or emit values that would be compared against a baseline recorded on another platform.

#### Scenario: Running on an unsupported platform

- **WHEN** the harness is invoked on a platform with no memory collector
- **THEN** it reports that the platform is unsupported and names what would be required to support it
- **AND** it produces no result file that a gate could consume

#### Scenario: Baselines are not compared across platforms

- **WHEN** a result file recorded on one platform is compared against a baseline recorded on another
- **THEN** the mismatch is detected and reported
- **AND** no pass or fail verdict is issued from the mismatched comparison
