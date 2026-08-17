//! OAuth Token Persistence
//!
//! Stores and retrieves OAuth tokens using the OS keychain (via the `keyring` crate).
//! Falls back to encrypted file storage when the keychain is unavailable.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::provider::{AuthToken, CloudProvider, CloudProviderType};
use crate::error::AppError;
use crate::utils::keychain::{keychain_enabled, OsKeyring, SharedKeyring};

const KEYRING_SERVICE: &str = "com.plethora.app";
/// Legacy keychain service written by Incrementum releases. Read-through
/// only; entries are migrated forward on first successful read and NEVER
/// deleted by a read (see D27).
const LEGACY_KEYRING_SERVICE: &str = "com.incrementum.app";
const TOKENS_DIR_NAME: &str = "tokens";

#[derive(Clone)]
pub struct AuthStore {
    app_data_dir: PathBuf,
    /// Pre-rebrand app-data directory; its `tokens/` encrypted files are a
    /// read-through fallback when the new directory has none.
    legacy_data_dir: Option<PathBuf>,
    keyring: SharedKeyring,
}

impl AuthStore {
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

    // ── public API ────────────────────────────────────────────

    pub async fn store_token(
        &self,
        provider_type: CloudProviderType,
        token: &AuthToken,
    ) -> Result<(), AppError> {
        let json = serde_json::to_string(token)
            .map_err(|e| AppError::Internal(format!("Failed to serialize token: {e}")))?;

        let username = provider_type.as_str();

        if Self::should_use_keyring() {
            if let Err(keychain_err) = self.keyring.set(KEYRING_SERVICE, username, &json) {
                tracing::warn!(
                    "Keychain unavailable for {}, falling back to encrypted file: {}",
                    username,
                    keychain_err
                );
            } else {
                return Ok(());
            }
        }

        self.encrypted_file_store(provider_type, json.as_bytes())
            .await?;
        Ok(())
    }

    pub async fn get_token(
        &self,
        provider_type: CloudProviderType,
    ) -> Result<Option<AuthToken>, AppError> {
        let username = provider_type.as_str();

        if Self::should_use_keyring() {
            // 1. Current service.
            match self.keyring.get(KEYRING_SERVICE, username) {
                Ok(json) => {
                    let token: AuthToken = serde_json::from_str(&json).map_err(|e| {
                        AppError::Internal(format!(
                            "Failed to deserialize token from keychain: {e}"
                        ))
                    })?;
                    return Ok(Some(token));
                }
                Err(_) => {}
            }
            // 2. Legacy Incrementum service — read-through, then migrate the
            //    credential forward under the new service name. The legacy
            //    entry is NEVER deleted (D27).
            match self.keyring.get(LEGACY_KEYRING_SERVICE, username) {
                Ok(json) => {
                    let token: AuthToken = serde_json::from_str(&json).map_err(|e| {
                        AppError::Internal(format!(
                            "Failed to deserialize token from legacy keychain: {e}"
                        ))
                    })?;
                    if let Err(err) = self.keyring.set(KEYRING_SERVICE, username, &json) {
                        tracing::warn!(
                            "Failed to migrate legacy keychain entry for {} forward: {}",
                            username,
                            err
                        );
                    } else {
                        tracing::info!(
                            "Migrated legacy keychain token for {} to service {}",
                            username,
                            KEYRING_SERVICE
                        );
                    }
                    return Ok(Some(token));
                }
                Err(keychain_err) => {
                    tracing::warn!(
                        "Keychain unavailable for {}, trying encrypted file: {}",
                        username,
                        keychain_err
                    );
                }
            }
        }

        // 3. Encrypted file in the current app-data dir.
        match self.encrypted_file_load(provider_type).await {
            Ok(Some(bytes)) => {
                let json = String::from_utf8(bytes).map_err(|e| {
                    AppError::Internal(format!("Token file contains invalid UTF-8: {e}"))
                })?;
                let token: AuthToken = serde_json::from_str(&json).map_err(|e| {
                    AppError::Internal(format!(
                        "Failed to deserialize token from encrypted file: {e}"
                    ))
                })?;
                Ok(Some(token))
            }
            Ok(None) => self.legacy_encrypted_file_load(provider_type).await,
            Err(e) => Err(e),
        }
    }

