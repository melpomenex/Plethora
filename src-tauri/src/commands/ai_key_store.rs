//! AI API Key Keychain Storage
//!
//! Stores and retrieves LLM API keys using the OS keychain (via `keyring`).
//! Falls back to encrypted file storage when the keychain is unavailable.
//! Reuses the same patterns as `cloud::auth_store::AuthStore`.

use crate::error::AppError;
use crate::utils::keychain::{keychain_enabled, OsKeyring, SharedKeyring};
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "com.plethora.app.ai";
/// Legacy keychain service written by Incrementum releases. Read-through
/// only; entries migrate forward on first successful read and are NEVER
/// deleted by a read (see D27).
const LEGACY_KEYRING_SERVICE: &str = "com.incrementum.app.ai";
const KEYS_DIR_NAME: &str = "ai_keys";

#[derive(Clone)]
pub struct AIKeyStore {
    app_data_dir: PathBuf,
    /// Pre-rebrand app-data directory; its `ai_keys/` encrypted files are a
    /// read-through fallback when the new directory has none.
    legacy_data_dir: Option<PathBuf>,
    keyring: SharedKeyring,
}

impl AIKeyStore {
    pub fn new(app_data_dir: PathBuf, legacy_data_dir: Option<PathBuf>) -> Self {
        Self {
            app_data_dir,
            legacy_data_dir,
            keyring: std::sync::Arc::new(OsKeyring),
        }
    }

    /// Test constructor with an injectable keyring backend.
    pub fn with_keyring(
        app_data_dir: PathBuf,
        legacy_data_dir: Option<PathBuf>,
        keyring: SharedKeyring,
    ) -> Self {
        Self {
            app_data_dir,
            legacy_data_dir,
            keyring,
        }
    }

    pub async fn store_key(&self, provider: &str, api_key: &str) -> Result<(), AppError> {
        if Self::should_use_keyring() {
            if let Err(keychain_err) = self.keyring.set(KEYRING_SERVICE, provider, api_key) {
                tracing::warn!(
                    "Keychain unavailable for AI key {}, falling back to encrypted file: {}",
                    provider,
                    keychain_err
                );
            } else {
                return Ok(());
            }
        }

        self.encrypted_file_store(provider, api_key.as_bytes())
            .await?;
        Ok(())
    }

    pub async fn get_key(&self, provider: &str) -> Result<Option<String>, AppError> {
        if Self::should_use_keyring() {
            // 1. Current service.
            if let Ok(key) = self.keyring.get(KEYRING_SERVICE, provider) {
                return Ok(Some(key));
            }
            // 2. Legacy Incrementum service — read-through, then migrate the
            //    credential forward. The legacy entry is NEVER deleted (D27).
            if let Ok(key) = self.keyring.get(LEGACY_KEYRING_SERVICE, provider) {
                if let Err(err) = self.keyring.set(KEYRING_SERVICE, provider, &key) {
                    tracing::warn!(
                        "Failed to migrate legacy AI key entry for {} forward: {}",
                        provider,
                        err
                    );
                } else {
                    tracing::info!(
                        "Migrated legacy keychain AI key for {} to service {}",
                        provider,
                        KEYRING_SERVICE
                    );
                }
                return Ok(Some(key));
            }
        }

        // 3. Encrypted file in the current app-data dir.
        match self.encrypted_file_load(provider).await {
            Ok(Some(bytes)) => {
                let key = String::from_utf8(bytes).map_err(|e| {
                    AppError::Internal(format!("AI key file contains invalid UTF-8: {e}"))
                })?;
                Ok(Some(key))
            }
            Ok(None) => self.legacy_encrypted_file_load(provider).await,
            Err(e) => Err(e),
        }
    }

