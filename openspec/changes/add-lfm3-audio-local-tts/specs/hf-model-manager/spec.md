## ADDED Requirements

### Requirement: LFM3 uses a complete verified native audio contract
The HF manager SHALL identify the supported LFM3 backbone/projector pair using a
specific runtime/run contract, immutable revision, required-file hashes and total
download size. Installation SHALL reuse existing progress/cancel/verification
facilities and SHALL NOT publish an incomplete runnable model. Existing model
contracts and identifiers SHALL retain compatibility.

#### Scenario: Install the supported model
- **WHEN** the user downloads the supported LFM3 pair
- **THEN** the manager SHALL verify both files and expose the installation to the LFM3 adapter

#### Scenario: Projector is missing or wrong
- **WHEN** a required LFM3 projector is absent, corrupt or incompatible
- **THEN** installation or activation SHALL fail with a compatibility explanation

### Requirement: Availability and removal reflect actual runtime use
The manager SHALL distinguish model installation from runtime/backend availability
and show licensing/storage information. It SHALL prevent deletion of weights
while native synthesis uses them or unload safely first. Availability SHALL NOT
use a named GPU allowlist or require per-device benchmark certification.

#### Scenario: Uninstall an active model
- **WHEN** removal is requested while LFM3 is loaded or generating
- **THEN** the manager SHALL unload safely or report in-use before deleting files

#### Scenario: Different compatible graphics hardware
- **WHEN** users have compatible hardware other than the development device
- **THEN** runtime detection SHALL determine availability without rejecting the GPU model name
