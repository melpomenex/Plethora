## ADDED Requirements

### Requirement: Fresh device shows import and generate actions
On a device with no stored sync master key, the Cloud Storage settings panel SHALL display both **Generate Key** and **Import Key** actions in the Sync Master Recovery Key section.

#### Scenario: Fresh install with no master key
- **WHEN** the user opens Settings → Cloud Storage on a device where `sync_has_master_key` is false
- **THEN** both Generate Key and Import Key buttons are visible and enabled

#### Scenario: Import form expands on demand
- **WHEN** the user clicks Import Key on a device with no master key
- **THEN** a paste field and confirm action appear for entering a 64-character hexadecimal recovery key

### Requirement: Additional device imports shared recovery key
A device joining an existing sync setup SHALL accept the recovery key generated on the primary device and derive the same master encryption key.

#### Scenario: Successful key import
- **WHEN** the user pastes a valid 64-hex recovery key from another device and confirms import
- **THEN** the key is stored via `sync_store_recovery_key`, acknowledgement is recorded, and the UI transitions to a configured state

#### Scenario: Invalid key rejected
- **WHEN** the user submits a recovery key that is not exactly 64 hexadecimal characters after normalization
- **THEN** the import is rejected with a clear validation error and the import form remains open

### Requirement: UI never hides import when no master key exists
The settings UI SHALL NOT show a disabled-only "Recovery Key Configured" state unless a master key is actually present in secure storage.

#### Scenario: Stale acknowledgement without master key
- **WHEN** `recovery_key_acknowledged` is true in secure storage but `sync_has_master_key` is false
- **THEN** the UI treats the device as unconfigured and shows Generate Key and Import Key actions

#### Scenario: Configured device shows locked state
- **WHEN** `sync_has_master_key` is true and the recovery key has been acknowledged
- **THEN** the UI shows Recovery Key Configured and does not offer generate or import actions

### Requirement: Recovery key actions remain visible on narrow viewports
The Sync Master Recovery Key section SHALL remain usable on tablet and mobile widths without clipping action buttons.

#### Scenario: Narrow viewport layout
- **WHEN** the Cloud Storage settings panel is rendered at a viewport width below the desktop breakpoint
- **THEN** Generate Key and Import Key actions remain visible and tappable without horizontal overflow or off-screen clipping

### Requirement: First-device vs additional-device guidance
The Cloud Storage sync section SHALL explain that only the first device generates a key and all additional devices must import the same key.

#### Scenario: Unconfigured device guidance
- **WHEN** no master key is configured
- **THEN** inline help text states that the first device generates the key and every additional device must import that same key
