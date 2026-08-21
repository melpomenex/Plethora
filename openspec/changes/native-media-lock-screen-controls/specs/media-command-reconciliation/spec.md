# Media Command Reconciliation

## ADDED Requirements

### Requirement: Native commands SHALL use the canonical normalized envelope

Every desktop, Android, headset, notification, lock-screen, and Web Media Session action SHALL enter the existing normalized dispatcher with command, event ID, source, emitted time, and active session/source identity. No platform-specific handler SHALL directly mutate study state or tags.

#### Scenario: Android emits a next command

- **WHEN** the Media3 service receives a next action
- **THEN** it SHALL emit one normalized envelope and the dispatcher SHALL own the resulting transport or Study Mode behavior

#### Scenario: Desktop emits a toggle command

- **WHEN** the desktop bridge receives a toggle event
- **THEN** it SHALL route it through the same dispatcher used by Android and in-app controls

### Requirement: Commands SHALL be durably queued before risky delivery

When the WebView or frontend may be suspended, the native bridge SHALL atomically persist the command before attempting JavaScript delivery. The drain API SHALL normalize the actual `{commands: [...]}` result and MAY accept the legacy array shape for compatibility.

#### Scenario: The WebView is unavailable

- **WHEN** a hardware command arrives while JavaScript cannot receive it
- **THEN** the command SHALL remain in the bounded durable queue for a later drain

#### Scenario: The frontend resumes

- **WHEN** the bridge drains pending commands
- **THEN** it SHALL read the command collection from the response contract and attempt each command in order

### Requirement: Acknowledgement SHALL follow canonical acceptance

The native queue SHALL acknowledge a command only after the frontend has accepted it into the canonical dispatcher or has recognized the same event ID as already applied. A failed or unrecognized command SHALL remain retryable or be marked with an actionable failure state.

#### Scenario: Dispatch succeeds

- **WHEN** the normalized command is accepted
- **THEN** the frontend SHALL acknowledge its event ID and the native queue SHALL remove that record

#### Scenario: Dispatch fails during resume

- **WHEN** the frontend cannot accept the command because no matching session exists
- **THEN** the command SHALL not be silently acknowledged and SHALL be bounded by the stale-session policy

### Requirement: Deduplication SHALL prevent replay without suppressing real rapid seeks

The dispatcher SHALL apply the same event ID at most once. Any fallback duplicate detection SHALL be command-aware and tied to verified duplicate delivery, not a broad time window that collapses legitimate repeated seek commands.

#### Scenario: A native event is delivered twice

- **WHEN** both deliveries have the same stable event ID
- **THEN** the dispatcher SHALL apply the command once and both acknowledgements SHALL be idempotent

#### Scenario: Two real seeks happen quickly

- **WHEN** the user emits two distinct seek-forward events within the normal dedupe interval
- **THEN** both commands SHALL be applied in order

### Requirement: Reconciliation SHALL be session-aware and bounded

On resume or source change, pending commands SHALL be checked against active source/session identity and age. Commands for a different source or beyond the staleness policy SHALL be expired with diagnostics rather than replayed into the new source.

#### Scenario: A queued command belongs to an old audiobook

- **WHEN** the user has since opened a different source
- **THEN** the old command SHALL be discarded or retained for explicit recovery and SHALL not control the new source

#### Scenario: A valid command survives suspension

- **WHEN** a command is recent and matches the active source after resume
- **THEN** it SHALL be dispatched once and reflected in the reconciled native/frontend state

### Requirement: Native and frontend state SHALL reconcile after commands

After draining or accepting commands, the bridge SHALL exchange a current state snapshot containing source identity, position, duration/capabilities, section, rate, and play state. Newer user state SHALL win over stale native snapshots.

#### Scenario: A seek is accepted while the app resumes

- **WHEN** the dispatcher changes position during queue drain
- **THEN** the native session SHALL receive the resulting current snapshot and SHALL not overwrite it with its pre-resume position
