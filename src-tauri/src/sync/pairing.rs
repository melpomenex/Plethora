use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};

use std::time::{Duration, Instant};

use super::crypto::SyncCrypto;
use super::keys::{
    begin_pairing_session, load_device_secret, load_master_key, store_master_key,
    verify_pairing_session,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub public_key_b64: String,
    pub pairing_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingAcceptRequest {
    pub peer_public_key_b64: String,
    pub wrapped_master_key_b64: String,
    pub pairing_code: String,
}

pub async fn begin_pairing() -> Result<PairingOffer> {
    let secret = load_device_secret().await?;
    let public = x25519_dalek::PublicKey::from(&secret);
    let public_key_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        public.as_bytes(),
    );
    Ok(PairingOffer {
        pairing_code: {
            let code = SyncCrypto::generate_pairing_code();
            begin_pairing_session(code.clone());
            code
        },
        public_key_b64,
    })
}

pub async fn accept_pairing(request: PairingAcceptRequest) -> Result<()> {
    let local_secret = load_device_secret().await?;
    let master = SyncCrypto::unwrap_master_key_from_peer(
        &local_secret,
        &request.peer_public_key_b64,
        &request.wrapped_master_key_b64,
        &request.pairing_code,
    )
    .map_err(|e| PlethoraError::Internal(format!("Pairing unwrap failed: {e}")))?;
    store_master_key(master).await?;
    Ok(())
}

pub async fn export_pairing_bundle(
    peer_public_key_b64: &str,
    pairing_code: &str,
) -> Result<PairingAcceptRequest> {
    if !verify_pairing_session(pairing_code) {
        return Err(PlethoraError::Internal(
            "Pairing code expired or invalid. Start pairing again.".into(),
        ));
    }
    let local_secret = load_device_secret().await?;
    let master = load_master_key()
        .await?
        .ok_or_else(|| PlethoraError::Internal("Master sync key not initialized".into()))?;
    let wrapped_master_key_b64 = SyncCrypto::wrap_master_key_for_peer(
        &local_secret,
        peer_public_key_b64,
        &master,
        pairing_code,
    )
    .map_err(|e| PlethoraError::Internal(format!("Pairing wrap failed: {e}")))?;
    Ok(PairingAcceptRequest {
        peer_public_key_b64: peer_public_key_b64.to_string(),
        wrapped_master_key_b64,
        pairing_code: pairing_code.to_string(),
    })
}
