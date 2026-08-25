## ADDED Requirements

### Requirement: Windows intelligence plugin commands
The `plethora-windows-intelligence` plugin SHALL implement typed Tauri commands for capabilities, language model generation (sync + stream), cancellation, warmup, and OCR status.

#### Scenario: Compile on non-Windows CI
- **GIVEN** a macOS or Linux CI runner
- **WHEN** `cargo check` runs for the workspace
- **THEN** the plugin compiles with stub implementations
- **AND** does not link Windows App SDK

### Requirement: Experimental APIs isolated
Production release builds SHALL NOT reference `Microsoft.Windows.AI.Text.Experimental` namespaces unless `windowsAiExperimental` feature flag and non-Store dev configuration are both active.

#### Scenario: Default release build
- **WHEN** production Windows binary is built
- **THEN** no experimental Windows App SDK package is a required dependency
- **AND** Store publication is not blocked by experimental API usage

### Requirement: OCR capability probe
The plugin SHALL report OCR readiness separately from language model readiness.

#### Scenario: OCR on non-Copilot PC
- **GIVEN** Windows 11 without Copilot+ NPU
- **WHEN** OCR status is queried
- **THEN** OCR reports unavailable with hardware-appropriate reason
- **AND** existing Tesseract/cloud OCR paths remain available
