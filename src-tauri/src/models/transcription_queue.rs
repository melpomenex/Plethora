//! Transcription queue model for auto-transcription of media documents.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionQueueEntry {
    pub id: String,
    pub document_id: String,
    /// Transcript chapter targeted by this job. Legacy/document-wide entries
    /// leave this unset and use `document_id` as the chapter key.
    pub chapter_id: Option<String>,
    pub audio_path: String,
    pub provider: String,
    pub model_id: String,
    pub language: String,
    pub status: TranscriptionJobStatus,
    pub error_message: Option<String>,
    pub priority: i32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub retry_count: i32,
    pub progress: i32,
    #[serde(default)]
    pub processed_duration_ms: i64,
    pub total_duration_ms: Option<i64>,
    #[serde(default = "default_transcription_mode")]
    pub transcription_mode: String,
}

fn default_transcription_mode() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionJobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

impl TranscriptionQueueEntry {
    pub fn new(
        document_id: String,
        audio_path: String,
        provider: String,
        model_id: String,
        language: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            document_id,
            chapter_id: None,
            audio_path,
            provider,
            model_id,
            language,
            status: TranscriptionJobStatus::Pending,
            error_message: None,
            priority: 0,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            retry_count: 0,
            progress: 0,
            processed_duration_ms: 0,
            total_duration_ms: None,
            transcription_mode: default_transcription_mode(),
        }
    }

    pub fn with_mode(mut self, mode: impl Into<String>) -> Self {
        self.transcription_mode = mode.into();
        self
    }

    pub fn transcript_chapter_id(&self) -> &str {
        self.chapter_id.as_deref().unwrap_or(&self.document_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionQueueEntryWithDoc {
    #[serde(flatten)]
    pub entry: TranscriptionQueueEntry,
    pub document_title: String,
}
