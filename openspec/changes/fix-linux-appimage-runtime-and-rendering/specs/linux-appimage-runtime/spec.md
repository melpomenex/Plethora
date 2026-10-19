## Purpose

Provide a predictable Linux AppImage runtime for host subprocesses, GStreamer media discovery, and local packaging validation without compromising isolated bundled Python runtimes or user data.

## ADDED Requirements

### Requirement: Host Python environment isolation
The Linux AppImage SHALL prevent launcher-injected Python paths that do not contain a Python standard library from reaching host system subprocesses. Python paths required by an explicitly selected bundled or managed runtime SHALL be applied only to that runtime's commands.

#### Scenario: System Python starts from AppImage
- **WHEN** a Linux AppImage command launches host `python3` with AppImage-provided `PYTHONHOME` or `PYTHONPATH` pointing to an incomplete runtime
- **THEN** those invalid values are removed before the child starts and `python3 -c 'import encodings'` succeeds when the host interpreter is available

#### Scenario: GStreamer starts its plugin scanner
- **WHEN** GStreamer spawns a plugin scanner while the AppImage is running
- **THEN** the scanner inherits no invalid AppImage Python paths, and Python-based plugin helpers do not fail during interpreter initialization

#### Scenario: Bundled Python integration runs
- **WHEN** NotebookLM, Pocket TTS, or Chatterbox selects its bundled or managed Python runtime
- **THEN** the selected command receives only that runtime's required Python environment and remains functional

### Requirement: Persistent user-scoped GStreamer registry
The AppImage SHALL use a writable persistent GStreamer registry scoped to the current user and a stable XDG cache location. It SHALL permit normal registry refresh when discovered plugins change and SHALL fall back safely when the preferred cache location is unavailable.

#### Scenario: First launch builds registry
- **WHEN** Plethora launches with no existing registry
- **THEN** GStreamer creates a writable registry under the user's cache hierarchy and plugin discovery completes without targeting `/dev/null`

#### Scenario: Warm launch reuses registry
- **WHEN** Plethora launches again with an unchanged runtime and plugin set
- **THEN** GStreamer reuses the persistent registry rather than rescanning every plugin solely because of Plethora configuration

#### Scenario: AppImage mount path changes
- **WHEN** an unchanged AppImage is launched again from a different temporary mount path
- **THEN** the bundled plugin identity presented to GStreamer remains stable enough for the persistent registry to reuse its cached metadata

#### Scenario: Plugin set changes
- **WHEN** a bundled or host plugin is added, removed, upgraded, or becomes incompatible
- **THEN** GStreamer may refresh affected registry entries and does not keep stale plugin metadata indefinitely

#### Scenario: Cache directory is unavailable
- **WHEN** the preferred cache path cannot be created or written
- **THEN** Plethora uses an available GStreamer-managed fallback or reports the cache fallback concisely while preserving application startup

### Requirement: GStreamer plugin ABI and media integrity
The Linux AppImage SHALL load only GStreamer plugins compatible with the runtime-selected GStreamer core, and SHALL retain supported audio, video, and YouTube playback capabilities.

#### Scenario: Packaged plugins match runtime core
- **WHEN** a packaged AppImage is inspected on its build host
- **THEN** its plugin discovery paths do not mix incompatible core/plugin ABIs or silently rely on duplicate plugin copies

#### Scenario: Host provides additional compatible plugins
- **WHEN** the AppImage supplements bundled plugins with host plugins
- **THEN** only paths compatible with the active GStreamer core are exposed and plugin load failures remain diagnosable

#### Scenario: Supported media is played
- **WHEN** a user plays supported audio or video, including a supported YouTube stream
- **THEN** the required decoders, demuxers, conversion elements, and audio/video sinks remain discoverable

### Requirement: AppImage packaging integrity
The local Linux AppImage workflow SHALL produce a separately testable artifact containing the configured application binary, required sidecars, bundled runtime resources, and required media plugins. A failed or partial build SHALL fail visibly rather than silently omitting required assets.

#### Scenario: Required sidecar is missing
- **WHEN** an AppImage build cannot resolve a required sidecar or runtime asset
- **THEN** the build reports the missing asset and exits unsuccessfully

#### Scenario: Local test artifact is produced
- **WHEN** the supported Linux AppImage build command succeeds
- **THEN** it reports the exact artifact path and leaves any separately installed `/opt/plethora/Plethora.AppImage` untouched

### Requirement: Opt-in Linux runtime diagnostics
Plethora SHALL provide concise startup diagnostics for the Linux runtime and an opt-in verbose mode for runtime investigation. Diagnostics SHALL distinguish Plethora-configured environment from host/runtime observations and SHALL exclude credentials and user content.

#### Scenario: Normal startup
- **WHEN** Plethora starts without verbose diagnostics enabled
- **THEN** startup logging records the AppImage or unpackaged runtime, GStreamer registry location, and whether invalid inherited Python paths were sanitized using concise non-sensitive output

#### Scenario: Verbose runtime inspection
- **WHEN** a developer explicitly enables Linux runtime diagnostics
- **THEN** the diagnostic output includes selected plugin search paths, relevant Python environment policy, scanner activity or timing where observable, and process/runtime measurements without recording credentials or user content
