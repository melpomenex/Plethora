## Why

Multi-device E2E cloud sync requires every device after the first to import the same recovery key that the primary device generated. On a fresh install, Settings → Cloud Storage currently offers no reliable way to import that key, blocking users from joining an existing sync account and causing each new device to silently fork its own encryption identity when "Generate Key" is used instead.

## What Changes

- Ensure the **Import Key** action is always visible and usable on devices that have no master recovery key configured, regardless of stale local or keychain acknowledgement state.
- Align UI gating with the authoritative backend signal (`sync_has_master_key`) rather than only the `recoveryKeyAcknowledged` flag, so a fresh device never lands in a dead-end "Recovery Key Configured" state without an actual key.
- Fix responsive layout in the Sync Master Recovery Key header so Generate/Import buttons remain visible on narrow viewports (tablet/mobile).
- Reconcile persisted `recoveryKeyAcknowledged` in the sync store with Tauri keychain state on init, clearing stale acknowledgement when no master key is present.
- Add component tests covering fresh-device (no key) and additional-device (import path) flows.
- Update help copy in the Cloud Storage section to clearly distinguish first-device (generate) vs additional-device (import) setup.

## Capabilities

### New Capabilities

- `cloud-sync-recovery-key`: Recovery key lifecycle in Cloud Storage settings — generate on first device, import on additional devices, and correct UI/state when no key is configured.

### Modified Capabilities

<!-- No existing openspec capability covers E2E cloud sync recovery keys -->

## Impact

- `src/components/settings/SyncSettingsPanel.tsx` — primary UI for Generate/Import actions
- `src/components/settings/CloudStorageSettings.tsx` — hosts SyncSettingsPanel in Cloud Storage tab
- `src/stores/syncStore.ts` — init, persistence, and `sync_has_master_key` integration
- `src-tauri/src/sync/keys.rs` / `src-tauri/src/sync/mod.rs` — authoritative key and acknowledgement state (read-only unless reconciliation bug found in Rust)
- Help index copy under Settings → Sync / Cloud Storage
