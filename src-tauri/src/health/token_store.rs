//! Encrypted & opt-in OS keychain storage for health provider OAuth tokens.
//!
//! Follows Plethora's mandatory keychain invariant (`crate::utils::keychain::keychain_enabled`):
//! OS keychain access is opt-in via `PLETHORA_USE_KEYCHAIN=1`; otherwise tokens persist inside
//! `<app_data_dir>/health/tokens/<provider>.enc` encrypted with PBKDF2-HMAC-SHA256 + AES-256-GCM.
//! Raw access/refresh tokens are NEVER included in `Debug` output or error messages.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use std::path::PathBuf;

use super::models::HealthProviderId;
use crate::utils::keychain::{keychain_enabled, OsKeyring, SharedKeyring};

const HEALTH_KEYRING_SERVICE: &str = "com.plethora.app.health";
const TOKENS_DIR: &str = "tokens";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthOAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub token_type: String,
    pub scope: Option<String>,
    pub account_subject_hint: Option<String>,
}

impl fmt::Debug for HealthOAuthToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HealthOAuthToken")
            .field("access_token", &"[REDACTED]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("expires_at_ms", &self.expires_at_ms)
            .field("token_type", &self.token_type)
            .field("scope", &self.scope)
            .field("account_subject_hint", &self.account_subject_hint)
            .finish()
    }
}

impl HealthOAuthToken {
    pub fn is_expired_or_expiring(&self, now_ms: i64, skew_ms: i64) -> bool {
        match self.expires_at_ms {
            Some(exp) => now_ms + skew_ms >= exp,
            None => false,
        }
    }
}

#[derive(Clone)]
pub struct HealthTokenStore {
    health_dir: PathBuf,
    keyring: SharedKeyring,
}

impl HealthTokenStore {
    pub fn new(health_dir: PathBuf) -> Self {
        Self {
            health_dir,
            keyring: std::sync::Arc::new(OsKeyring),
        }
    }

    pub fn with_keyring(health_dir: PathBuf, keyring: SharedKeyring) -> Self {
        Self {
            health_dir,
            keyring,
        }
    }

    fn tokens_dir(&self) -> PathBuf {
        self.health_dir.join(TOKENS_DIR)
    }

    fn token_path(&self, provider: HealthProviderId) -> PathBuf {
        self.tokens_dir().join(format!("{}.enc", provider.as_str()))
    }

    pub async fn store_token(
        &self,
        provider: HealthProviderId,
        token: &HealthOAuthToken,
    ) -> Result<(), String> {
        let json = serde_json::to_string(token)
            .map_err(|e| format!("Failed serializing health token: {e}"))?;
        let account = provider.as_str();

        if keychain_enabled() {
            if self
                .keyring
                .set(HEALTH_KEYRING_SERVICE, account, &json)
                .is_ok()
            {
                return Ok(());
            }
        }

        let dir = self.tokens_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed creating health token dir: {e}"))?;
        let encrypted = Self::encrypt_bytes(json.as_bytes())?;
        std::fs::write(self.token_path(provider), encrypted)
            .map_err(|e| format!("Failed writing encrypted health token: {e}"))?;
        Ok(())
    }

    pub async fn get_token(
        &self,
        provider: HealthProviderId,
    ) -> Result<Option<HealthOAuthToken>, String> {
        let account = provider.as_str();
        if keychain_enabled() {
            if let Ok(json) = self.keyring.get(HEALTH_KEYRING_SERVICE, account) {
                let parsed: HealthOAuthToken = serde_json::from_str(&json)
                    .map_err(|e| format!("Failed parsing health token from keyring: {e}"))?;
                return Ok(Some(parsed));
            }
        }

        let path = self.token_path(provider);
        if !path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(&path).map_err(|e| format!("Failed reading token file: {e}"))?;
        let plaintext = Self::decrypt_bytes(&data)?;
        let json = String::from_utf8(plaintext)
            .map_err(|e| format!("Invalid UTF-8 token payload: {e}"))?;
        let token: HealthOAuthToken =
            serde_json::from_str(&json).map_err(|e| format!("Invalid token JSON: {e}"))?;
        Ok(Some(token))
    }

