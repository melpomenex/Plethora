use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

pub struct SyncCrypto;

impl SyncCrypto {
    /// Generates a random 32-byte recovery key represented as 12 hexadecimal words/tokens.
    pub fn generate_recovery_key() -> String {
        let mut bytes = [0u8; 32];
        use rand::RngCore;
        OsRng.fill_bytes(&mut bytes);
        hex::encode(bytes)
    }

    /// Derives a 32-byte master encryption key from the recovery key using SHA-256 HKDF-like domain separation.
    pub fn derive_master_key(recovery_key: &str) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"plethora-sync-master-key-v1:");
        hasher.update(recovery_key.as_bytes());
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        key
    }

    /// Encrypts plaintext JSON into base64 ciphertext with authenticated additional data (AAD).
    /// Format: base64(nonce [12 bytes] + ciphertext + tag [16 bytes])
    pub fn encrypt_payload(
        key: &[u8; 32],
        plaintext: &[u8],
        aad: &str,
    ) -> Result<String, String> {
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

    /// Decrypts base64 ciphertext with authenticated additional data (AAD).
    /// If AAD was tampered with or ciphertext was modified, decryption fails with an error.
    pub fn decrypt_payload(
        key: &[u8; 32],
        ciphertext_b64: &str,
        aad: &str,
    ) -> Result<Vec<u8>, String> {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_and_decryption_round_trip() {
        let recovery_key = SyncCrypto::generate_recovery_key();
        let key = SyncCrypto::derive_master_key(&recovery_key);

        let message = b"{\"title\":\"Confidential Research Notes\",\"tags\":[\"ai\",\"srs\"]}";
        let aad = "account-123:documents:doc-456:hlc-1";

        let encrypted = SyncCrypto::encrypt_payload(&key, message, aad).expect("encryption");
        assert_ne!(encrypted, "");

        let decrypted = SyncCrypto::decrypt_payload(&key, &encrypted, aad).expect("decryption");
        assert_eq!(decrypted, message);
    }

    #[test]
    fn test_tampered_aad_fails_authentication() {
        let recovery_key = SyncCrypto::generate_recovery_key();
        let key = SyncCrypto::derive_master_key(&recovery_key);

        let message = b"Secret payload";
        let aad_original = "account-123:documents:doc-456:hlc-1";
        let aad_tampered = "account-123:documents:doc-999:hlc-1";

        let encrypted = SyncCrypto::encrypt_payload(&key, message, aad_original).unwrap();
        let result = SyncCrypto::decrypt_payload(&key, &encrypted, aad_tampered);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let recovery_key = SyncCrypto::generate_recovery_key();
        let key = SyncCrypto::derive_master_key(&recovery_key);

        let message = b"Secret payload";
        let aad = "account-123:documents:doc-456:hlc-1";

        let encrypted = SyncCrypto::encrypt_payload(&key, message, aad).unwrap();
        let mut raw = base64::engine::general_purpose::STANDARD
            .decode(&encrypted)
            .unwrap();
        // Flip one byte in ciphertext
        if let Some(byte) = raw.last_mut() {
            *byte ^= 0xFF;
        }
        let tampered_b64 = base64::engine::general_purpose::STANDARD.encode(raw);

        let result = SyncCrypto::decrypt_payload(&key, &tampered_b64, aad);
        assert!(result.is_err());
    }
}
