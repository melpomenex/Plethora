//! Provider-independent recording ownership DTOs. Media times are milliseconds.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecordingSession {
    /// A retained client UUID makes a retried creation idempotent.
    pub id: String,
    pub document_id: Option<String>,
    pub collection_id: Option<String>,
    pub title: String,
    pub origin: SessionOrigin,
    pub content_type: String,
    pub profile_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSessionPage {
    pub items: Vec<RecordingSession>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSegmentPage {
    pub items: Vec<SessionTranscriptSegment>,
    pub revision: i64,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionOperationError {
    pub code: &'static str,
    pub stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub retryable: bool,
    pub message_key: &'static str,
}

impl SessionOperationError {
    pub fn source_unavailable() -> Self {
        Self {
            code: "SourceUnavailable",
            stage: "ingestion",
            session_id: None,
            retryable: false,
            message_key: "recording.sourceUnavailable",
        }
    }

    pub fn stale() -> Self {
        Self {
            code: "StaleRevision",
            stage: "ingestion",
            session_id: None,
            retryable: true,
            message_key: "recording.staleRevision",
        }
    }

    pub fn stale_with_session(session_id: &str) -> Self {
        Self {
            code: "StaleRevision",
            stage: "ingestion",
            session_id: Some(session_id.to_string()),
            retryable: true,
            message_key: "recording.staleRevision",
        }
    }

    pub fn cancelled() -> Self {
        Self {
            code: "Cancelled",
            stage: "transcription",
            session_id: None,
            retryable: false,
            message_key: "recording.cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptSegmentInput {
    pub segment_key: String,
    pub ordinal: i64,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub text: String,
    pub confidence: Option<f64>,
    pub words_json: Option<String>,
    pub speaker_id: Option<String>,
    pub timing_kind: String,
    pub revision: i64,
    pub metadata_json: Option<String>,
}

impl From<sqlx::Error> for SessionOperationError {
    fn from(error: sqlx::Error) -> Self {
        let full = error.as_database_error().and_then(|e| e.code()).as_deref() == Some("13");
        Self {
            code: if full {
                "StorageFull"
            } else {
                "StorageUnavailable"
            },
            stage: "ingestion",
            session_id: None,
            retryable: true,
            message_key: if full {
                "recording.storageFull"
            } else {
                "recording.storageUnavailable"
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingState {
    Idle,
    RequestingPermission,
    Recording,
    Paused,
    Interrupted,
    Finalizing,
    Saved,
    Recoverable,
    Failed,
    Discarded,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionOrigin {
    Recorded,
    File,
    Transcript,
    Url,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SessionContentType {
    Lecture,
    Meeting,
    Seminar,
    Interview,
    Presentation,
    Podcast,
    VoiceNote,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionIngestionState {
    Staging,
    Saved,
    Partial,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaAssetKind {
    Original,
    Capture,
    Derived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaAssetState {
    Staging,
    Ready,
    Partial,
    Missing,
    Deleting,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSession {
    pub id: String,
    pub document_id: String,
    pub origin: SessionOrigin,
    pub content_type: SessionContentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_content_type: Option<String>,
    pub profile_json: String,
    pub capture_state: RecordingState,
    pub ingestion_state: SessionIngestionState,
    pub transcript_id: Option<i64>,
    pub media_asset_id: Option<String>,
    pub transcript_revision: i64,
    pub overview_json: Option<String>,
    pub overview_revision: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMediaAsset {
    pub id: String,
    pub session_id: String,
    pub kind: MediaAssetKind,
    pub relative_path: String,
    pub mime: String,
    pub byte_length: i64,
    pub sha256: Option<String>,
    pub duration_ms: Option<i64>,
    pub state: MediaAssetState,
    pub source_url: Option<String>,
    pub source_adapter: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingPart {
    pub asset_id: String,
    pub writer_epoch: String,
    pub sequence: i64,
    pub relative_path: String,
    pub byte_length: i64,
    pub sha256: String,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub format_json: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum SessionTranscriptTiming {
    Measured {
        #[serde(rename = "startMs")]
        start_ms: i64,
        #[serde(rename = "endMs")]
        end_ms: i64,
    },
    Imported {
        #[serde(rename = "startMs")]
        start_ms: i64,
        #[serde(rename = "endMs")]
        end_ms: i64,
    },
    None {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionTimingSource {
    Measured,
    Imported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptWord {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub source: SessionTimingSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptSegment {
    pub segment_key: String,
    pub transcript_id: i64,
    pub ordinal: i64,
    pub revision: i64,
    pub text: String,
    pub timing: SessionTranscriptTiming,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<SessionTranscriptWord>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMarkerKind {
    Interesting,
    Confusing,
    RecentExtract,
    CardCandidate,
    Bookmark,
}

impl SessionMarkerKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Interesting => "interesting",
            Self::Confusing => "confusing",
            Self::RecentExtract => "recent-extract",
            Self::CardCandidate => "card-candidate",
            Self::Bookmark => "bookmark",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "interesting" => Some(Self::Interesting),
            "confusing" => Some(Self::Confusing),
            "recent-extract" => Some(Self::RecentExtract),
            "card-candidate" => Some(Self::CardCandidate),
            "bookmark" => Some(Self::Bookmark),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMarkerState {
    Pending,
    Resolved,
    NeedsConfirmation,
}

impl SessionMarkerState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Resolved => "resolved",
            Self::NeedsConfirmation => "needs-confirmation",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "resolved" => Some(Self::Resolved),
            "needs-confirmation" => Some(Self::NeedsConfirmation),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSessionMarker {
    pub id: String,
    pub session_id: String,
    pub kind: SessionMarkerKind,
    pub media_ms: i64,
    pub window_ms: i64,
    pub part_sequence: Option<i64>,
    pub note: Option<String>,
    pub evidence: Option<Vec<serde_json::Value>>,
    pub state: SessionMarkerState,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDocumentPrivacy {
    pub is_local_only: bool,
    pub is_ai_excluded: bool,
    pub privacy_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAnalysisRun {
    pub id: String,
    pub session_id: String,
    pub transcript_revision: i64,
    pub profile_hash: String,
    pub task_version: String,
    pub generation_epoch: String,
    pub status: String,
    pub blocked_reason: Option<String>,
    pub completed_units: i64,
    pub total_units: i64,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionAnalysisRun {
    pub id: String,
    pub session_id: String,
    pub transcript_revision: i64,
    pub profile_hash: String,
    pub task_version: String,
    pub generation_epoch: String,
    pub total_units: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAnalysisUnit {
    pub run_id: String,
    pub unit_key: String,
    pub input_hash: String,
    pub segment_keys_json: String,
    pub status: String,
    pub result_json: Option<String>,
    pub attempts: i64,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSessionAnalysisUnit {
    pub run_id: String,
    pub unit_key: String,
    pub input_hash: String,
    pub segment_keys_json: String,
    pub status: String,
    pub result_json: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLearningDraft {
    pub id: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub revision: i64,
    pub payload_json: String,
    pub evidence_json: String,
    pub content_hash: String,
    pub concept_key: Option<String>,
    pub duplicate_json: Option<String>,
    pub accepted_target_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionLearningDraft {
    pub id: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub kind: String,
    pub status: Option<String>,
    pub payload_json: String,
    pub evidence_json: String,
    pub content_hash: String,
    pub concept_key: Option<String>,
    pub duplicate_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionLearningDraft {
    pub id: String,
    pub expected_revision: i64,
    pub payload_json: Option<String>,
    pub status: Option<String>,
    pub duplicate_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLearningDraftPage {
    pub items: Vec<SessionLearningDraft>,
    pub next_cursor: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSessionDraftSpec {
    pub draft_id: String,
    pub expected_revision: i64,
    pub duplicate_decision: Option<String>,
    pub duplicate_target_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSessionDraftsInput {
    pub session_id: String,
    pub items: Vec<AcceptSessionDraftSpec>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub all_or_nothing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSessionDraftResult {
    pub draft_id: String,
    pub success: bool,
    pub target_id: Option<String>,
    pub target_kind: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionMediaResult {
    pub session_id: String,
    pub version: i64,
    pub deleted_assets_count: usize,
    pub transcript_preserved: bool,
    pub cards_preserved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRecordingSessionResult {
    pub session_id: String,
    pub deleted: bool,
    pub accepted_cards_retained: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupJournalResult {
    pub cleaned_count: usize,
    pub failed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSessionDraftsResponse {
    pub results: Vec<AcceptSessionDraftResult>,
    pub accepted_count: usize,
    pub failed_count: usize,
}

impl std::fmt::Display for SessionOperationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}:{}", self.stage, self.code, self.message_key)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRelatedDocument {
    pub id: String,
    pub title: String,
    pub file_type: String,
    pub is_local_only: bool,
    pub is_ai_excluded: bool,
    pub is_available: bool,
}

impl std::error::Error for SessionOperationError {}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_canonical_segment_contract_matches_committed_typescript_fixture() {
        let input: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/recording-sessions/transcript.json"
        ))
        .unwrap();
        let segments: Vec<SessionTranscriptSegment> =
            serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(&segments).unwrap(), input);
        assert_eq!(
            segments.last().unwrap().timing,
            SessionTranscriptTiming::None {}
        );
        assert!(serde_json::from_str::<SessionTranscriptTiming>(
            r#"{"kind":"none","startMs":0,"endMs":0}"#
        )
        .is_err());
    }

    #[test]
    fn recording_wire_enums_match_frontend_contract() {
        assert_eq!(
            serde_json::to_string(&RecordingState::RequestingPermission).unwrap(),
            "\"requesting-permission\""
        );
        assert_eq!(
            serde_json::to_string(&SessionContentType::VoiceNote).unwrap(),
            "\"voice-note\""
        );
        assert_eq!(
            serde_json::to_string(&SessionMarkerState::NeedsConfirmation).unwrap(),
            "\"needs-confirmation\""
        );
        assert_eq!(
            serde_json::from_str::<SessionContentType>("\"future-profile\"").unwrap(),
            SessionContentType::Other
        );
        assert!(serde_json::from_str::<RecordingState>("\"pretend-saved\"").is_err());
    }
}
