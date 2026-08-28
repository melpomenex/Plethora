use base64::Engine;
use crate::error::{PlethoraError, Result};
use crate::utils::keychain::keychain_enabled;

use super::crypto::SyncCrypto;

const SERVICE: &str = "plethora.sync";
const MASTER_KEY_ACCOUNT: &str = "master_key_v1";
const EPOCH_ACCOUNT: &str = "key_epoch_v1";
const RECOVERY_ACK_ACCOUNT: &str = "recovery_ack_v1";
const DEVICE_SECRET_ACCOUNT: &str = "device_secret_v1";

fn keyring_entry(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, account)
        .map_err(|e| PlethoraError::Internal(format!("sync keyring entry: {e}")))
}

async fn keyring_get(account: &str) -> Result<Option<String>> {
    if !keychain_enabled() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || {
        let entry = keyring_entry(account)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(PlethoraError::Internal(format!("sync keyring get: {e}"))),
        }
    })
    .await
    .map_err(|e| PlethoraError::Internal(format!("sync keyring get join: {e}")))?
}

async fn keyring_set(account: &str, value: &str) -> Result<()> {
    if !keychain_enabled() {
        return Ok(());
    }
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
}

pub async fn load_master_key() -> Result<Option<[u8; 32]>> {
    let Some(encoded) = keyring_get(MASTER_KEY_ACCOUNT).await? else {
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
    keyring_set(MASTER_KEY_ACCOUNT, &encoded).await
}

pub async fn store_master_key_from_recovery(recovery_key: &str) -> Result<[u8; 32]> {
    let master = SyncCrypto::derive_master_key(recovery_key);
    store_master_key(master).await?;
    Ok(master)
}

pub async fn get_key_epoch() -> Result<u32> {
    let Some(raw) = keyring_get(EPOCH_ACCOUNT).await? else {
        return Ok(1);
    };
    raw.parse::<u32>()
        .map_err(|e| PlethoraError::Internal(format!("Invalid sync key epoch: {e}")))
}

pub async fn set_key_epoch(epoch: u32) -> Result<()> {
    keyring_set(EPOCH_ACCOUNT, &epoch.to_string()).await
}

pub async fn increment_key_epoch() -> Result<u32> {
    let next = get_key_epoch().await?.saturating_add(1);
    set_key_epoch(next).await?;
    Ok(next)
}

pub async fn recovery_key_acknowledged() -> Result<bool> {
    Ok(keyring_get(RECOVERY_ACK_ACCOUNT).await?.is_some())
}

pub async fn mark_recovery_key_acknowledged() -> Result<()> {
    keyring_set(RECOVERY_ACK_ACCOUNT, "1").await
}

pub async fn load_device_secret() -> Result<x25519_dalek::StaticSecret> {
    if let Some(encoded) = keyring_get(DEVICE_SECRET_ACCOUNT).await? {
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
    keyring_set(DEVICE_SECRET_ACCOUNT, &encoded).await?;
    Ok(secret)
}

pub async fn device_public_key_b64() -> Result<String> {
    let secret = load_device_secret().await?;
    let public = x25519_dalek::PublicKey::from(&secret);
    Ok(base64::engine::general_purpose::STANDARD.encode(public.as_bytes()))
}
