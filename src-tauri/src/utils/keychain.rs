//! OS keychain gating + keyring IO abstraction.
//!
//! The macOS/Windows/Linux keychain is **opt-in**. When disabled (the default),
//! the app never touches the OS keychain — it stores secrets in an
//! encrypted-on-disk fallback instead (see `ai_key_store.rs`,
//! `cloud::auth_store.rs`). This avoids the OS keychain unlock prompt that
//! blocks app startup for users who never configured a keychain password.
//!
//! Enable by setting the `PLETHORA_USE_KEYCHAIN=1` environment variable
//! (legacy `INCREMENTUM_USE_KEYCHAIN=1` still accepted) before launching the
//! app.
//!
//! All keychain access in the codebase MUST go through [`keychain_enabled`]
//! and the [`KeyringIo`] trait rather than reading the env var or constructing
//! `keyring::Entry` directly, so the gating stays consistent and tests can
//! substitute an in-memory keyring.

use std::sync::Arc;

/// Read an environment variable, falling back to its legacy `INCREMENTUM_*`
/// name for one release after the rebrand (env prefix `PLETHORA_*`).
pub fn env_or_legacy(name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(name) {
        return Some(value);
    }
    let legacy = format!(
        "INCREMENTUM_{}",
        name.strip_prefix("PLETHORA_").unwrap_or(name)
    );
    std::env::var(&legacy).ok()
}

/// Test-only override so keychain read-through logic can be exercised
/// without mutating process environment variables (which would race other
/// parallel tests).
#[cfg(test)]
static TEST_FORCE_KEYRING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Returns `true` only when the user has explicitly opted into OS keychain use
/// via `PLETHORA_USE_KEYCHAIN=1` (legacy `INCREMENTUM_USE_KEYCHAIN=1`
/// accepted). Defaults to `false`.
pub fn keychain_enabled() -> bool {
    #[cfg(test)]
    {
        if TEST_FORCE_KEYRING.load(std::sync::atomic::Ordering::Relaxed) {
            return true;
        }
    }
    env_or_legacy("PLETHORA_USE_KEYCHAIN").as_deref() == Some("1")
}

/// Force-enable the keychain path for the duration of a test.
#[cfg(test)]
pub fn force_keyring_for_tests() {
    TEST_FORCE_KEYRING.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// The OS keychain operations the secret stores need, behind a trait so unit
/// tests can run against an in-memory fake instead of the real keychain.
pub trait KeyringIo: Send + Sync {
    fn set(&self, service: &str, username: &str, value: &str) -> Result<(), String>;
    fn get(&self, service: &str, username: &str) -> Result<String, String>;
    fn delete(&self, service: &str, username: &str) -> Result<(), String>;
}

/// Real OS keychain backend (`keyring` crate).
pub struct OsKeyring;

impl KeyringIo for OsKeyring {
    fn set(&self, service: &str, username: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(service, username)
            .map_err(|e| format!("keyring error: {e}"))?
            .set_password(value)
            .map_err(|e| format!("keyring set: {e}"))
    }

    fn get(&self, service: &str, username: &str) -> Result<String, String> {
        keyring::Entry::new(service, username)
            .map_err(|e| format!("keyring error: {e}"))?
            .get_password()
            .map_err(|e| format!("keyring get: {e}"))
    }

    fn delete(&self, service: &str, username: &str) -> Result<(), String> {
        keyring::Entry::new(service, username)
            .map_err(|e| format!("keyring error: {e}"))?
            .delete_credential()
            .map_err(|e| format!("keyring delete: {e}"))
    }
}

/// In-memory keyring for tests. Records every (service, username) write.
#[cfg(test)]
pub mod testing {
    use super::KeyringIo;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemoryKeyring {
        entries: Mutex<BTreeMap<(String, String), String>>,
    }

    impl MemoryKeyring {
        pub fn new() -> std::sync::Arc<Self> {
            std::sync::Arc::new(Self::default())
        }

        pub fn seed(&self, service: &str, username: &str, value: &str) {
            self.entries
                .lock()
                .unwrap()
                .insert((service.to_string(), username.to_string()), value.to_string());
        }

        pub fn contains(&self, service: &str, username: &str) -> bool {
            self.entries
                .lock()
                .unwrap()
                .contains_key(&(service.to_string(), username.to_string()))
        }
    }

    impl KeyringIo for MemoryKeyring {
        fn set(&self, service: &str, username: &str, value: &str) -> Result<(), String> {
            self.entries
                .lock()
                .unwrap()
                .insert((service.to_string(), username.to_string()), value.to_string());
            Ok(())
        }

        fn get(&self, service: &str, username: &str) -> Result<String, String> {
            self.entries
                .lock()
                .unwrap()
                .get(&(service.to_string(), username.to_string()))
                .cloned()
                .ok_or_else(|| "keyring get: not found".to_string())
        }

        fn delete(&self, service: &str, username: &str) -> Result<(), String> {
            self.entries
                .lock()
                .unwrap()
                .remove(&(service.to_string(), username.to_string()));
            Ok(())
        }
    }
}

/// Convenience alias for the shared keyring backend handle.
pub type SharedKeyring = Arc<dyn KeyringIo>;
