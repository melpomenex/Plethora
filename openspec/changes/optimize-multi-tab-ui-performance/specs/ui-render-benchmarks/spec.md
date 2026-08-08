## ADDED Requirements

### Requirement: Tab workspace store operations are benchmarked

The system SHALL benchmark the tab workspace's store-level hot paths under the existing anchor-normalized performance gate. The suite SHALL cover, at minimum: activating a tab in a workspace of at least 20 tabs, building the persisted workspace snapshot for that workspace, normalizing a nested split-pane tree at least four levels deep, and the reuse lookup performed when a new tab is opened into a workspace of at least 20 tabs.

These benchmarks SHALL run in the Node environment, SHALL build their workspaces from fixed constants or the shared seeded generator, and SHALL NOT touch `localStorage`, the Tauri bridge, or a DOM.

#### Scenario: Store benchmarks run under the gate

- **WHEN** a developer runs `npm run bench`
- **THEN** the tab workspace store benchmarks execute and report an operations-per-second figure for each named case
- **AND** `npm run bench:check` compares each against its recorded baseline

#### Scenario: Tab activation becomes more expensive

- **WHEN** a change makes activating a tab in a 20-tab workspace cost measurably more than its baseline tolerance allows
- **THEN** `npm run bench:check` exits non-zero and names the activation benchmark

#### Scenario: Store benchmarks are environment-free

- **WHEN** the tab workspace store benchmarks run
- **THEN** they complete without a DOM, without reading or writing persisted storage, and without invoking a Tauri command

### Requirement: Tab workspace render cost is benchmarked in a DOM environment

The system SHALL benchmark React render cost for the tab workspace in a jsdom environment, opted into per file, using placeholder tab content components rather than the application's real tab components. The suite SHALL cover, at minimum: the initial render of a workspace containing at least 12 tabs, switching the active tab within that workspace, and re-rendering that workspace when its tab collection changes identity.

Placeholder content SHALL be used deliberately: the benchmarks measure the workspace's own behavior, which is the part this change controls, and must not be dominated by an individual tab's internals.

The placeholder used for the mount case SHALL carry a mount cost representative of a real tab. A benchmark whose subject is *how many* tabs get mounted is insensitive to that count when each tab is nearly free to mount — its cost is then dominated by root setup and per-tab wrapper elements, which no change to mounting policy affects. The switch and re-render cases SHALL keep trivial content, where the workspace's own reconciliation is the subject.

#### Scenario: The mount benchmark is sensitive to how many tabs mount

- **WHEN** a change alters the number of tab content components mounted for a workspace of a given size
- **THEN** the mount benchmark's measured cost changes correspondingly

#### Scenario: Switch and re-render benchmarks isolate workspace reconciliation

- **WHEN** the switch and re-render benchmarks run
- **THEN** their content components are trivial, so the measurement reflects the workspace container rather than tab internals

#### Scenario: Render benchmarks run under the gate

- **WHEN** a developer runs `npm run bench`
- **THEN** the tab workspace render benchmarks execute in a DOM environment
- **AND** their results are written to the same results file as the Node-environment benchmarks
- **AND** `npm run bench:check` compares each against its recorded baseline

#### Scenario: Render benchmarks tolerate DOM measurement noise

- **WHEN** a render benchmark's baseline is recorded
- **THEN** its entry in the baseline file carries an explicit per-benchmark tolerance wider than the file-level default
- **AND** the entry records the reason for that wider tolerance

#### Scenario: Render benchmarks do not mount real tab content

- **WHEN** the tab workspace render benchmarks run
- **THEN** no application tab component, PDF viewer, graph engine, or data-fetching surface is mounted
- **AND** the measured work is the workspace container's own rendering

### Requirement: Baselines for the new benchmarks are recorded from a CI run

Baselines for every benchmark added by this capability SHALL be recorded in `scripts/perf-baselines.json` from a run on continuous integration, not from a developer machine, and SHALL be recorded after the tab workspace optimizations land rather than against the pre-optimization behavior.

#### Scenario: Baseline provenance

- **WHEN** the new benchmark baselines are committed
- **THEN** the baseline file records which CI run produced them
- **AND** each new entry carries a reason describing what it measures

#### Scenario: Optimization work updates baselines deliberately

- **WHEN** a tab workspace optimization changes a benchmarked path's measured cost
- **THEN** the corresponding baseline entry is updated in the same change
- **AND** the reason field states why the cost moved

### Requirement: Tab switch latency is readable on real hardware

The application SHALL expose a summary of recorded tab-switch latency — at minimum the sample count, median, 95th percentile, and maximum — from the samples already collected when a tab is activated. The summary SHALL be available in development builds without adding an always-on measurement cost to release builds, and SHALL be reachable without attaching an external profiler.

#### Scenario: Reading the tab switch summary

- **WHEN** a developer switches between tabs several times in a development build and requests the tab-switch summary
- **THEN** the summary reports the number of recorded switches with their median, 95th percentile, and maximum durations

#### Scenario: No samples recorded yet

- **WHEN** the summary is requested before any tab switch has been measured
- **THEN** it reports zero samples rather than failing or reporting misleading zeros for the percentiles

#### Scenario: Measurement stays off the release hot path

- **WHEN** the application runs in a release build with tab-switch measurement disabled
- **THEN** activating a tab performs no percentile bookkeeping
- **AND** tab activation behaves exactly as it does without this capability
