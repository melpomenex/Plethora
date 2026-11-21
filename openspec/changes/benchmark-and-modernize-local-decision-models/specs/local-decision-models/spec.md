## ADDED Requirements

### Requirement: Local decision model downloads enforce pinned revisions and checksums

Hugging Face downloads for `HfRuntime::LayaDecision` SHALL resolve `.safetensors` LFS digests, enforce fail-closed SHA-256 verification, and perform a real representative inference check when probing endpoint readiness.

#### Scenario: Laya health probe validates real inference

- **WHEN** the user tests the Laya decision model connection in Settings
- **THEN** Plethora sends a representative System One inference request rather than checking file existence alone

### Requirement: Local decision model selection is backed by a reproducible benchmark

Plethora SHALL include a documented, versioned DAQE decision benchmark dataset and harness measuring task accuracy, calibration, and latency across deterministic baselines and supported local models.

#### Scenario: Benchmark harness runs deterministically

- **WHEN** the decision model benchmark harness is executed
- **THEN** it outputs measured accuracy, macro-F1, and latency metrics on the documented dataset without fabricating results for unavailable runtimes
