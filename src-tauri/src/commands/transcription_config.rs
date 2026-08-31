use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::Repository;
use crate::error::Result;

pub const TRANSCRIPTION_CONFIG_KEY: &str = "transcription_config";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptionConfig {
    pub provider: String,
    pub preferred_model_id: Option<String>,
    pub language: String,
    #[serde(default)]
    pub compute_mode: Option<String>,
    #[serde(default)]
    pub device_id: Option<u32>,
}

pub async fn read_transcription_config(repo: &Repository) -> Option<TranscriptionConfig> {
    repo.get_setting(TRANSCRIPTION_CONFIG_KEY)
        .await
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

#[tauri::command]
pub async fn get_transcription_config(
    repo: State<'_, Repository>,
) -> Result<Option<TranscriptionConfig>> {
    Ok(read_transcription_config(repo.inner()).await)
}

#[tauri::command]
pub async fn set_transcription_config(
    config: TranscriptionConfig,
    repo: State<'_, Repository>,
) -> Result<()> {
    let json = serde_json::to_string(&config)?;
    repo.set_setting(TRANSCRIPTION_CONFIG_KEY, &json).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_json_excludes_secrets() {
        let json = serde_json::to_string(&TranscriptionConfig {
            provider: "local".into(),
            preferred_model_id: Some("parakeet-tdt-ctc-110m".into()),
            language: "en".into(),
            compute_mode: None,
            device_id: None,
        })
        .unwrap();
        assert!(json.contains("preferred_model_id"));
        assert!(!json.to_lowercase().contains("key"));
    }
}
