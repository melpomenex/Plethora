## ADDED Requirements

### Requirement: Option-parsing tools receive URLs after end-of-options
Invocations of tools that parse leading-dash arguments (yt-dlp) SHALL validate the URL parses as `http(s)` with a host, SHALL reject strings beginning with `-`, and SHALL place the URL after a `--` end-of-options separator in every argv.

#### Scenario: Option-injection URL is rejected
- **WHEN** a download/info command receives `url = "--exec=touch /tmp/pwned"`
- **THEN** the command rejects the input before spawning any process

#### Scenario: Normal YouTube URL downloads unchanged
- **WHEN** a valid `https://youtube.com/watch?v=...` URL is downloaded
- **THEN** yt-dlp receives it after `--` and the download behaves as before

### Requirement: IPC-configurable executable paths are provenance-checked
Commands that spawn binaries whose paths come from IPC configuration (OCR providers, Ollama runtime, installers) SHALL accept only paths within known install locations or paths recorded by a backend-verified file dialog. Commands that "open" files with the OS handler SHALL accept only files the backend itself produced or downloaded.

#### Scenario: Configured tesseract path outside known locations is refused
- **WHEN** OCR configuration sets `tesseract_path` to an arbitrary user-writable path like `/tmp/evil.sh`
- **THEN** the configuration is rejected with an explanatory error before any spawn

#### Scenario: Installer open is restricted to backend downloads
- **WHEN** the open-installer command is invoked with a path not matching the backend-recorded download location
- **THEN** the open is refused

### Requirement: MCP server additions require confirmation and safe args
Adding an MCP server SHALL require an explicit user confirmation surfaced by the app UI before the first spawn, and the command validator SHALL reject direct-code interpreter arguments (`-e`, `-c`, `--eval` and equivalents).

#### Scenario: Silent MCP registration is blocked
- **WHEN** a webview calls the MCP add-server command without prior user confirmation
- **THEN** the server is registered as pending and no process spawns until the user confirms

#### Scenario: Code-execution interpreter args are rejected
- **WHEN** an MCP server config passes `node -e <code>` or `python -c <code>`
- **THEN** validation rejects the arguments

### Requirement: Output templates are filename-only
User-supplied output templates passed to external tools SHALL be constrained to filename templates (no path separators, no `..`), with the directory component chosen solely by the backend.

#### Scenario: Traversal in output template is rejected
- **WHEN** a download options object carries `output_template` containing `/` or `..`
- **THEN** the command rejects the template
