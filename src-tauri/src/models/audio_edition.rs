use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudioEdition {
    pub id: String,
    pub source_document_id: String,
    pub source_revision_hash: String,
    pub provider: String,
    pub model: String,
    pub voice: String,
    pub quality_preset: Option<String>,
    pub generation_settings: Option<String>,
    pub total_duration_sec: f64,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudioEditionSection {
    pub id: String,
    pub edition_id: String,
    pub section_index: i32,
    pub title: String,
    pub source_section_id: Option<String>,
    pub source_start_anchor: Option<String>,
    pub source_end_anchor: Option<String>,
    pub character_count: i32,
    pub audio_file_path: Option<String>,
    pub audio_mime_type: String,
    pub duration_sec: f64,
    pub generation_status: String,
    pub failure_reason: Option<String>,
    pub retry_count: i32,
    pub cache_key: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudioEditionAnchor {
    pub id: String,
    pub section_id: String,
    pub audio_start_sec: f64,
    pub audio_end_sec: f64,
    pub source_start_anchor: String,
    pub source_end_anchor: String,
    pub text_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSession {
    pub id: String,
    pub edition_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_seconds: i32,
    pub extract_count: i32,
    pub is_reviewed: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSessionItem {
    pub id: String,
    pub session_id: String,
    pub extract_id: Option<String>,
    pub marker_type: String,
    pub audio_timestamp: f64,
    pub source_anchor: String,
    pub snippet_text: String,
    pub note: Option<String>,
    pub created_at: i64,
}

/// Partial update for a listening-session item. `None` = leave unchanged;
/// `Some(None)` on a nullable field = clear it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListeningSessionItemUpdate {
    pub extract_id: Option<Option<String>>,
    pub marker_type: Option<String>,
    pub audio_timestamp: Option<f64>,
    pub source_anchor: Option<String>,
    pub snippet_text: Option<String>,
    pub note: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEditionWithSections {
    #[serde(flatten)]
    pub edition: AudioEdition,
    pub sections: Vec<AudioEditionSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSessionWithItems {
    #[serde(flatten)]
    pub session: ListeningSession,
    pub items: Vec<ListeningSessionItem>,
}
