## Purpose

On-device Nemotron 3.5 speech-to-text running through the bundled sherpa-onnx streaming runtime: how the model artifact is pinned and installed, how the online sidecar is provisioned and invoked for batch file transcription, and how users move from the dead-end GGUF artifact to a working local model.

## ADDED Requirements

### Requirement: Local Nemotron transcription SHALL run on-device
When the local Nemotron model is installed and the streaming sherpa sidecar is usable, a transcription job routed to the Nemotron logical model id SHALL execute inference locally via the bundled sherpa-onnx streaming runtime — no network access, no cloud provider, no "runtime unavailable" stub error. The result SHALL include segment text with start/end timestamps, and job progress SHALL be reported while chunks process.

#### Scenario: Podcast episode transcribed locally
- **WHEN** the user transcribes a podcast episode with the Nemotron model installed and the desktop app has the streaming sidecar
- **THEN** transcription completes on-device, produces timestamped segments, and reports progress — with no cloud request made

#### Scenario: Missing sidecar reports an actionable error
- **WHEN** the Nemotron model is installed but the streaming sidecar binary is missing or is a placeholder
- **THEN** the job SHALL fail with an actionable sidecar-unavailable error naming the binary, and the model SHALL NOT be reported as usable

### Requirement: The pinned Nemotron artifact SHALL be the official ONNX export
The installable local Nemotron model SHALL be the official sherpa-onnx export of NVIDIA Nemotron 3.5 ASR streaming 0.6B (int8), consisting of the split transducer file set — encoder, decoder, joiner, and tokens — downloaded from its published Hugging Face repository. Every artifact file SHALL be integrity-pinned by SHA-256 and fail closed on mismatch (same policy as other sherpa-runtime models).

#### Scenario: Install downloads the full file set
- **WHEN** the user installs the local Nemotron model
- **THEN** all four files are downloaded, hash-verified, and registered as one model, and the entry reports the combined download size

#### Scenario: Hash mismatch fails closed
- **WHEN** any downloaded file's SHA-256 does not match its pinned value
- **THEN** the install fails, partial files are cleaned up, and no model is registered

### Requirement: The streaming sidecar SHALL be provisioned and verified
The sherpa-onnx streaming (online) binary SHALL be provisioned from the official prebuilt tarballs for every desktop platform, at a sherpa-onnx version that supports the Nemotron streaming transducer, alongside the existing offline binary. Packaging checks (bundle verification, placeholder seeding, code signing/rpath handling) SHALL cover the streaming binary exactly like the existing sidecars, and a stale or wrong-version provision SHALL be re-provisioned automatically.

#### Scenario: Fresh clone build
- **WHEN** the app is built on a machine without provisioned sidecars
- **THEN** the provisioning step downloads the sherpa-onnx release, installs both the offline and streaming binaries with their runtime libraries, and the build succeeds

#### Scenario: Packaged bundle verification
- **WHEN** release bundle verification runs
- **THEN** the streaming binary is present, executable, and loadable (libraries resolve) in the bundle, and verification fails the build otherwise

### Requirement: Existing GGUF installs SHALL be migrated honestly
Users who previously downloaded the GGUF artifact SHALL NOT have it silently treated as the current model: the model entry SHALL show not-installed until the ONNX set is downloaded, and the stale GGUF install SHALL be surfaced with an explicit uninstall/cleanup affordance (reclaiming disk space) rather than left as invisible dead weight.

#### Scenario: Stale GGUF after update
- **WHEN** the app updates on a machine with the old GGUF installed
- **THEN** the Nemotron entry offers the ONNX download, and the leftover GGUF appears as a removable legacy entry until the user cleans it up

### Requirement: Local availability SHALL gate routing truthfully
Prefer-local routing SHALL choose local Nemotron only when the model is installed AND the streaming sidecar is usable on the platform; otherwise it SHALL fall back per the existing resolution rules (cloud OpenRouter Nemotron substitution) instead of routing jobs into a guaranteed failure.

#### Scenario: Model installed but sidecar unusable
- **WHEN** the ONNX model is installed but the streaming binary is missing
- **THEN** transcription requests resolve away from local Nemotron (cloud substitute or an explicit actionable error), never to a local-runtime-unavailable dead end
