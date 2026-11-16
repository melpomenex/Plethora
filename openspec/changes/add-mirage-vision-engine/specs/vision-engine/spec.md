## ADDED Requirements

### Requirement: Dynamic Cactus FFI & Lazy Model Lifecycle
The system SHALL integrate Cactus Compute's native C engine (`cactus_load`, `cactus_describe`) via runtime dynamic loading (`libloading`) in the Tauri v2 backend with no build-time link dependency. Model weights (`mirage.cact`) SHALL load lazily on first inference, cache locally in the app models directory on demand, and execute behind a thread-safe inference queue.

#### Scenario: Missing native library or model degrades gracefully
- **WHEN** `libcactus` or `mirage.cact` is not present on the device
- **THEN** `mirage_status` reports `available: false` with a clear setup/download reason and `cargo check` / app startup succeed without error

#### Scenario: Raw RGB inference with normalized coordinates
- **WHEN** a caller submits a raw RGB pixel buffer with `sections` (`scene`, `objects`, `text`, `relations`), `conf`, `text_conf`, and `mask_format="polygons"`
- **THEN** `MirageEngine` executes inference offline on-device and returns structured detections in `0–1000` normalized coordinates