    pub async fn remove_token(&self, provider: HealthProviderId) -> Result<(), String> {
        if keychain_enabled() {
            let _ = self
                .keyring
                .delete(HEALTH_KEYRING_SERVICE, provider.as_str());
        }
        let path = self.token_path(provider);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed removing health token file: {e}"))?;
        }
        Ok(())
    }

    pub async fn remove_all_tokens(&self) -> Result<(), String> {
        for provider in [
            HealthProviderId::Oura,
            HealthProviderId::Whoop,
            HealthProviderId::GoogleHealth,
            HealthProviderId::Garmin,
            HealthProviderId::Polar,
            HealthProviderId::Withings,
            HealthProviderId::SamsungHealth,
            HealthProviderId::Suunto,
            HealthProviderId::Ultrahuman,
        ] {
            self.remove_token(provider).await?;
        }
        Ok(())
    }

    fn derive_machine_key(salt: &[u8]) -> [u8; 32] {
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_else(|_| "unknown".to_string());
        let host = hostname::get()
            .map(|h| h.into_string().unwrap_or_default())
            .unwrap_or_else(|_| "unknown".to_string());
        let secret = format!("plethora-health-token:{user}@{host}");
        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, 100_000, &mut key);
        key
    }

    fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key = Self::derive_machine_key(&salt);
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES init error: {e}"))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|e| format!("Token encryption failed: {e}"))?;
        let mut out = Vec::with_capacity(16 + 12 + ciphertext.len());
        out.extend_from_slice(&salt);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    fn decrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        if data.len() < 44 {
            return Err("Encrypted health token blob too short".to_string());
        }
        let salt = &data[..16];
        let nonce = Nonce::from_slice(&data[16..28]);
        let ciphertext = &data[28..];
        let key = Self::derive_machine_key(salt);
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES init error: {e}"))?;
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "Failed decrypting health token".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::keychain::force_keyring_for_tests;
    use crate::utils::keychain::testing::MemoryKeyring;

    #[test]
    fn debug_redacts_secrets() {
        let tok = HealthOAuthToken {
            access_token: "super_secret_access_123".to_string(),
            refresh_token: Some("super_secret_refresh_456".to_string()),
            expires_at_ms: Some(1_700_000_000_000),
            token_type: "Bearer".to_string(),
            scope: Some("sleep".to_string()),
            account_subject_hint: Some("sub_abc".to_string()),
        };
        let dbg = format!("{tok:?}");
        assert!(!dbg.contains("super_secret_access_123"));
        assert!(!dbg.contains("super_secret_refresh_456"));
        assert!(dbg.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn encrypted_fallback_and_keyring_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = HealthTokenStore::new(dir.path().to_path_buf());
        let tok = HealthOAuthToken {
            access_token: "tok-a".to_string(),
            refresh_token: Some("ref-b".to_string()),
            expires_at_ms: Some(9_999_999_999_999),
            token_type: "Bearer".to_string(),
            scope: Some("daily".to_string()),
            account_subject_hint: Some("u1".to_string()),
        };
        store
            .store_token(HealthProviderId::Oura, &tok)
            .await
            .unwrap();
        let loaded = store
            .get_token(HealthProviderId::Oura)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.access_token, "tok-a");
        assert_eq!(loaded.refresh_token.as_deref(), Some("ref-b"));

        // Verify disk blob is encrypted, not plaintext JSON
        let raw = std::fs::read(dir.path().join("tokens/oura.enc")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("tok-a"));

        store.remove_all_tokens().await.unwrap();
        assert!(store
            .get_token(HealthProviderId::Oura)
            .await
            .unwrap()
            .is_none());

        // Keyring path via MemoryKeyring
        let _guard = force_keyring_for_tests();
        let kr = MemoryKeyring::new();
        let kr_store = HealthTokenStore::with_keyring(dir.path().to_path_buf(), kr.clone());
        kr_store
            .store_token(HealthProviderId::Whoop, &tok)
            .await
            .unwrap();
        assert!(kr.contains(HEALTH_KEYRING_SERVICE, "whoop"));
        kr_store
            .remove_token(HealthProviderId::Whoop)
            .await
            .unwrap();
        assert!(!kr.contains(HEALTH_KEYRING_SERVICE, "whoop"));
    }
}
