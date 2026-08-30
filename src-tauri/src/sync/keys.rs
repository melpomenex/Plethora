use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Nonce,
};
use base64::Engine;
use once_cell::sync::OnceCell;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::error::{PlethoraError, Result};
use crate::utils::keychain::keychain_enabled;

use super::crypto::SyncCrypto;

const SERVICE: &str = "plethora.sync";
const MASTER_KEY_ACCOUNT: &str = "master_key_v1";
const EPOCH_ACCOUNT: &str = "key_epoch_v1";
const RECOVERY_ACK_ACCOUNT: &str = "recovery_ack_v1";
const DEVICE_SECRET_ACCOUNT: &str = "device_secret_v1";
const SYNC_KEYS_DIR: &str = "sync_keys";

static APP_DATA_DIR: OnceCell<PathBuf> = OnceCell::new();

pub fn init_storage(app_data_dir: PathBuf) {
    let _ = APP_DATA_DIR.set(app_data_dir);
}

fn storage_root() -> Result<PathBuf> {
    APP_DATA_DIR
        .get()
        .cloned()
        .ok_or_else(|| PlethoraError::Internal("Sync key storage is not initialized".into()))
}

fn keyring_entry(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, account)
        .map_err(|e| PlethoraError::Internal(format!("sync keyring entry: {e}")))
}

fn keys_dir() -> Result<PathBuf> {
    Ok(storage_root()?.join(SYNC_KEYS_DIR))
}

fn file_path(account: &str) -> Result<PathBuf> {
    Ok(keys_dir()?.join(format!("{account}.enc")))
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

fn derive_machine_key_with_salt(salt: &[u8]) -> Result<[u8; 32]> {
    let password = format!("{}:{}", whoami_username(), user_id());
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 100_000, &mut key);
    Ok(key)
}

fn encrypt_file(account: &str, plaintext: &[u8]) -> Result<()> {
    let dir = keys_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| {
        PlethoraError::Internal(format!("Failed to create sync_keys dir {}: {e}", dir.display()))
    })?;

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_machine_key_with_salt(&salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| PlethoraError::Internal(format!("AES init: {e}")))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| PlethoraError::Internal(format!("Sync key encryption failed: {e}")))?;

    let mut out = Vec::with_capacity(16 + 12 + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    let path = file_path(account)?;
    std::fs::write(&path, &out).map_err(|e| {
        PlethoraError::Internal(format!("Failed to write sync key file {}: {e}", path.display()))
    })?;
    Ok(())
}

fn decrypt_file(account: &str) -> Result<Option<Vec<u8>>> {
    let path = file_path(account)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read(&path).map_err(|e| {
        PlethoraError::Internal(format!("Failed to read sync key file {}: {e}", path.display()))
    })?;
    if data.len() < 28 {
        return Err(PlethoraError::Internal(
            "Encrypted sync key file is too short".into(),
        ));
    }
    let salt = &data[..16];
    let nonce = Nonce::from_slice(&data[16..28]);
    let ciphertext = &data[28..];
    let key = derive_machine_key_with_salt(salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| PlethoraError::Internal(format!("AES init: {e}")))?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| {
            PlethoraError::Internal(
                "Failed to decrypt sync key file; credentials may be from another machine".into(),
            )
        })?;
    Ok(Some(plaintext))
}

async fn persist_secret(account: &str, value: &str) -> Result<()> {
    if keychain_enabled() {
        let account = account.to_string();
        let value = value.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = keyring_entry(&account)?;
            entry
                .set_password(&value)
                .map_err(|e| PlethoraError::Internal(format!("sync keyring set: {e}")))
        })
        .await
        .map_err(|e| PlethoraError::Internal(format!("sync keyring set join: {e}")))?
    } else {
        encrypt_file(account, value.as_bytes())
    }
}

async fn delete_secret(account: &str) -> Result<()> {
    if keychain_enabled() {
        let account = account.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = keyring_entry(&account)?;
            match entry.delete_credential() {
                Ok(()) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(PlethoraError::Internal(format!("sync keyring delete: {e}"))),
            }
        })
        .await
        .map_err(|e| PlethoraError::Internal(format!("sync keyring delete join: {e}")))?
    } else {
        let path = file_path(account)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| {
                PlethoraError::Internal(format!(
                    "Failed to delete sync key file {}: {e}",
                    path.display()
                ))
            })?;
        }
        Ok(())
    }
}

async fn load_secret(account: &str) -> Result<Option<String>> {
    if keychain_enabled() {
        let account = account.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = keyring_entry(&account)?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(PlethoraError::Internal(format!("sync keyring get: {e}"))),
            }
        })
        .await
        .map_err(|e| PlethoraError::Internal(format!("sync keyring get join: {e}")))?
    } else {
        Ok(decrypt_file(account)?
            .map(|bytes| String::from_utf8(bytes))
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync key file invalid UTF-8: {e}")))?)
    }
}

