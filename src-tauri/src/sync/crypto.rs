use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub struct SyncCrypto;

impl SyncCrypto {
    /// Generates a random 32-byte recovery key represented as hex.
    pub fn generate_recovery_key() -> String {
        let mut bytes = [0u8; 32];
        use rand::RngCore;
        OsRng.fill_bytes(&mut bytes);
        hex::encode(bytes)
    }

    /// Canonicalize user-entered recovery keys. The displayed form contains
    /// separators for readability, but separators/whitespace must never alter
    /// the derived account key.
    pub fn normalize_recovery_key(recovery_key: &str) -> Result<String, String> {
        let normalized: String = recovery_key
            .chars()
            .filter(|ch| !ch.is_whitespace() && *ch != '-')
            .flat_map(char::to_lowercase)
            .collect();
        if normalized.len() != 64 || !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Err("Recovery key must contain exactly 64 hexadecimal characters".into());
        }
        Ok(normalized)
    }

    /// User-facing grouped recovery key (4 × 16 hex chars).
    pub fn format_recovery_key_display(recovery_key: &str) -> String {
        let normalized: String = recovery_key
            .chars()
            .filter(|ch| !ch.is_whitespace() && *ch != '-')
            .collect();
        normalized
            .as_bytes()
            .chunks(16)
            .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
            .collect::<Vec<_>>()
            .join("-")
    }

    /// Derives the account master key from the recovery key (HKDF-SHA256).
    pub fn derive_master_key(recovery_key: &str) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(Some(b"plethora-sync-master-v1"), recovery_key.as_bytes());
        let mut okm = [0u8; 32];
        hk.expand(b"master", &mut okm)
            .expect("32-byte HKDF expand must succeed");
        okm
    }

    /// Per-record content key scoped by epoch + entity identity.
    pub fn derive_record_key(
        master_key: &[u8; 32],
        epoch: u32,
        entity_type: &str,
        entity_id: &str,
        change_id: &str,
    ) -> [u8; 32] {
        let mut info = Vec::with_capacity(64 + entity_type.len() + entity_id.len() + change_id.len());
        info.extend_from_slice(b"plethora-sync-record-v1:");
        info.extend_from_slice(&epoch.to_be_bytes());
        info.extend_from_slice(entity_type.as_bytes());
        info.push(b':');
        info.extend_from_slice(entity_id.as_bytes());
        info.push(b':');
        info.extend_from_slice(change_id.as_bytes());
        let hk = Hkdf::<Sha256>::new(Some(b"plethora-sync-record"), master_key);
        let mut okm = [0u8; 32];
        hk.expand(&info, &mut okm)
            .expect("32-byte HKDF expand must succeed");
        okm
    }

    pub fn build_aad(
        account_id: &str,
        entity_type: &str,
        entity_id: &str,
        change_id: &str,
        epoch: u32,
    ) -> String {
        format!("{account_id}:{entity_type}:{entity_id}:{change_id}:{epoch}")
    }

    /// Encrypts plaintext JSON into base64 ciphertext with authenticated additional data (AAD).
    pub fn encrypt_payload(key: &[u8; 32], plaintext: &[u8], aad: &str) -> Result<String, String> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let payload = Payload {
            msg: plaintext,
            aad: aad.as_bytes(),
        };
        let ciphertext = cipher
            .encrypt(&nonce, payload)
            .map_err(|e| format!("Encryption failed: {}", e))?;
        let mut combined = Vec::with_capacity(nonce.len() + ciphertext.len());
        combined.extend_from_slice(&nonce);
        combined.extend_from_slice(&ciphertext);
        Ok(base64::engine::general_purpose::STANDARD.encode(combined))
    }

    pub fn decrypt_payload(key: &[u8; 32], ciphertext_b64: &str, aad: &str) -> Result<Vec<u8>, String> {
        let combined = base64::engine::general_purpose::STANDARD
            .decode(ciphertext_b64)
            .map_err(|e| format!("Invalid base64: {}", e))?;
        if combined.len() < 12 + 16 {
            return Err("Ciphertext too short".to_string());
        }
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let payload = Payload {
            msg: ciphertext,
            aad: aad.as_bytes(),
        };
        cipher
            .decrypt(nonce, payload)
            .map_err(|e| format!("Decryption / authenticity verification failed: {}", e))
    }

    /// Stable, account-secret identifier for a plaintext blob. Unlike a raw
    /// SHA-256 this does not reveal cross-account equality or permit offline
    /// guessing of common files by the storage service.
    pub fn blob_reference(master_key: &[u8; 32], plaintext: &[u8]) -> String {
        let digest = Sha256::digest(plaintext);
        let hk = Hkdf::<Sha256>::new(Some(b"plethora-sync-blob-id-v1"), master_key);
        let mut opaque = [0u8; 32];
        hk.expand(&digest, &mut opaque)
            .expect("32-byte HKDF expand must succeed");
        format!("b1:{}", hex::encode(opaque))
    }

    fn derive_blob_key(master_key: &[u8; 32], blob_reference: &str) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(Some(b"plethora-sync-blob-key-v1"), master_key);
        let mut key = [0u8; 32];
        hk.expand(blob_reference.as_bytes(), &mut key)
            .expect("32-byte HKDF expand must succeed");
        key
    }

    /// Encrypt a binary blob client-side. The returned bytes are
    /// nonce || AES-GCM ciphertext+tag and are safe to place in object storage.
    pub fn encrypt_blob(
        master_key: &[u8; 32],
        plaintext: &[u8],
    ) -> Result<(String, Vec<u8>), String> {
        let blob_reference = Self::blob_reference(master_key, plaintext);
        let key = Self::derive_blob_key(master_key, &blob_reference);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create blob cipher: {e}"))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: blob_reference.as_bytes(),
                },
            )
            .map_err(|e| format!("Blob encryption failed: {e}"))?;
        let mut out = Vec::with_capacity(nonce.len() + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok((blob_reference, out))
    }

    pub fn decrypt_blob(
        master_key: &[u8; 32],
        blob_reference: &str,
        encrypted: &[u8],
    ) -> Result<Vec<u8>, String> {
        if encrypted.len() < 12 + 16 {
            return Err("Encrypted blob is too short".into());
        }
        let key = Self::derive_blob_key(master_key, blob_reference);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create blob cipher: {e}"))?;
        let (nonce_bytes, ciphertext) = encrypted.split_at(12);
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(nonce_bytes),
                Payload {
                    msg: ciphertext,
                    aad: blob_reference.as_bytes(),
                },
            )
            .map_err(|_| "Blob decryption / authenticity verification failed".to_string())?;
        if Self::blob_reference(master_key, &plaintext) != blob_reference {
            return Err("Blob identity verification failed".into());
        }
        Ok(plaintext)
    }

    /// Wrap the master key for a paired device using X25519 + AES-GCM.
    pub fn wrap_master_key_for_peer(
        local_secret: &StaticSecret,
        peer_public_b64: &str,
        master_key: &[u8; 32],
        pairing_code: &str,
    ) -> Result<String, String> {
        let peer_bytes = base64::engine::general_purpose::STANDARD
            .decode(peer_public_b64.as_bytes())
            .map_err(|e| format!("Invalid peer public key: {e}"))?;
        if peer_bytes.len() != 32 {
            return Err("Peer public key must be 32 bytes".into());
        }
        if peer_bytes.len() != 32 {
            return Err("Peer public key must be 32 bytes".into());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&peer_bytes);
        let peer_public = PublicKey::from(arr);
        let shared = local_secret.diffie_hellman(&peer_public);
        let wrap_key = Self::derive_wrap_key(shared.as_bytes(), pairing_code);
        Self::encrypt_payload(&wrap_key, master_key, pairing_code)
    }

    pub fn unwrap_master_key_from_peer(
        local_secret: &StaticSecret,
        peer_public_b64: &str,
        wrapped_b64: &str,
        pairing_code: &str,
    ) -> Result<[u8; 32], String> {
        let peer_bytes = base64::engine::general_purpose::STANDARD
            .decode(peer_public_b64.as_bytes())
            .map_err(|e| format!("Invalid peer public key: {e}"))?;
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&peer_bytes);
        let peer_public = PublicKey::from(arr);
        let shared = local_secret.diffie_hellman(&peer_public);
        let wrap_key = Self::derive_wrap_key(shared.as_bytes(), pairing_code);
        let bytes = Self::decrypt_payload(&wrap_key, wrapped_b64, pairing_code)?;
        if bytes.len() != 32 {
            return Err("Wrapped master key has invalid length".into());
        }
        let mut master = [0u8; 32];
        master.copy_from_slice(&bytes);
        Ok(master)
    }

    fn derive_wrap_key(shared_secret: &[u8], pairing_code: &str) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(Some(b"plethora-sync-pair-v1"), shared_secret);
        let mut okm = [0u8; 32];
        hk.expand(pairing_code.as_bytes(), &mut okm)
            .expect("32-byte HKDF expand must succeed");
        okm
    }

    pub fn generate_pairing_code() -> String {
        use rand::Rng;
        format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
    }

    #[allow(dead_code)]
    pub fn pairing_code_from_public_key(public_key_b64: &str) -> String {
        let digest = Sha256::digest(public_key_b64.as_bytes());
        format!("{:06}", u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_and_decryption_round_trip() {
        let recovery_key = SyncCrypto::generate_recovery_key();
        let key = SyncCrypto::derive_master_key(&recovery_key);
        let record_key = SyncCrypto::derive_record_key(&key, 1, "learning_item", "item-1", "change-1");
        let message = b"{\"title\":\"Confidential Research Notes\",\"tags\":[\"ai\",\"srs\"]}";
        let aad = SyncCrypto::build_aad("acct", "learning_item", "item-1", "change-1", 1);
        let encrypted = SyncCrypto::encrypt_payload(&record_key, message, &aad).expect("encryption");
        let decrypted = SyncCrypto::decrypt_payload(&record_key, &encrypted, &aad).expect("decryption");
        assert_eq!(decrypted, message);
    }

    #[test]
    fn test_tampered_aad_fails_authentication() {
        let key = SyncCrypto::derive_master_key("test-recovery-key");
        let record_key = SyncCrypto::derive_record_key(&key, 1, "documents", "doc-456", "change-1");
        let message = b"Secret payload";
        let aad_original = SyncCrypto::build_aad("acct", "documents", "doc-456", "change-1", 1);
        let aad_tampered = SyncCrypto::build_aad("acct", "documents", "doc-999", "change-1", 1);
        let encrypted = SyncCrypto::encrypt_payload(&record_key, message, &aad_original).unwrap();
        let result = SyncCrypto::decrypt_payload(&record_key, &encrypted, &aad_tampered);
        assert!(result.is_err());
    }

    #[test]
    fn blob_encryption_is_private_deduplicated_and_authenticated() {
        let master = SyncCrypto::derive_master_key("blob-test-master");
        let plaintext = b"same private document bytes";
        let (reference_a, encrypted_a) = SyncCrypto::encrypt_blob(&master, plaintext).unwrap();
        let (reference_b, encrypted_b) = SyncCrypto::encrypt_blob(&master, plaintext).unwrap();

        assert_eq!(reference_a, reference_b, "same account/content dedupes");
        assert_ne!(encrypted_a, encrypted_b, "random nonces hide ciphertext equality");
        assert!(!reference_a.contains(&hex::encode(Sha256::digest(plaintext))));
        assert_eq!(
            SyncCrypto::decrypt_blob(&master, &reference_a, &encrypted_a).unwrap(),
            plaintext
        );

        let mut tampered = encrypted_a;
        *tampered.last_mut().unwrap() ^= 1;
        assert!(SyncCrypto::decrypt_blob(&master, &reference_a, &tampered).is_err());
    }

    #[test]
    fn pairing_wrap_unwrap_round_trip() {
        let local = StaticSecret::random_from_rng(OsRng);
        let peer = StaticSecret::random_from_rng(OsRng);
        let local_public = base64::engine::general_purpose::STANDARD.encode(PublicKey::from(&local).as_bytes());
        let peer_public = base64::engine::general_purpose::STANDARD.encode(PublicKey::from(&peer).as_bytes());
        let master = SyncCrypto::derive_master_key("pairing-test-key");
        let code = SyncCrypto::generate_pairing_code();
        let wrapped = SyncCrypto::wrap_master_key_for_peer(&local, &peer_public, &master, &code).unwrap();
        let restored =
            SyncCrypto::unwrap_master_key_from_peer(&peer, &local_public, &wrapped, &code).unwrap();
        assert_eq!(restored, master);
    }

    #[test]
    fn epoch_rotation_changes_record_key() {
        let master = SyncCrypto::derive_master_key("epoch-test");
        let k1 = SyncCrypto::derive_record_key(&master, 1, "learning_item", "a", "c1");
        let k2 = SyncCrypto::derive_record_key(&master, 2, "learning_item", "a", "c1");
        assert_ne!(k1, k2);
    }
}
