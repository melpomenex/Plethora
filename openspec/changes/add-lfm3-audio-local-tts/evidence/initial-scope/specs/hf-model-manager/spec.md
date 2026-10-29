## ADDED Requirements

### Requirement: LFM3 installation requires a complete immutable audio contract
For LFM3 the model manager SHALL identify a validated backbone/projector pair, exact repository commit, per-file hashes, quantization variant and compatible runtime contract. Generic GGUF files or a model tag SHALL NOT establish audio compatibility. Installation SHALL be unavailable without a validated runtime for the target, and operational readiness SHALL require a successful complete audio-pipeline probe. Existing non-LFM3 contracts and IDs SHALL retain compatibility.

#### Scenario: Supported complete artifact pair
- **WHEN** inspection finds the supported LFM3 backbone and matching projector at a pinned commit with integrity metadata and a validated local runtime
- **THEN** the manager SHALL expose their combined size, quantizations and compatibility and offer installation

#### Scenario: Wrong or incomplete audio dependency
- **WHEN** the projector is missing, mismatched, lacks required codec/depth components or belongs to another revision/architecture
- **THEN** installation or operational activation SHALL fail closed with the specific compatibility reason

#### Scenario: Mutable ref changes after inspection
- **WHEN** a branch such as main moves between inspection and download
- **THEN** installation SHALL use the inspected immutable commit or require reinspection, never silently mix files from moving revisions

### Requirement: LFM3 variants have separate safe installation identities
Different validated LFM3 quantization/artifact variants at the same repository revision SHALL have distinct registry/storage identities. Reinstalling the same identity SHALL not duplicate weights. Removing one variant SHALL NOT remove another variant or alter legacy installation identities.

#### Scenario: Two quantizations at one revision
- **WHEN** a second supported LFM3 quantization is installed at the same revision
- **THEN** its contract and storage SHALL remain distinct and each SHALL be removable without affecting the other

#### Scenario: Existing sherpa model is loaded after upgrade
- **WHEN** a pre-existing sherpa or transcription model row is read
- **THEN** its ID, file resolution and serialized run contract SHALL retain their prior meaning

### Requirement: Multi-file LFM3 installation publishes atomically
The manager SHALL reuse verified download/progress/cancellation/retry facilities and publish an LFM3 installation only after all required files and notices are verified. It SHALL preflight remaining download/staging/runtime space, reject unsafe paths and preserve a previous installation during failed updates. Partial/corrupt assets SHALL NOT appear installed.

#### Scenario: Cancel after backbone completes
- **WHEN** a user cancels before the required projector has verified
- **THEN** no usable LFM3 installation SHALL be registered and unpublished partial files SHALL be cleaned according to the download policy

#### Scenario: Hash mismatch or disk exhaustion
- **WHEN** any required artifact fails integrity or the volume fills during installation
- **THEN** the installation SHALL fail with an actionable error, preserve any prior valid install and offer safe retry

### Requirement: Hardware suitability reflects the full LFM3 backend
Suitability SHALL consider backbone, projector/codec, native working state, compute buffers, app/OS reserve, disk and the effective backend. General GPU detection or fitting weights SHALL NOT imply a working LFM3 pipeline. Unknown or insufficient resources SHALL be disclosed; successful real-model probes and workflow measurements SHALL determine ready versus edition-only classification.

#### Scenario: CUDA hardware but incompatible runtime
- **WHEN** NVIDIA hardware is detected but the installed LFM3 runtime cannot execute the full audio pipeline
- **THEN** the manager SHALL show the backend incompatibility instead of marking CUDA ready

#### Scenario: Unified memory pressure
- **WHEN** an Apple Silicon device lacks the measured working-set budget plus required reserve
- **THEN** the system SHALL warn or block loading without counting shared RAM as separate available RAM and VRAM

### Requirement: Model removal and upgrades respect active work
An LFM3 installation used by loading/inference or active generation SHALL be leased. Uninstallation SHALL require work to pause/cancel and unload before files are removed. Existing generated audio SHALL remain playable without the model. Resumption SHALL require the original compatible model/configuration. Runtime upgrades SHALL recheck contracts without deleting valid audio.

#### Scenario: Uninstall during inference
- **WHEN** the user attempts to remove an active LFM3 model
- **THEN** the manager SHALL report it in use and offer a safe pause/unload path before deletion

#### Scenario: Reopen unfinished edition without weights
- **WHEN** a model was uninstalled after some edition sections completed
- **THEN** completed audio SHALL remain playable and unfinished generation SHALL wait for the exact required installation
