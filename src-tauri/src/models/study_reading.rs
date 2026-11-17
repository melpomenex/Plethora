use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudyReadingFormat {
    Epub,
    Pdf,
    Html,
    Markdown,
}

impl StudyReadingFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "epub",
            Self::Pdf => "pdf",
            Self::Html => "html",
            Self::Markdown => "markdown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingQuote {
    pub exact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingSegment {
    pub quote: StudyReadingQuote,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spine_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingChunk {
    pub chunk_id: String,
    pub text: String,
    pub position: crate::ai_learning::models::ChunkLocation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingAssignment {
    pub schema_version: u32,
    pub id: String,
    pub topic_id: String,
    pub document_id: String,
    pub document_title: String,
    pub document_revision: String,
    pub format: StudyReadingFormat,
    pub segments: Vec<StudyReadingSegment>,
    pub objective_indexes: Vec<usize>,
    pub source_ref_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub authored: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingManifest {
    pub assignments: Vec<StudyReadingAssignment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyTrailSession {
    pub current_assignment_id: Option<String>,
    pub completed_assignment_ids: Vec<String>,
    pub skipped_assignment_ids: Vec<String>,
    pub topic_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReadingTrail {
    pub plan_id: String,
    pub version_id: String,
    pub revision: i64,
    pub manifest: StudyReadingManifest,
    pub session: Option<StudyTrailSession>,
}