pub async fn load_master_key() -> Result<Option<[u8; 32]>> {
    let Some(encoded) = load_secret(MASTER_KEY_ACCOUNT).await? else {
        return Ok(None);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|e| PlethoraError::Internal(format!("sync master key decode: {e}")))?;
    if bytes.len() != 32 {
        return Err(PlethoraError::Internal(
            "Stored sync master key has invalid length".into(),
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(Some(key))
}

pub async fn store_master_key(master: [u8; 32]) -> Result<()> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(master);
    persist_secret(MASTER_KEY_ACCOUNT, &encoded).await?;
    load_master_key()
        .await?
        .ok_or_else(|| PlethoraError::Internal("Failed to verify stored sync master key".into()))?;
    Ok(())
}

pub async fn store_master_key_from_recovery(recovery_key: &str) -> Result<[u8; 32]> {
    let normalized = SyncCrypto::normalize_recovery_key(recovery_key)
        .map_err(PlethoraError::InvalidInput)?;
    let master = SyncCrypto::derive_master_key(&normalized);
    store_master_key(master).await?;
    Ok(master)
}

pub async fn get_key_epoch() -> Result<u32> {
    let Some(raw) = load_secret(EPOCH_ACCOUNT).await? else {
        return Ok(1);
    };
    raw.parse::<u32>()
        .map_err(|e| PlethoraError::Internal(format!("Invalid sync key epoch: {e}")))
}

pub async fn set_key_epoch(epoch: u32) -> Result<()> {
    persist_secret(EPOCH_ACCOUNT, &epoch.to_string()).await
}

pub async fn increment_key_epoch() -> Result<u32> {
    let next = get_key_epoch().await?.saturating_add(1);
    set_key_epoch(next).await?;
    Ok(next)
}

pub async fn recovery_key_acknowledged() -> Result<bool> {
    Ok(load_secret(RECOVERY_ACK_ACCOUNT).await?.is_some())
}

pub async fn mark_recovery_key_acknowledged() -> Result<()> {
    persist_secret(RECOVERY_ACK_ACCOUNT, "1").await
}

pub async fn clear_recovery_acknowledgement() -> Result<()> {
    delete_secret(RECOVERY_ACK_ACCOUNT).await
}

pub async fn load_device_secret() -> Result<x25519_dalek::StaticSecret> {
    if let Some(encoded) = load_secret(DEVICE_SECRET_ACCOUNT).await? {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|e| PlethoraError::Internal(format!("device secret decode: {e}")))?;
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return Ok(x25519_dalek::StaticSecret::from(arr));
        }
    }
    let secret = x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng);
    let encoded = base64::engine::general_purpose::STANDARD.encode(secret.to_bytes());
    persist_secret(DEVICE_SECRET_ACCOUNT, &encoded).await?;
    Ok(secret)
}

pub async fn device_public_key_b64() -> Result<String> {
    let secret = load_device_secret().await?;
    let public = x25519_dalek::PublicKey::from(&secret);
    Ok(base64::engine::general_purpose::STANDARD.encode(public.as_bytes()))
}

static PAIRING_SESSION: Mutex<Option<(String, Instant)>> = Mutex::new(None);
const PAIRING_TTL: Duration = Duration::from_secs(600);

pub fn begin_pairing_session(code: String) {
    if let Ok(mut guard) = PAIRING_SESSION.lock() {
        *guard = Some((code, Instant::now()));
    }
}

pub fn verify_pairing_session(code: &str) -> bool {
    let Ok(guard) = PAIRING_SESSION.lock() else {
        return false;
    };
    let Some((stored, started)) = guard.as_ref() else {
        return false;
    };
    if started.elapsed() > PAIRING_TTL {
        return false;
    }
    stored == code
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_DIR_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn ensure_test_storage() -> PathBuf {
        let n = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("plethora-sync-keys-test-{n}"));
        let _ = std::fs::create_dir_all(&dir);
        let _ = init_storage(dir.clone());
        dir
    }

    #[tokio::test]
    async fn clear_recovery_acknowledgement_does_not_remove_master_key() {
        let dir = ensure_test_storage();
        let recovery_key = SyncCrypto::generate_recovery_key();
        let master = store_master_key_from_recovery(&recovery_key)
            .await
            .expect("store master key");
        mark_recovery_key_acknowledged()
            .await
            .expect("mark acknowledged");

        assert!(recovery_key_acknowledged().await.expect("ack check"));
        assert!(load_master_key().await.expect("load master").is_some());

        clear_recovery_acknowledgement()
            .await
            .expect("clear acknowledgement");

        assert!(!recovery_key_acknowledged().await.expect("ack cleared"));
        let loaded = load_master_key()
            .await
            .expect("load master after clear")
            .expect("master key still present");
        assert_eq!(loaded, master);

        let _ = std::fs::remove_dir_all(dir);
    }
}