    pub async fn remove_key(&self, provider: &str) -> Result<(), AppError> {
        if Self::should_use_keyring() {
            // Explicit user-initiated removal clears BOTH the new and the
            // legacy service entries.
            let _ = self.keyring.delete(KEYRING_SERVICE, provider);
            let _ = self.keyring.delete(LEGACY_KEYRING_SERVICE, provider);
        }

        for path in [
            self.key_enc_path(provider),
            self.legacy_key_enc_path(provider),
        ] {
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| {
                    AppError::Internal(format!(
                        "Failed to delete AI key file {}: {e}",
                        path.display()
                    ))
                })?;
            }
        }
        Ok(())
    }

    /// Check if a key exists without retrieving it.
    pub async fn has_key(&self, provider: &str) -> bool {
        if Self::should_use_keyring()
            && (self.keyring.get(KEYRING_SERVICE, provider).is_ok()
                || self.keyring.get(LEGACY_KEYRING_SERVICE, provider).is_ok())
        {
            return true;
        }
        self.key_enc_path(provider).exists() || self.legacy_key_enc_path(provider).exists()
    }

    /// Get the last 4 characters of a key for masked display.
    pub async fn get_masked_key(&self, provider: &str) -> Result<Option<String>, AppError> {
        match self.get_key(provider).await {
            Ok(Some(key)) => {
                if key.len() <= 4 {
                    return Ok(Some("*".repeat(key.len())));
                }
                Ok(Some(format!(
                    "{}{}",
                    "*".repeat(key.len() - 4),
                    &key[key.len() - 4..]
                )))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn should_use_keyring() -> bool {
        keychain_enabled()
    }

    // ── encrypted-file fallback ──────────────────────────────────

    fn keys_dir(&self) -> PathBuf {
        self.app_data_dir.join(KEYS_DIR_NAME)
    }

    fn key_enc_path(&self, provider: &str) -> PathBuf {
        self.keys_dir().join(format!("{}.enc", provider))
    }

    fn legacy_key_enc_path(&self, provider: &str) -> PathBuf {
        self.legacy_data_dir
            .as_deref()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_default()
            .join(KEYS_DIR_NAME)
            .join(format!("{}.enc", provider))
    }

    /// Read-through to a pre-rebrand `ai_keys/` encrypted file. On success the
    /// raw bytes are copied into the current keys dir; the legacy file is
    /// left untouched.
    async fn legacy_encrypted_file_load(&self, provider: &str) -> Result<Option<String>, AppError> {
        let legacy_path = self.legacy_key_enc_path(provider);
        if !legacy_path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(&legacy_path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to read legacy AI key file {}: {}",
                legacy_path.display(),
                e
            ))
        })?;
        let plaintext = Self::decrypt_key_bytes(&data)?;
        let key = String::from_utf8(plaintext).map_err(|e| {
            AppError::Internal(format!("Legacy AI key file contains invalid UTF-8: {e}"))
        })?;
        if let Some(parent) = self.key_enc_path(provider).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(err) = std::fs::copy(&legacy_path, self.key_enc_path(provider)) {
            tracing::warn!(
                "Failed to copy legacy AI key file forward ({}); the legacy file remains readable",
                err
            );
        }
        Ok(Some(key))
    }

    /// Decrypt an encrypted AI-key blob, trying the current salted format
    /// first and the legacy hostname-salted format second.
    fn decrypt_key_bytes(data: &[u8]) -> Result<Vec<u8>, AppError> {
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

        if data.len() < 28 {
            return Err(AppError::Internal(
                "Encrypted AI key file is too short".to_string(),
            ));
        }
        if data.len() >= 44 {
            let salt = &data[..16];
            let nonce = Nonce::from_slice(&data[16..28]);
            let ciphertext = &data[28..];
            let key = Self::derive_machine_key_with_salt(salt)?;
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;
            if let Ok(plaintext) = cipher.decrypt(nonce, ciphertext) {
                return Ok(plaintext);
            }
        }
        let old_key = Self::derive_machine_key_legacy()?;
        let cipher = Aes256Gcm::new_from_slice(&old_key)
            .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;
        let nonce = Nonce::from_slice(&data[..12]);
        let ciphertext = &data[12..];
        cipher.decrypt(nonce, ciphertext).map_err(|_| {
            AppError::Internal(
                "Decryption failed: credentials may be from a different machine".to_string(),
            )
        })
    }

    async fn encrypted_file_store(&self, provider: &str, plaintext: &[u8]) -> Result<(), AppError> {
        use aes_gcm::{
            aead::{Aead, KeyInit, OsRng},
            AeadCore, Aes256Gcm,
        };
        use pbkdf2::pbkdf2_hmac;
        use rand::RngCore;
        use sha2::Sha256;

        let dir = self.keys_dir();
        std::fs::create_dir_all(&dir).map_err(|e| {
            AppError::Internal(format!(
                "Failed to create ai_keys dir {}: {e}",
                dir.display()
            ))
        })?;

        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);

        let key = Self::derive_machine_key_with_salt(&salt)?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

        // Layout: salt(16) + nonce(12) + ciphertext
        let mut out = Vec::with_capacity(16 + 12 + ciphertext.len());
        out.extend_from_slice(&salt);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);

        let path = self.key_enc_path(provider);
        std::fs::write(&path, &out).map_err(|e| {
            AppError::Internal(format!(
                "Failed to write AI key file {}: {e}",
                path.display()
            ))
        })?;

        Ok(())
    }

    async fn encrypted_file_load(&self, provider: &str) -> Result<Option<Vec<u8>>, AppError> {
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

        let path = self.key_enc_path(provider);
        if !path.exists() {
            return Ok(None);
        }

        let data = std::fs::read(&path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to read AI key file {}: {e}",
                path.display()
            ))
        })?;

        if data.len() < 28 {
            return Err(AppError::Internal(
                "Encrypted AI key file is too short".to_string(),
            ));
        }

        // Try new format first: salt(16) + nonce(12) + ciphertext
        if data.len() >= 44 {
            let salt = &data[..16];
            let nonce = Nonce::from_slice(&data[16..28]);
            let ciphertext = &data[28..];

            let key = Self::derive_machine_key_with_salt(salt)?;
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;

            if let Ok(plaintext) = cipher.decrypt(nonce, ciphertext) {
                return Ok(Some(plaintext));
            }
        }

        // Fallback: old format with legacy hostname-based derivation
        {
            let old_key = Self::derive_machine_key_legacy()?;
            let cipher = Aes256Gcm::new_from_slice(&old_key)
                .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;
            let nonce = Nonce::from_slice(&data[..12]);
            let ciphertext = &data[12..];

            if let Ok(plaintext) = cipher.decrypt(nonce, ciphertext) {
                let _ = self.encrypted_file_store(provider, &plaintext).await;
                return Ok(Some(plaintext));
            }
        }

        Err(AppError::Internal(
            "Decryption failed: credentials may be from a different machine".to_string(),
        ))
    }

    fn derive_machine_key_with_salt(salt: &[u8]) -> Result<[u8; 32], AppError> {
        use pbkdf2::pbkdf2_hmac;
        use sha2::Sha256;

        let username = whoami_username();
        let password = format!("{}:{}", username, user_id());

        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 100_000, &mut key);
        Ok(key)
    }

    fn derive_machine_key_legacy() -> Result<[u8; 32], AppError> {
        use pbkdf2::pbkdf2_hmac;
        use sha2::Sha256;

        let hostname_bytes = hostname::get()
            .map(|h| h.into_string().unwrap_or_default())
            .unwrap_or_else(|_| "unknown".to_string());
        let username = whoami_username();
        let password = format!("{}:{}", username, user_id());

        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            password.as_bytes(),
            hostname_bytes.as_bytes(),
            100_000,
            &mut key,
        );
        Ok(key)
    }
}

