//! Secure storage Tauri commands.
//!
//! Backs the web/PWA-vs-Tauri split in `src/lib/sync/secureStorage.ts`. On
//! Tauri we route through the OS keychain via the `keyring` crate — the same
//! crate used by `ai_key_store.rs` and `cloud::auth_store::AuthStore`, so no
//! new dependency is required. The crate selects the right native backend per
//! platform: macOS Keychain, Windows Credential Manager, Linux Secret Service,
//! Android Keystore, iOS Keychain.
//!
//! Values are passed as base64 strings from the frontend (binary in Tauri IPC
//! has to round-trip through arrays; base64 keeps the commands trivial and
//! auditable). A missing entry returns `Ok(None)` so the TS layer can model
//! "no cached key" cleanly.

use crate::error::IncrementumError;
use crate::error::Result;
use crate::utils::keychain::keychain_enabled;

/// Store `value` (base64) under `(service, account)` in the OS keychain.
///
/// Returns `Ok(())` without doing anything when the keychain is disabled
/// (the default). Callers fall back to the encrypted IndexedDB path in
/// `secureStorage.ts`.
///
/// `keyring::Entry` calls are synchronous OS/Keystore I/O (on Android this is
/// a blocking Binder IPC to the keystore2 daemon) with no internal `.await`.
/// Running that directly in an `async fn` ties up a Tokio worker thread for
/// however long the OS call takes; under concurrent load from other commands
/// this starved the small async worker pool badly enough that a keychain read
/// needed for delta-log sync never got a thread to run on, stalling the whole
/// boot chain behind it. `spawn_blocking` moves the blocking call onto the
/// separate blocking-thread pool so it can never starve the async workers.
#[tauri::command]
pub async fn secure_storage_set(service: String, account: String, value: String) -> Result<()> {
    if !keychain_enabled() {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &account)
            .map_err(|e| keyring_err("secure_storage_set", e))?;
        entry
            .set_password(&value)
            .map_err(|e| keyring_err("secure_storage_set", e))
    })
    .await
    .map_err(|e| IncrementumError::Internal(format!("secure_storage_set: task join error: {e}")))?
}

/// Read the base64 value for `(service, account)` from the OS keychain.
/// Returns `Ok(None)` when no credential exists, or when the keychain is
/// disabled (the default).
#[tauri::command]
pub async fn secure_storage_get(service: String, account: String) -> Result<Option<String>> {
    if !keychain_enabled() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &account)
            .map_err(|e| keyring_err("secure_storage_get", e))?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring_err("secure_storage_get", e)),
        }
    })
    .await
    .map_err(|e| IncrementumError::Internal(format!("secure_storage_get: task join error: {e}")))?
}

/// Remove the `(service, account)` credential. Missing entries are not an
/// error, and the call is a no-op when the keychain is disabled (the default).
#[tauri::command]
pub async fn secure_storage_clear(service: String, account: String) -> Result<()> {
    if !keychain_enabled() {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &account)
            .map_err(|e| keyring_err("secure_storage_clear", e))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_err("secure_storage_clear", e)),
        }
    })
    .await
    .map_err(|e| {
        IncrementumError::Internal(format!("secure_storage_clear: task join error: {e}"))
    })?
}

fn keyring_err(ctx: &str, e: keyring::Error) -> IncrementumError {
    IncrementumError::Internal(format!("{ctx}: keyring error: {e}"))
}
