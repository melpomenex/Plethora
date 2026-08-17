## ADDED Requirements

### Requirement: Status endpoints expose booleans only
Debug/status endpoints on serverless functions SHALL NOT reflect credential-bearing values or internal infrastructure URLs. Configuration presence SHALL be reported as booleans.

#### Scenario: Status endpoint leaks nothing
- **WHEN** any unauthenticated caller requests the transcript function's status endpoint
- **THEN** the response contains only boolean indicators (proxy configured, cookies received, VPS configured) and no URL fragments, proxy previews, or credential material

### Requirement: Secrets are not returned to the webview over IPC
IPC commands SHALL NOT return stored secrets in plaintext to the webview. Commands that need a key for an outbound call SHALL read it backend-side from stored configuration; the webview passes an opaque provider reference. Where a value must be displayed, a masked preview SHALL be returned.

#### Scenario: Automation key is masked over IPC
- **WHEN** a webview invokes the automation-key IPC command
- **THEN** only a masked preview (e.g. `inc_****abcd`) is returned; the full key never crosses IPC

#### Scenario: Groq transcription no longer transits the key through the frontend
- **WHEN** podcast transcription runs
- **THEN** the command receives a provider reference, reads the key backend-side, and the key never appears in IPC arguments

### Requirement: Keychain reads respect the masked-preview contract
When keychain integration is enabled, secret retrieval commands SHALL return masked previews only; full values are used exclusively inside backend call paths.

#### Scenario: Keychain-backed key cannot be harvested via IPC
- **WHEN** a webview invokes the keychain-get command for a stored provider key
- **THEN** the response contains a masked preview, not the credential

### Requirement: Auth tokens are generated with a CSPRNG
Client- or server-generated tokens used for authentication toward local services SHALL be produced by a cryptographically secure random source (`crypto.getRandomValues`/`OsRng`), not `Math.random` or timestamp composition.

#### Scenario: Automation key entropy source
- **WHEN** an automation key is generated anywhere in the codebase
- **THEN** it derives from a CSPRNG (verified by code inspection/test hook) and contains no time-derived component
