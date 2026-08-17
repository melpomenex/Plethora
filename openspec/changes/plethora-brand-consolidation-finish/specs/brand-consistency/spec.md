## ADDED Requirements

### Requirement: Customer-facing surfaces are Plethora-branded
All live user-facing text, window titles, exported-file content, notifications, MCP identity, spoken test sentences, and store/dev manifests SHALL use Plethora branding, and SHALL NOT contain "Incrementum"/"ReadSync" outside the documented compatibility allowlist.

#### Scenario: App surfaces audited
- **WHEN** the brand-inventory test runs
- **THEN** `tauri.linux.conf.json`, PWA components, settings About, TTS test sentences, OPML export title, mnemosyne export filename, article-capture window title, and MCP server/client/tool names are asserted Plethora-branded

#### Scenario: Extension developer surfaces
- **WHEN** a developer reads the extension README, icons README, INSTALL.md, or loads the debug/minimal manifests
- **THEN** all say Plethora, while the shipping manifest's gecko id and protocol tokens remain unchanged

### Requirement: Build tooling references valid artifact names
Build scripts, CI workflows, and packaging files SHALL reference artifact/binary names that the current build actually produces (`plethora.exe`, `plethora-tauri`), and Rust examples SHALL compile against the current crate name.

#### Scenario: Rename breakage fixed
- **WHEN** the Rust test suite (including examples) and release artifact scripts run
- **THEN** `figdiag.rs` compiles against `plethora_tauri_lib`, screenshot window lookup matches "Plethora", backup paths use the shared DB-location helper, and Windows/cross-build scripts copy `plethora.exe`

### Requirement: Retained legacy identifiers are allowlisted with rationale
Legacy identifiers kept for compatibility SHALL be enumerated in the brand-inventory test allowlist with a short rationale, so accidental reintroduction of visible legacy branding fails CI while intentional identifiers pass.

#### Scenario: Allowlist review
- **WHEN** a new occurrence of a legacy name is added to user-facing code
- **THEN** it must either be rebranded or added to the allowlist with rationale; the test fails otherwise