    pub async fn remove_token(&self, provider_type: CloudProviderType) -> Result<(), AppError> {
        let username = provider_type.as_str();

        if Self::should_use_keyring() {
            // Explicit user-initiated removal clears BOTH the new and the
            // legacy service entries.
            let _ = self.keyring.delete(KEYRING_SERVICE, username);
            let _ = self.keyring.delete(LEGACY_KEYRING_SERVICE, username);
        }

        // Also delete the encrypted fallback files (current + legacy dir).
        for path in [
            self.token_enc_path(provider_type),
            self.legacy_token_enc_path(provider_type),
        ] {
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| {
                    AppError::Internal(format!(
                        "Failed to delete token file {}: {e}",
                        path.display()
                    ))
                })?;
            }
        }
        Ok(())
    }

    fn should_use_keyring() -> bool {
        keychain_enabled()
    }

    // ── encrypted-file fallback ───────────────────────────────

    fn tokens_dir(&self) -> PathBuf {
        self.app_data_dir.join(TOKENS_DIR_NAME)
    }

    fn token_enc_path(&self, provider_type: CloudProviderType) -> PathBuf {
        self.tokens_dir()
            .join(format!("{}.enc", provider_type.as_str()))
    }

    fn legacy_token_enc_path(&self, provider_type: CloudProviderType) -> PathBuf {
        self.legacy_data_dir
            .as_deref()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_default()
            .join(TOKENS_DIR_NAME)
            .join(format!("{}.enc", provider_type.as_str()))
    }

    /// Read-through to a pre-rebrand `tokens/` encrypted file. On success the
    /// raw bytes are copied into the current tokens dir so subsequent reads
    /// hit the new location; the legacy file is left untouched.
    async fn legacy_encrypted_file_load(
        &self,
        provider_type: CloudProviderType,
    ) -> Result<Option<AuthToken>, AppError> {
        let legacy_path = self.legacy_token_enc_path(provider_type);
        if !legacy_path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(&legacy_path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to read legacy token file {}: {}",
                legacy_path.display(),
                e
            ))
        })?;
        let plaintext = Self::decrypt_token_bytes(&data)?;
        let json = String::from_utf8(plaintext).map_err(|e| {
            AppError::Internal(format!("Legacy token file contains invalid UTF-8: {e}"))
        })?;
        let token: AuthToken = serde_json::from_str(&json).map_err(|e| {
            AppError::Internal(format!(
                "Failed to deserialize token from legacy encrypted file: {e}"
            ))
        })?;
        // Copy the still-encrypted blob forward unchanged (the AES key is
        // derived from the same machine identity, so it decrypts identically).
        if let Some(parent) = self.token_enc_path(provider_type).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(err) = std::fs::copy(&legacy_path, self.token_enc_path(provider_type)) {
            tracing::warn!(
                "Failed to copy legacy token file forward ({}); the legacy file remains readable",
                err
            );
        }
        Ok(Some(token))
    }

    /// Decrypt an encrypted token blob, trying the current salted format
    /// first and the legacy hostname-salted format second.
    fn decrypt_token_bytes(data: &[u8]) -> Result<Vec<u8>, AppError> {
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

        if data.len() < 28 {
            return Err(AppError::Internal(
                "Encrypted token file is too short".to_string(),
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

    fn derive_machine_key_with_salt(salt: &[u8]) -> Result<[u8; 32], AppError> {
        let username = whoami_username();
        let password = format!("{}:{}", username, user_id());

        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 100_000, &mut key);
        Ok(key)
    }

    /// Legacy key derivation using predictable hostname-as-salt (for migration)
    fn derive_machine_key_legacy() -> Result<[u8; 32], AppError> {
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

    async fn encrypted_file_store(
        &self,
        provider_type: CloudProviderType,
        plaintext: &[u8],
    ) -> Result<(), AppError> {
        let dir = self.tokens_dir();
        std::fs::create_dir_all(&dir).map_err(|e| {
            AppError::Internal(format!(
                "Failed to create tokens dir {}: {e}",
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

        let path = self.token_enc_path(provider_type);
        std::fs::write(&path, &out).map_err(|e| {
            AppError::Internal(format!(
                "Failed to write token file {}: {e}",
                path.display()
            ))
        })?;

        Ok(())
    }

    async fn encrypted_file_load(
        &self,
        provider_type: CloudProviderType,
    ) -> Result<Option<Vec<u8>>, AppError> {
        let path = self.token_enc_path(provider_type);
        if !path.exists() {
            return Ok(None);
        }

        let data = std::fs::read(&path).map_err(|e| {
            AppError::Internal(format!("Failed to read token file {}: {e}", path.display()))
        })?;

        // New format minimum: salt(16) + nonce(12) + tag(16) = 44 bytes
        // Old format minimum: nonce(12) + tag(16) = 28 bytes
        if data.len() < 28 {
            return Err(AppError::Internal(
                "Encrypted token file is too short".to_string(),
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

        // Fallback: old format (no salt) with legacy hostname-based derivation
        {
            let old_key = Self::derive_machine_key_legacy()?;
            let cipher = Aes256Gcm::new_from_slice(&old_key)
                .map_err(|e| AppError::Internal(format!("AES init: {e}")))?;
            let nonce = Nonce::from_slice(&data[..12]);
            let ciphertext = &data[12..];

            if let Ok(plaintext) = cipher.decrypt(nonce, ciphertext) {
                // Migrate to new format
                let _ = self.encrypted_file_store(provider_type, &plaintext).await;
                return Ok(Some(plaintext));
            }
        }

        Err(AppError::Internal(
            "Decryption failed: credentials may be from a different machine".to_string(),
        ))
    }
}

// ── helper: current username ─────────────────────────────────

fn whoami_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn user_id() -> String {
    // Use a stable machine+user identifier for key derivation.
    format!(
        "{}@{}",
        whoami_username(),
        hostname::get()
            .map(|h| h.into_string().unwrap_or_default())
            .unwrap_or_else(|_| "unknown".to_string())
    )
}

pub struct CloudAuthProvider {
    providers: std::sync::Arc<
        std::sync::Mutex<HashMap<CloudProviderType, Arc<RwLock<Box<dyn CloudProvider>>>>>,
    >,
}

impl Clone for CloudAuthProvider {
    fn clone(&self) -> Self {
        Self {
            providers: std::sync::Arc::clone(&self.providers),
        }
    }
}

impl CloudAuthProvider {
    pub fn new() -> Self {
        Self {
            providers: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn get_provider(
        &self,
        provider_type: CloudProviderType,
    ) -> Option<Arc<RwLock<Box<dyn CloudProvider>>>> {
        self.providers
            .lock()
            .expect("auth_store mutex poisoned")
            .get(&provider_type)
            .cloned()
    }

    pub fn set_provider(&self, provider_type: CloudProviderType, provider: Box<dyn CloudProvider>) {
        self.providers
            .lock()
            .expect("auth_store mutex poisoned")
            .insert(provider_type, Arc::new(RwLock::new(provider)));
    }

    pub fn remove_provider(&self, provider_type: CloudProviderType) {
        self.providers
            .lock()
            .expect("auth_store mutex poisoned")
            .remove(&provider_type);
    }

    pub fn is_authenticated(&self, provider_type: CloudProviderType) -> bool {
        self.providers
            .lock()
            .expect("auth_store mutex poisoned")
            .contains_key(&provider_type)
    }
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
            "plethora-auth-store-{}-{}-{}",
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

    fn sample_token() -> AuthToken {
        AuthToken {
            access_token: "at-legacy".to_string(),
            refresh_token: "rt-legacy".to_string(),
            expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
            token_type: "bearer".to_string(),
        }
    }

    /// A token under the legacy keychain service reads through, migrates
    /// forward, and the legacy entry survives.
    #[tokio::test]
    async fn read_through_legacy_keyring_migrates_without_deleting() {
        force_keyring_for_tests();
        let keyring = MemoryKeyring::new();
        let token = sample_token();
        keyring.seed(
            LEGACY_KEYRING_SERVICE,
            "dropbox",
            &serde_json::to_string(&token).unwrap(),
        );

        let base = temp_dir("keyring");
        let store = AuthStore::with_keyring(
            base.join("com.plethora.app"),
            Some(base.join("com.incrementum.app")),
            keyring.clone(),
        );

        let loaded = store
            .get_token(CloudProviderType::Dropbox)
            .await
            .unwrap()
            .expect("legacy token must read through");
        assert_eq!(loaded.access_token, "at-legacy");
        assert!(keyring.contains(KEYRING_SERVICE, "dropbox"));
        assert!(
            keyring.contains(LEGACY_KEYRING_SERVICE, "dropbox"),
            "the legacy entry must NEVER be deleted by a read"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// An encrypted token file in the legacy app-data dir reads through and
    /// is copied forward; the legacy file survives.
    #[tokio::test]
    async fn read_through_legacy_encrypted_file_copies_forward() {
        force_keyring_for_tests();
        let keyring = MemoryKeyring::new();
        let base = temp_dir("file");
        let new_dir = base.join("com.plethora.app");
        let legacy_dir = base.join("com.incrementum.app");
        std::fs::create_dir_all(&new_dir).unwrap();

        let legacy_store = AuthStore::with_keyring(
            legacy_dir.clone(),
            None,
            std::sync::Arc::new(UnavailableKeyring),
        );
        legacy_store
            .store_token(CloudProviderType::Dropbox, &sample_token())
            .await
            .unwrap();
        assert!(legacy_dir.join("tokens/dropbox.enc").exists());

        let store = AuthStore::with_keyring(new_dir.clone(), Some(legacy_dir.clone()), keyring);
        let loaded = store
            .get_token(CloudProviderType::Dropbox)
            .await
            .unwrap()
            .expect("legacy file must read through");
        assert_eq!(loaded.access_token, "at-legacy");
        assert!(new_dir.join("tokens/dropbox.enc").exists());
        assert!(legacy_dir.join("tokens/dropbox.enc").exists());

        let _ = std::fs::remove_dir_all(&base);
    }
}
