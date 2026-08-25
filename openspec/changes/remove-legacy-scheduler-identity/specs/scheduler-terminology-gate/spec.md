# Scheduler Terminology Gate

## Requirements

### REQ-STG-001 Repository scan
A maintained-source scan SHALL fail CI when forbidden legacy third-party scheduler terminology appears outside documented exemption paths.

### REQ-STG-002 Forbidden patterns
The scan SHALL detect case-insensitively: legacy third-party product names, legacy numeric scheduler suffix tokens (s-m-2 through s-m-20 style), and standalone legacy id tokens (word-boundary aware).

### REQ-STG-003 Scan roots
The scan SHALL cover at minimum: `src/`, `src-tauri/src/`, `docs/`, `website/`, `openspec/`, `scripts/`, `tests/`.

### REQ-STG-004 Exemptions
Compatibility boundary files, historical migration SQL, vendored third-party code, and `ipc_compat` legacy invoke aliases MAY contain literal legacy strings and SHALL be listed in the gate script's exemption manifest.
