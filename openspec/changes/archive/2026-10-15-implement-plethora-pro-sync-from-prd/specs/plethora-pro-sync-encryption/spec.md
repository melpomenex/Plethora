## ADDED Requirements

### Requirement: Sync payloads are encrypted client-side before upload
All sync record payloads containing user learning content SHALL be encrypted on-device with AES-256-GCM before upload. The server SHALL store only ciphertext, envelope metadata, and operational fields required for routing (account, entity type, entity id, revision, sequence). The server MUST NOT require plaintext access to synced user content.

#### Scenario: Server storage scan finds no plaintext
- **WHEN** automated tests inspect `sync_records` and object storage after sustained syncing
- **THEN** no readable card, document, extract, or review content is present

#### Scenario: Ciphertext tampering is detected
- **WHEN** a record's ciphertext or AAD binding is altered in transit or at rest
- **THEN** client decryption fails and the record is quarantined without corrupting local domain data

### Requirement: Account sync key is user-recoverable and not stored plaintext on infrastructure
Each account SHALL have a high-entropy sync master key derived from a user-held Recovery Key. Plethora infrastructure MUST NOT persist the Recovery Key or master key in plaintext. Losing the Recovery Key and all enrolled devices SHALL make cloud sync data unrecoverable, with explicit user acknowledgment during setup.

#### Scenario: Recovery key restores sync on new device
- **WHEN** the user enters a valid Recovery Key on a signed-in device with no prior enrollment
- **THEN** the device can decrypt and apply future and stored sync payloads for that account

#### Scenario: Lost recovery key with no enrolled devices
- **WHEN** the user has no Recovery Key and no enrolled devices remain
- **THEN** cloud sync data cannot be decrypted and the UI explains data is unrecoverable

### Requirement: New devices enroll through trusted-device pairing
Adding a sync-capable device SHALL require approval from an existing enrolled device via QR code or short pairing code. The approving device SHALL wrap the sync master key to the new device's public key using an authenticated key agreement (X25519 or equivalent). The server MUST NOT learn key material during pairing.

#### Scenario: Phone enrolls via desktop QR
- **WHEN** the user scans a desktop-displayed pairing QR on a new phone
- **THEN** the phone receives wrapped key material and can decrypt sync payloads without server key access

#### Scenario: Unpaired device cannot decrypt
- **WHEN** a new device is signed in but not paired
- **THEN** pull returns ciphertext that the device cannot apply until pairing completes

### Requirement: Device revocation rotates encryption epoch
Revoking a device SHALL increment a sync key epoch such that the revoked device cannot decrypt or upload records for subsequent epochs. Enrolled devices SHALL receive epoch updates through normal sync metadata.

#### Scenario: Revoked device blocked from pull
- **WHEN** a device is revoked in account settings
- **THEN** subsequent sync requests from that device fail authorization and local domain data on that device remains intact

### Requirement: Sync master key is stored in platform secure storage
The sync master key and epoch state SHALL be stored using platform-native secure storage (keychain/keystore) via the existing AuthStore pattern. Sync keys MUST NOT be stored in plaintext in `localStorage` or unencrypted SQLite.

#### Scenario: Master key not in web storage
- **WHEN** inspecting browser/local storage keys after enabling sync on desktop
- **THEN** no plaintext sync master key is present in `localStorage`