fn whoami_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn user_id() -> String {
    format!(
        "{}@{}",
        whoami_username(),
        hostname::get()
            .map(|h| h.into_string().unwrap_or_default())
            .unwrap_or_else(|_| "unknown".to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::keychain::force_keyring_for_tests;
    use crate::utils::keychain::testing::MemoryKeyring;


/// Keyring backend whose every operation fails — forces the encrypted-file
/// fallback path so tests can seed files.
struct UnavailableKeyring;
impl crate::utils::keychain::KeyringIo for UnavailableKeyring {
    fn set(&self, _s: &str, _u: &str, _v: &str) -> Result<(), String> {
        Err("unavailable".to_string())
    }
    fn get(&self, _s: &str, _u: &str) -> Result<String, String> {
        Err("unavailable".to_string())
    }
    fn delete(&self, _s: &str, _u: &str) -> Result<(), String> {
        Err("unavailable".to_string())
    }
}

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "plethora-ai-key-store-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A key stored under the LEGACY keychain service is readable and gets
    /// migrated forward — without the legacy entry being deleted.
    #[tokio::test]
    async fn read_through_legacy_keyring_migrates_without_deleting() {
        force_keyring_for_tests();
        let keyring = MemoryKeyring::new();
        keyring.seed(LEGACY_KEYRING_SERVICE, "openai", "sk-legacy");

        let base = temp_dir("keyring");
        let store = AIKeyStore::with_keyring(
            base.join("com.plethora.app"),
            Some(base.join("com.incrementum.app")),
            keyring.clone(),
        );

        let key = store.get_key("openai").await.unwrap();
        assert_eq!(key.as_deref(), Some("sk-legacy"));
        assert!(
            keyring.contains(KEYRING_SERVICE, "openai"),
            "credential must be written forward to the new service"
        );
        assert!(
            keyring.contains(LEGACY_KEYRING_SERVICE, "openai"),
            "the legacy entry must NEVER be deleted by a read"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// A key stored as an encrypted file in the LEGACY app-data dir is
    /// readable and copied forward; the legacy file survives.
    #[tokio::test]
    async fn read_through_legacy_encrypted_file_copies_forward() {
        force_keyring_for_tests();
        let keyring = MemoryKeyring::new();
        let base = temp_dir("file");
        let new_dir = base.join("com.plethora.app");
        let legacy_dir = base.join("com.incrementum.app");
        std::fs::create_dir_all(&new_dir).unwrap();

        // Write a legacy encrypted file through a store pointed at the legacy
        // dir (same derivation → decryptable by the new store).
        let legacy_store = AIKeyStore::with_keyring(
            legacy_dir.clone(),
            None,
            std::sync::Arc::new(UnavailableKeyring),
        );
        legacy_store.store_key("openai", "sk-file").await.unwrap();
        assert!(legacy_dir.join("ai_keys/openai.enc").exists());

        let store =
            AIKeyStore::with_keyring(new_dir.clone(), Some(legacy_dir.clone()), keyring);
        let key = store.get_key("openai").await.unwrap();
        assert_eq!(key.as_deref(), Some("sk-file"));
        assert!(
            new_dir.join("ai_keys/openai.enc").exists(),
            "encrypted blob must be copied forward"
        );
        assert!(
            legacy_dir.join("ai_keys/openai.enc").exists(),
            "legacy file must remain"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// Explicit removal (user disconnect) clears BOTH service entries.
    #[tokio::test]
    async fn remove_clears_new_and_legacy_entries() {
        force_keyring_for_tests();
        let keyring = MemoryKeyring::new();
        keyring.seed(KEYRING_SERVICE, "openai", "sk-new");
        keyring.seed(LEGACY_KEYRING_SERVICE, "openai", "sk-old");

        let base = temp_dir("remove");
        let store = AIKeyStore::with_keyring(
            base.join("com.plethora.app"),
            Some(base.join("com.incrementum.app")),
            keyring.clone(),
        );
        store.remove_key("openai").await.unwrap();
        assert!(!keyring.contains(KEYRING_SERVICE, "openai"));
        assert!(!keyring.contains(LEGACY_KEYRING_SERVICE, "openai"));

        let _ = std::fs::remove_dir_all(&base);
    }
}
