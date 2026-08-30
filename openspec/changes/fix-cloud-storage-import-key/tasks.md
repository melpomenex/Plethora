## 1. Sync store — authoritative key state

- [x] 1.1 Add `hasMasterKey: boolean` to `syncStore` state and persist it in `partialize`
- [x] 1.2 Fetch `sync_has_master_key` alongside `sync_recovery_key_acknowledged` in `init()`
- [x] 1.3 Reconcile stale state: when `recoveryKeyAcknowledged` is true but `hasMasterKey` is false, clear acknowledgement (new `sync_clear_recovery_ack` Tauri command or equivalent) and reset local persist
- [x] 1.4 Update `storeRecoveryKey` / `acknowledgeRecoveryKey` to set `hasMasterKey: true` on success

## 2. Rust — acknowledgement cleanup (if needed)

- [x] 2.1 Add `sync_clear_recovery_ack` command in `src-tauri/src/sync/keys.rs` that deletes the `recovery_ack_v1` secret
- [x] 2.2 Register the command in `lib.rs` and add a unit test proving ack can be cleared independently of master key

## 3. SyncSettingsPanel UI

- [x] 3.1 Gate Generate/Import visibility on `!hasMasterKey` instead of `!recoveryKeyAcknowledged`
- [x] 3.2 Show "Recovery Key Configured" disabled state only when `hasMasterKey && recoveryKeyAcknowledged`
- [x] 3.3 Fix responsive layout: stack title and actions on narrow viewports (`flex-col sm:flex-row gap-3`)
- [x] 3.4 Verify import form, validation, and success path still call `storeRecoveryKey` + `acknowledgeRecoveryKey`

## 4. Tests

- [x] 4.1 Add `SyncSettingsPanel.test.tsx`: fresh device (no key) shows Generate and Import buttons
- [x] 4.2 Add test: invalid import key shows validation error
- [x] 4.3 Add test: configured state (`hasMasterKey` + acknowledged) hides generate/import
- [x] 4.4 Extend `syncStore.test.ts` to cover `hasMasterKey` init and stale-ack reconciliation

## 5. Verification

- [x] 5.1 Manual smoke: fresh install → Settings → Cloud Storage → Import Key visible and functional
- [x] 5.2 Manual smoke: device with existing key shows "Recovery Key Configured" with no import/generate
- [x] 5.3 Run `npm run test` on touched files and `npm run bench:check` if store hot path changes
