# Scheduler Identity

## Requirements

### REQ-SI-001 Canonical scheduler ids
The system SHALL use only these persisted scheduler identifiers in application logic: `fsrs`, `adaptive`, `precision`, `classic`, `classic_5`, `classic_8`, `classic_15`.

### REQ-SI-002 Compatibility boundary
Legacy scheduler strings (legacy adaptive id, legacy precision id, legacy classic ids) SHALL be recognized only in `scheduler_identity` modules and normalized immediately on deserialize.

### REQ-SI-003 Arena model ids
Algorithm Arena competitors SHALL use canonical ids `m1` through `m5`, mapping to Classic, Classic 15, Classic 19, Precision kernel, and FSRS respectively.

### REQ-SI-004 Legacy arena deserialization
Persisted arena payloads containing legacy competitor ids SHALL deserialize to the corresponding `m1`–`m5` values without changing scheduling output.

### REQ-SI-005 No algorithm change
Renaming identifiers SHALL NOT alter interval calculations, stability updates, arena weights, or review outcomes for equivalent state and grade inputs.
