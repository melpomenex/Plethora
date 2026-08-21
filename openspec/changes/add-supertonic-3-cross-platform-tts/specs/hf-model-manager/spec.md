## MODIFIED Requirements

### Requirement: Runtime-compatibility determination
The system SHALL determine whether a repo plausibly contains a model compatible with
one of Plethora's supported speech runtimes, based on a per-runtime adapter. Supported
at minimum: ggml `.bin` for whisper.cpp STT; ONNX (`model.onnx`/`model.int8.onnx` +
`tokens.txt`/`tokens.json`, optionally `voices.bin`) for sherpa-onnx STT and the
VITS/Kokoro/Kitten sherpa TTS families; and the Supertonic multi-file ONNX pipeline
(`duration_predictor*.onnx`, `text_encoder*.onnx`, `vector_estimator*.onnx`,
`vocoder*.onnx`, `tts.json`, `unicode_indexer.bin`, `voice.bin` with a consistent
precision suffix) for the Supertonic sherpa TTS family. TTS models SHALL carry a
family classification beneath the sherpa-onnx TTS runtime rather than a separate
top-level runtime. The adapter architecture SHALL allow new runtimes and families to
be added without rewriting the manager. A repo tagged "TTS/STT" that matches no
supported architecture/artifact SHALL be reported as `unsupported_runtime` and SHALL
NOT be claimed as installable.

#### Scenario: Compatible repo identified
- **WHEN** a repo contains a supported artifact (e.g. a `ggml-*.bin` for whisper.cpp,
  an ONNX + tokens file for sherpa, or the complete Supertonic file set)
- **THEN** the system SHALL mark the model as compatible with the matching runtime and
  family/adapter

#### Scenario: Canonical Supertonic repo recognized
- **WHEN** the user inspects `csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11`
- **THEN** inspection SHALL report a sherpa-onnx TTS artifact with family Supertonic,
  INT8 precision, the complete required asset list, download size, and an executable
  run contract

#### Scenario: Unsupported repo rejected
- **WHEN** a repo is tagged TTS/STT but contains no artifact matching any installed
  Plethora speech runtime (e.g. only PyTorch `.bin` checkpoints, safetensors, or the
  upstream fp32 `onnx/` + `voice_styles/*.json` Supertone layout)
- **THEN** the system SHALL classify it `unsupported_runtime` with an explanation, and
  installation SHALL be blocked

### Requirement: Installed model is registered and selectable
After installation the model SHALL be registered with Plethora and SHALL become
available in the appropriate TTS or STT model picker (e.g. `AudioTranscriptionSettings`
default-model select for STT; the TTS provider/model surface for TTS). Installed TTS
models SHALL be usable for synthesis on any platform whose build includes a
TTS-capable runtime for their family, and SHALL be reported as registered-but-runnable
or not-runnable — with an explanation — on builds that lack the runtime. Installation
state SHALL be device-local; model selection preferences MAY sync while installed
files do not.

#### Scenario: STT model selectable
- **WHEN** an STT model is installed
- **THEN** it SHALL appear in the STT model picker and SHALL be usable for local
  transcription

#### Scenario: TTS model selectable and runnable
- **WHEN** a TTS model is installed through a supported TTS runtime on a platform with
  a TTS-capable build
- **THEN** it SHALL appear in the TTS model surface and SHALL be usable for synthesis

## ADDED Requirements

### Requirement: Conservative Supertonic artifact detection
The system SHALL detect a Supertonic artifact only when the complete required file set
is present with a consistent precision suffix across all four ONNX files: the duration
predictor, text encoder, vector estimator, and vocoder ONNX models, plus `tts.json`,
`unicode_indexer.bin`, and `voice.bin`. Detection SHALL report family, precision,
required assets, download size, estimated memory use, and an executable run contract;
it SHALL prefer INT8 when multiple precision sets exist; and it SHALL reject
incomplete sets, mixed-precision sets, and arbitrary multi-ONNX repositories that
happen to contain several `.onnx` files. The existing unsupported-repository behavior
SHALL remain for genuinely unsupported repositories.

#### Scenario: Exact detection on the canonical repo
- **WHEN** the canonical INT8 Supertonic export is inspected
- **THEN** the artifact is reported with family Supertonic, INT8 precision, all seven
  required assets, correct total size, and confidence `exact`

#### Scenario: Missing required file rejected
- **WHEN** any one of the seven required files is absent
- **THEN** no Supertonic artifact is detected and the repo is not installable as
  Supertonic

#### Scenario: Mixed precision rejected
- **WHEN** the four ONNX files use inconsistent precision suffixes
- **THEN** no Supertonic artifact is detected

#### Scenario: Arbitrary multi-ONNX repo not misclassified
- **WHEN** a repo contains several unrelated `.onnx` files without the Supertonic
  metadata files
- **THEN** it SHALL NOT be detected as Supertonic

### Requirement: Family-aware TTS run contracts with backward compatibility
TTS run contracts SHALL record the sherpa TTS family and the family-specific file set
(including all Supertonic pipeline files) so the correct engine configuration can be
constructed without accumulating ambiguous optional fields. New contract fields SHALL
be serialized with defaults such that previously persisted contracts and installed
models continue to load and run unchanged; legacy TTS rows without a family SHALL be
inferred (voices file present → Kokoro, otherwise VITS). Contract file paths SHALL be
validated (family ↔ required files consistent) before installation and before engine
use, and SHALL be subject to the same path-containment protections as existing
contracts.

#### Scenario: Existing installed models keep working
- **WHEN** Plethora upgrades with previously installed VITS/Kokoro models on disk
- **THEN** their registry rows load, their families are inferred, and they remain
  selectable and runnable

#### Scenario: Supertonic contract is complete
- **WHEN** a Supertonic artifact is installed
- **THEN** its contract references every required pipeline file, and engine
  configuration can be built from the contract alone

### Requirement: Multi-asset installation integrity
Installation of a Supertonic artifact SHALL download, verify, and register every
required asset as one unit: SHA-256 verification SHALL be required for every model
file before registration, a failed or cancelled download SHALL leave no partial
installation, uninstall SHALL remove the complete asset set, and the installed
directory SHALL remain revision-pinned so upstream repository changes never mutate a
working installation.

#### Scenario: All assets installed atomically
- **WHEN** a Supertonic install completes
- **THEN** every required file exists on disk with verified integrity and a single
  registry row describes the whole set

#### Scenario: Failed download leaves nothing behind
- **WHEN** a download fails or is cancelled mid-install
- **THEN** partial files are cleaned up, nothing is registered, and a retry starts
  cleanly

#### Scenario: Uninstall reclaims the full set
- **WHEN** the user removes an installed Supertonic model
- **THEN** all installed files are deleted and the space is reclaimed
