//! Durable practice attempts. Attempts are evidence records only; they never
//! call review rating or mutate a scheduler.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguagePracticeAttempt {
    pub id: String,
    pub profile_id: String,
    pub mode: String,
    pub status: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub source_anchor: Option<Value>,
    pub source_fingerprint: Option<String>,
    pub prompt_text: String,
    pub raw_response: Option<String>,
    pub normalized_response: Option<String>,
    pub comparison: Option<Value>,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub privacy_mode: String,
    pub retention_expires_at: Option<i64>,
    pub active_evidence_accepted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for LanguagePracticeAttempt {
    fn default() -> Self {
        Self {
            id: String::new(), profile_id: String::new(), mode: "dictation".into(), status: "prompted".into(),
            source_type: None, source_id: None, source_anchor: None, source_fingerprint: None,
            prompt_text: String::new(), raw_response: None, normalized_response: None,
            comparison: None, provider_id: None, provider_version: None,
            privacy_mode: "local-only".into(), retention_expires_at: None,
            active_evidence_accepted: false, created_at: 0, updated_at: 0,
        }
    }
}
