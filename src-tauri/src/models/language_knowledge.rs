//! Profile-scoped language knowledge state and evidence contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LANGUAGE_KNOWLEDGE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LanguageKnowledgeState {
    New,
    Encountered,
    Learning,
    Familiar,
    Known,
    Ignored,
}

impl LanguageKnowledgeState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Encountered => "encountered",
            Self::Learning => "learning",
            Self::Familiar => "familiar",
            Self::Known => "known",
            Self::Ignored => "ignored",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "encountered" => Self::Encountered,
            "learning" => Self::Learning,
            "familiar" => Self::Familiar,
            "known" => Self::Known,
            "ignored" => Self::Ignored,
            _ => Self::New,
        }
    }
}

impl Default for LanguageKnowledgeState {
    fn default() -> Self { Self::New }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeStateSource {
    Encounter,
    Manual,
    Import,
    Undo,
    System,
}

impl KnowledgeStateSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Encounter => "encounter",
            Self::Manual => "manual",
            Self::Import => "import",
            Self::Undo => "undo",
            Self::System => "system",
        }
    }
}

impl Default for KnowledgeStateSource {
    fn default() -> Self { Self::Manual }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeEvidenceKind {
    Encounter,
    Lookup,
    Recognition,
    Production,
    Manual,
}

impl KnowledgeEvidenceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Encounter => "encounter",
            Self::Lookup => "lookup",
            Self::Recognition => "recognition",
            Self::Production => "production",
            Self::Manual => "manual",
        }
    }
}

impl Default for KnowledgeEvidenceKind {
    fn default() -> Self { Self::Encounter }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageKnowledgeStateSnapshot {
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub state: LanguageKnowledgeState,
    pub manual_override: bool,
    pub override_actor: Option<String>,
    pub override_source: Option<KnowledgeStateSource>,
    pub passive_evidence: i64,
    pub active_evidence: i64,
    pub last_evidence_at: Option<i64>,
    pub updated_at: i64,
    pub version: i64,
}

impl Default for LanguageKnowledgeStateSnapshot {
    fn default() -> Self {
        Self {
            profile_id: String::new(), lexical_entry_id: String::new(), state: LanguageKnowledgeState::New,
            manual_override: false, override_actor: None, override_source: None,
            passive_evidence: 0, active_evidence: 0, last_evidence_at: None, updated_at: 0, version: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageKnowledgeStateChange {
    pub profile_id: String,
    pub entry_id: String,
    pub state: LanguageKnowledgeState,
    pub source: KnowledgeStateSource,
    pub actor_id: Option<String>,
    pub operation_id: Option<String>,
}

impl Default for LanguageKnowledgeStateChange {
    fn default() -> Self {
        Self { profile_id: String::new(), entry_id: String::new(), state: LanguageKnowledgeState::New, source: KnowledgeStateSource::Manual, actor_id: None, operation_id: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageKnowledgeEvidenceInput {
    pub profile_id: String,
    pub entry_id: String,
    pub kind: KnowledgeEvidenceKind,
    pub confidence: Option<f64>,
    pub source_id: Option<String>,
    pub metadata: Value,
    pub occurred_at: Option<i64>,
}

impl Default for LanguageKnowledgeEvidenceInput {
    fn default() -> Self {
        Self { profile_id: String::new(), entry_id: String::new(), kind: KnowledgeEvidenceKind::Encounter, confidence: None, source_id: None, metadata: Value::Object(Default::default()), occurred_at: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageKnowledgeEvidenceEvent {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub kind: KnowledgeEvidenceKind,
    pub confidence: Option<f64>,
    pub source_id: Option<String>,
    pub metadata: Value,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageKnowledgeStateHistory {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub previous_state: LanguageKnowledgeState,
    pub new_state: LanguageKnowledgeState,
    pub source: KnowledgeStateSource,
    pub actor_id: Option<String>,
    pub operation_id: String,
    pub changed_at: i64,
    pub reverted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageMemorizationLinkInput {
    pub profile_id: String,
    pub entry_id: String,
    pub learning_item_id: String,
    pub relation: String,
    pub actor_id: Option<String>,
}

impl Default for LanguageMemorizationLinkInput {
    fn default() -> Self { Self { profile_id: String::new(), entry_id: String::new(), learning_item_id: String::new(), relation: "explicit".to_string(), actor_id: None } }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageMemorizationLink {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub learning_item_id: String,
    pub relation: String,
    pub actor_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownWordImportRecord {
    pub word: String,
    pub language_tag: Option<String>,
    pub state: LanguageKnowledgeState,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownWordImportPreview {
    pub matched_entry_ids: Vec<String>,
    pub new_words: Vec<String>,
    pub duplicates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageKnowledgeExport {
    pub schema_version: u32,
    pub profile_id: String,
    pub exported_at: i64,
    pub states: Vec<LanguageKnowledgeStateSnapshot>,
    pub history: Vec<LanguageKnowledgeStateHistory>,
    pub evidence: Vec<LanguageKnowledgeEvidenceEvent>,
    pub memorization_links: Vec<LanguageMemorizationLink>,
}
