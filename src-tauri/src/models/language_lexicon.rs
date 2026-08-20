//! Durable language lexicon, source identity, and occurrence contracts.
//!
//! The lexical model consumes the language profile and processing contracts;
//! it does not own language tags, tokenization, or dictionary providers.  A
//! row may be created from an exact-form fallback and enriched later by a
//! versioned processor/provider without losing the original surface form.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LANGUAGE_LEXICON_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_OCCURRENCE_PAGE_SIZE: i64 = 50;
pub const MAX_OCCURRENCE_PAGE_SIZE: i64 = 100;
pub const MAX_CONTEXT_TEXT_CHARS: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LexicalObjectKind {
    Token,
    Phrase,
}

impl LexicalObjectKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Token => "token",
            Self::Phrase => "phrase",
        }
    }
}

impl Default for LexicalObjectKind {
    fn default() -> Self {
        Self::Token
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrphanState {
    Live,
    Orphaned,
    Retained,
}

impl OrphanState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Orphaned => "orphaned",
            Self::Retained => "retained",
        }
    }
}

impl Default for OrphanState {
    fn default() -> Self {
        Self::Live
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SourceAnchor {
    pub source_type: String,
    pub document_id: Option<String>,
    pub media_id: Option<String>,
    pub source_id: Option<String>,
    pub content_fingerprint: Option<String>,
    pub locator: Option<Value>,
}

impl Default for SourceAnchor {
    fn default() -> Self {
        Self {
            source_type: "text".to_string(),
            document_id: None,
            media_id: None,
            source_id: None,
            content_fingerprint: None,
            locator: None,
        }
    }
}

impl SourceAnchor {
    pub fn content_id(&self) -> Option<&str> {
        self.document_id.as_deref().or(self.media_id.as_deref())
    }

    pub fn compact_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceIdentity {
    pub id: String,
    pub source_id: String,
    pub content_fingerprint: Option<String>,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenIdentity {
    pub id: String,
    pub sentence_id: Option<String>,
    pub surface: String,
    pub normalized: String,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
}

/// Stable reference passed between processing, reader, dictionary, and
/// occurrence layers.  Optional fields deliberately preserve exact-form
/// operation when an adapter cannot provide a lemma or analysis.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LexicalObjectRef {
    pub profile_id: String,
    pub lexical_entry_id: Option<String>,
    pub surface_form_id: Option<String>,
    pub analysis_id: Option<String>,
    pub occurrence_id: Option<String>,
    pub token_id: Option<String>,
    pub sentence_id: Option<String>,
    pub surface: String,
    pub normalized: String,
    pub lemma: Option<String>,
    pub phrase_id: Option<String>,
    pub processing_key: Option<String>,
    pub confidence: Option<f64>,
    pub source_anchor: Option<SourceAnchor>,
}

impl Default for LexicalObjectRef {
    fn default() -> Self {
        Self {
            profile_id: String::new(),
            lexical_entry_id: None,
            surface_form_id: None,
            analysis_id: None,
            occurrence_id: None,
            token_id: None,
            sentence_id: None,
            surface: String::new(),
            normalized: String::new(),
            lemma: None,
            phrase_id: None,
            processing_key: None,
            confidence: None,
            source_anchor: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLexicalEntry {
    pub id: String,
    pub profile_id: String,
    pub language_tag: String,
    pub object_kind: LexicalObjectKind,
    pub lexical_key: String,
    pub normalized_form: String,
    pub canonical_form: String,
    pub lemma: Option<String>,
    pub meanings: Vec<String>,
    pub translations: Vec<String>,
    pub part_of_speech: Option<String>,
    pub pronunciation: Option<String>,
    pub frequency: Option<f64>,
    pub cefr_level: Option<String>,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub processor_id: Option<String>,
    pub processor_version: Option<String>,
    pub identity_confidence: Option<f64>,
    pub first_encountered_at: Option<i64>,
    pub last_encountered_at: Option<i64>,
    pub encounter_count: i64,
    pub document_count: i64,
    pub lookup_count: i64,
    pub active_evidence_count: i64,
    pub passive_evidence_count: i64,
    pub knowledge_state: Option<String>,
    pub review_relationships: Value,
    pub user_notes: Option<String>,
    pub ignored: bool,
    pub proper_noun: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageSurfaceForm {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub language_tag: String,
    pub surface: String,
    pub normalized: String,
    pub first_seen_at: Option<i64>,
    pub last_seen_at: Option<i64>,
    pub occurrence_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLexicalAnalysis {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub surface_form_id: Option<String>,
    pub token_id: Option<String>,
    pub sentence_id: Option<String>,
    pub processing_key: String,
    pub processor_id: Option<String>,
    pub processor_version: Option<String>,
    pub lemma: Option<String>,
    pub part_of_speech: Option<String>,
    pub morphology: Value,
    pub confidence: Option<f64>,
    pub authoritative: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhraseReference {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub normalized: String,
    pub token_ids: Vec<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageOccurrence {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: String,
    pub surface_form_id: Option<String>,
    pub language_tag: String,
    pub surface: String,
    pub normalized: String,
    pub source_type: String,
    pub document_id: Option<String>,
    pub media_id: Option<String>,
    pub source_id: Option<String>,
    pub sentence_id: Option<String>,
    pub token_id: Option<String>,
    pub content_fingerprint: Option<String>,
    pub source_anchor: Option<SourceAnchor>,
    pub context_reference: Option<String>,
    pub context_hash: Option<String>,
    pub context_text: Option<String>,
    pub encountered_at: i64,
    pub last_encountered_at: i64,
    pub repeat_count: i64,
    pub audio_start_ms: Option<i64>,
    pub audio_end_ms: Option<i64>,
    pub was_lookup: bool,
    pub was_interacted: bool,
    pub processing_key: Option<String>,
    pub confidence: Option<f64>,
    pub orphan_state: OrphanState,
    pub orphaned_at: Option<i64>,
    pub retention_expires_at: Option<i64>,
    pub occurrence_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LexicalEntryUpsert {
    pub id: Option<String>,
    pub profile_id: String,
    pub language_tag: String,
    pub normalized_form: String,
    pub canonical_form: Option<String>,
    pub lemma: Option<String>,
    pub object_kind: LexicalObjectKind,
    pub meanings: Vec<String>,
    pub translations: Vec<String>,
    pub part_of_speech: Option<String>,
    pub pronunciation: Option<String>,
    pub frequency: Option<f64>,
    pub cefr_level: Option<String>,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub processor_id: Option<String>,
    pub processor_version: Option<String>,
    pub identity_confidence: Option<f64>,
}

impl Default for LexicalEntryUpsert {
    fn default() -> Self {
        Self {
            id: None,
            profile_id: String::new(),
            language_tag: String::new(),
            normalized_form: String::new(),
            canonical_form: None,
            lemma: None,
            object_kind: LexicalObjectKind::Token,
            meanings: Vec::new(),
            translations: Vec::new(),
            part_of_speech: None,
            pronunciation: None,
            frequency: None,
            cefr_level: None,
            provider_id: None,
            provider_version: None,
            processor_id: None,
            processor_version: None,
            identity_confidence: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EncounterInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub language_tag: String,
    pub surface: String,
    pub normalized: Option<String>,
    pub lemma: Option<String>,
    pub object_kind: LexicalObjectKind,
    pub canonical_form: Option<String>,
    pub part_of_speech: Option<String>,
    pub morphology: Value,
    pub processor_id: Option<String>,
    pub processor_version: Option<String>,
    pub processing_key: Option<String>,
    pub confidence: Option<f64>,
    pub source_anchor: Option<SourceAnchor>,
    pub source_type: Option<String>,
    pub document_id: Option<String>,
    pub media_id: Option<String>,
    pub source_id: Option<String>,
    pub sentence_id: Option<String>,
    pub token_id: Option<String>,
    pub content_fingerprint: Option<String>,
    pub context_reference: Option<String>,
    pub context_hash: Option<String>,
    pub context_text: Option<String>,
    pub encountered_at: Option<i64>,
    pub audio_start_ms: Option<i64>,
    pub audio_end_ms: Option<i64>,
    pub was_lookup: bool,
    pub was_interacted: bool,
    pub retention_expires_at: Option<i64>,
}

impl Default for EncounterInput {
    fn default() -> Self {
        Self {
            id: None,
            profile_id: String::new(),
            language_tag: String::new(),
            surface: String::new(),
            normalized: None,
            lemma: None,
            object_kind: LexicalObjectKind::Token,
            canonical_form: None,
            part_of_speech: None,
            morphology: Value::Object(Default::default()),
            processor_id: None,
            processor_version: None,
            processing_key: None,
            confidence: None,
            source_anchor: None,
            source_type: None,
            document_id: None,
            media_id: None,
            source_id: None,
            sentence_id: None,
            token_id: None,
            content_fingerprint: None,
            context_reference: None,
            context_hash: None,
            context_text: None,
            encountered_at: None,
            audio_start_ms: None,
            audio_end_ms: None,
            was_lookup: false,
            was_interacted: false,
            retention_expires_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LookupInput {
    pub profile_id: Option<String>,
    pub language_tag: Option<String>,
    pub surface: String,
    pub document_id: Option<String>,
    pub media_id: Option<String>,
    pub source_anchor: Option<SourceAnchor>,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub meanings: Vec<String>,
    pub translations: Vec<String>,
    pub pronunciation: Option<String>,
    pub part_of_speech: Option<String>,
    pub looked_up_at: Option<i64>,
}

impl Default for LookupInput {
    fn default() -> Self {
        Self {
            profile_id: None,
            language_tag: None,
            surface: String::new(),
            document_id: None,
            media_id: None,
            source_anchor: None,
            provider_id: None,
            provider_version: None,
            meanings: Vec::new(),
            translations: Vec::new(),
            pronunciation: None,
            part_of_speech: None,
            looked_up_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LexicalEntryOverride {
    pub profile_id: String,
    pub entry_id: String,
    pub lemma: Option<String>,
    pub canonical_form: Option<String>,
    pub knowledge_state: Option<String>,
    pub user_notes: Option<String>,
    pub ignored: Option<bool>,
    pub proper_noun: Option<bool>,
}

impl Default for LexicalEntryOverride {
    fn default() -> Self {
        Self {
            profile_id: String::new(),
            entry_id: String::new(),
            lemma: None,
            canonical_form: None,
            knowledge_state: None,
            user_notes: None,
            ignored: None,
            proper_noun: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LexiconPage<T> {
    pub items: Vec<T>,
    pub offset: i64,
    pub limit: i64,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncounterBatchResult {
    pub accepted: i64,
    pub coalesced: i64,
    pub entries: Vec<LanguageLexicalEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLookupRecord {
    pub word: String,
    pub lookup_count: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub last_document_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLexiconExport {
    pub schema_version: u32,
    pub profile_id: String,
    pub exported_at: i64,
    pub entries: Vec<LanguageLexicalEntry>,
    pub surfaces: Vec<LanguageSurfaceForm>,
    pub analyses: Vec<LanguageLexicalAnalysis>,
    pub occurrences: Vec<LanguageOccurrence>,
    pub lookup_events: Vec<LanguageLookupEvent>,
    pub occurrences_included: bool,
    pub occurrence_offset: i64,
    pub occurrence_limit: i64,
    pub occurrence_total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLookupEvent {
    pub id: String,
    pub profile_id: Option<String>,
    pub lexical_entry_id: Option<String>,
    pub surface: String,
    pub normalized: String,
    pub document_id: Option<String>,
    pub media_id: Option<String>,
    pub source_anchor: Option<SourceAnchor>,
    pub looked_up_at: i64,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLexiconSyncEnvelope {
    pub schema_version: u32,
    pub profile_id: String,
    pub changed_at: i64,
    pub entries: Vec<LanguageLexicalEntry>,
    pub surfaces: Vec<LanguageSurfaceForm>,
    pub analyses: Vec<LanguageLexicalAnalysis>,
    pub occurrences: Vec<LanguageOccurrence>,
    pub lookup_events: Vec<LanguageLookupEvent>,
    pub occurrences_included: bool,
}

pub fn normalize_lexical_form(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn clamp_context_text(value: Option<&str>) -> Option<String> {
    value.map(|text| text.chars().take(MAX_CONTEXT_TEXT_CHARS).collect())
}

pub fn stable_occurrence_key(input: &EncounterInput, normalized: &str) -> String {
    if let Some(id) = input.id.as_deref().filter(|value| !value.trim().is_empty()) {
        return format!("explicit:{id}");
    }
    let source = input
        .source_anchor
        .as_ref()
        .and_then(|anchor| anchor.locator.as_ref())
        .map(ToString::to_string)
        .unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        input.profile_id,
        input.content_fingerprint.as_deref().unwrap_or_default(),
        input.document_id.as_deref().or(input.media_id.as_deref()).unwrap_or_default(),
        input.sentence_id.as_deref().unwrap_or_default(),
        input.token_id.as_deref().unwrap_or_default(),
        normalized,
        source,
        input.context_reference.as_deref().unwrap_or_default(),
        input.audio_start_ms.map(|value| value.to_string()).unwrap_or_default(),
    )
}
