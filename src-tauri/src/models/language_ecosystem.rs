//! Models for Language Learning ecosystem tables:
//! - Phrases & collocations (095)
//! - SRS drafts & evidence (096)
//! - Sentence-audio alignments (097)
//! - Recommendation candidates (098)
//! - Processing jobs/chunks/tokens/results (092)
//! - Lexical coverage results/chunks/jobs (157)
//! - Language packs & offline dictionaries (158)
//! - Analytics, generated docs & translation cache (159)

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguagePhraseRecord {
    pub id: String,
    pub profile_id: String,
    pub language_tag: String,
    pub phrase_key: String,
    pub normalized_form: String,
    pub canonical_form: String,
    pub meaning: Option<String>,
    pub translation: Option<String>,
    pub confidence: Option<f64>,
    pub state: String,
    pub first_encountered_at: Option<i64>,
    pub last_encountered_at: Option<i64>,
    pub occurrence_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
}

impl Default for LanguagePhraseRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: String::new(),
            language_tag: String::new(),
            phrase_key: String::new(),
            normalized_form: String::new(),
            canonical_form: String::new(),
            meaning: None,
            translation: None,
            confidence: None,
            state: "new".to_string(),
            first_encountered_at: None,
            last_encountered_at: None,
            occurrence_count: 0,
            created_at: 0,
            updated_at: 0,
            version: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageSrsDraftRecord {
    pub id: String,
    pub profile_id: String,
    pub lexical_entry_id: Option<String>,
    pub phrase_id: Option<String>,
    pub sentence_id: Option<String>,
    pub draft_key: String,
    pub item_type: String,
    pub question: String,
    pub answer: Option<String>,
    pub source_anchor: Option<Value>,
    pub provenance: Value,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for LanguageSrsDraftRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: String::new(),
            lexical_entry_id: None,
            phrase_id: None,
            sentence_id: None,
            draft_key: String::new(),
            item_type: "qa".to_string(),
            question: String::new(),
            answer: None,
            source_anchor: None,
            provenance: Value::Object(Default::default()),
            provider_id: None,
            provider_version: None,
            status: "draft".to_string(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageAudioAlignmentRecord {
    pub id: String,
    pub profile_id: Option<String>,
    pub source_type: String,
    pub source_id: String,
    pub sentence_id: String,
    pub media_id: String,
    pub source_fingerprint: String,
    pub media_fingerprint: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: f64,
    pub method: String,
    pub status: String,
    pub provider_id: Option<String>,
    pub provider_version: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for LanguageAudioAlignmentRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: None,
            source_type: "transcript".to_string(),
            source_id: String::new(),
            sentence_id: String::new(),
            media_id: String::new(),
            source_fingerprint: String::new(),
            media_fingerprint: String::new(),
            start_ms: 0,
            end_ms: 0,
            confidence: 0.0,
            method: "transcript".to_string(),
            status: "ready".to_string(),
            provider_id: None,
            provider_version: None,
            error: None,
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageCoverageResultRecord {
    pub coverage_key: String,
    pub document_id: String,
    pub profile_id: String,
    pub content_fingerprint: String,
    pub processor_version: String,
    pub lexicon_state_version: String,
    pub policy_version: String,
    pub threshold_version: String,
    pub method: String,
    pub freshness: String,
    pub summary: Option<Value>,
    pub unique_vocab: Option<Value>,
    pub error: Option<String>,
    pub computed_at: Option<i64>,
    pub updated_at: i64,
}

impl Default for LanguageCoverageResultRecord {
    fn default() -> Self {
        Self {
            coverage_key: String::new(),
            document_id: String::new(),
            profile_id: String::new(),
            content_fingerprint: String::new(),
            processor_version: String::new(),
            lexicon_state_version: String::new(),
            policy_version: String::new(),
            threshold_version: String::new(),
            method: "exact-form-fallback".to_string(),
            freshness: "pending".to_string(),
            summary: None,
            unique_vocab: None,
            error: None,
            computed_at: None,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageRecommendationCandidateRecord {
    pub id: String,
    pub profile_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_fingerprint: String,
    pub title: String,
    pub url: Option<String>,
    pub explanation: Value,
    pub ranking: Value,
    pub coverage_status: String,
    pub lifecycle: String,
    pub snoozed_until: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for LanguageRecommendationCandidateRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: String::new(),
            source_type: "library".to_string(),
            source_id: String::new(),
            source_fingerprint: String::new(),
            title: String::new(),
            url: None,
            explanation: Value::Object(Default::default()),
            ranking: Value::Object(Default::default()),
            coverage_status: "pending".to_string(),
            lifecycle: "candidate".to_string(),
            snoozed_until: None,
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguagePackRecord {
    pub id: String,
    pub language_tag: String,
    pub target_language: String,
    pub base_language: Option<String>,
    pub name: String,
    pub kind: String,
    pub format: String,
    pub version: String,
    pub source_url: Option<String>,
    pub sha256: String,
    pub size_bytes: i64,
    pub entry_count: i64,
    pub license: String,
    pub attribution: String,
    pub capabilities: Value,
    pub install_path: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub installed_at: i64,
    pub updated_at: i64,
    pub last_verified_at: Option<i64>,
}

impl Default for LanguagePackRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            language_tag: String::new(),
            target_language: String::new(),
            base_language: None,
            name: String::new(),
            kind: "dictionary".to_string(),
            format: "json".to_string(),
            version: "1.0.0".to_string(),
            source_url: None,
            sha256: String::new(),
            size_bytes: 0,
            entry_count: 0,
            license: String::new(),
            attribution: String::new(),
            capabilities: Value::Object(Default::default()),
            install_path: None,
            status: "installed".to_string(),
            error: None,
            installed_at: 0,
            updated_at: 0,
            last_verified_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageDictionaryEntryRecord {
    pub id: String,
    pub pack_id: String,
    pub language_tag: String,
    pub headword: String,
    pub normalized_headword: String,
    pub reading: Option<String>,
    pub lemma: Option<String>,
    pub part_of_speech: Option<String>,
    pub morphology: Value,
    pub senses: Value,
    pub examples: Value,
    pub frequency_rank: Option<i64>,
}

impl Default for LanguageDictionaryEntryRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            pack_id: String::new(),
            language_tag: String::new(),
            headword: String::new(),
            normalized_headword: String::new(),
            reading: None,
            lemma: None,
            part_of_speech: None,
            morphology: Value::Object(Default::default()),
            senses: Value::Array(Vec::new()),
            examples: Value::Array(Vec::new()),
            frequency_rank: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageAnalyticsEventInput {
    pub idempotency_key: String,
    pub profile_id: String,
    pub event_kind: String,
    pub payload: Value,
    pub occurred_at: Option<i64>,
}

impl Default for LanguageAnalyticsEventInput {
    fn default() -> Self {
        Self {
            idempotency_key: String::new(),
            profile_id: String::new(),
            event_kind: String::new(),
            payload: Value::Object(Default::default()),
            occurred_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageAnalyticsDailyRecord {
    pub profile_id: String,
    pub day_utc: String,
    pub metrics: Value,
    pub event_cursor: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageGeneratedDocumentRecord {
    pub id: String,
    pub profile_id: String,
    pub document_id: Option<String>,
    pub source_document_id: Option<String>,
    pub action_kind: String,
    pub target_coverage: Option<f64>,
    pub measured_coverage: Option<f64>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub prompt_summary: Option<String>,
    pub provenance: Value,
    pub created_at: i64,
}

impl Default for LanguageGeneratedDocumentRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            profile_id: String::new(),
            document_id: None,
            source_document_id: None,
            action_kind: "generate".to_string(),
            target_coverage: None,
            measured_coverage: None,
            provider_id: None,
            model_id: None,
            prompt_summary: None,
            provenance: Value::Object(Default::default()),
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageTranslationCacheRecord {
    pub cache_key: String,
    pub profile_id: Option<String>,
    pub source_lang: String,
    pub target_lang: String,
    pub source_hash: String,
    pub provider_id: String,
    pub provider_version: String,
    pub translation_text: String,
    pub confidence: Option<f64>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

impl Default for LanguageTranslationCacheRecord {
    fn default() -> Self {
        Self {
            cache_key: String::new(),
            profile_id: None,
            source_lang: String::new(),
            target_lang: String::new(),
            source_hash: String::new(),
            provider_id: String::new(),
            provider_version: String::new(),
            translation_text: String::new(),
            confidence: None,
            created_at: 0,
            expires_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LanguageProcessingJobRecord {
    pub job_id: String,
    pub processing_key: String,
    pub state: String,
    pub next_chunk_index: i64,
    pub total_chunks: i64,
    pub completed_chunks: i64,
    pub retry_count: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub updated_at: i64,
}

impl Default for LanguageProcessingJobRecord {
    fn default() -> Self {
        Self {
            job_id: String::new(),
            processing_key: String::new(),
            state: "queued".to_string(),
            next_chunk_index: 0,
            total_chunks: 0,
            completed_chunks: 0,
            retry_count: 0,
            error_code: None,
            error_message: None,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProcessingResultRecord {
    pub processing_key: String,
    pub version: Value,
    pub summary: Value,
    pub chunk_count: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProcessingChunkRecord {
    pub processing_key: String,
    pub chunk_index: i64,
    pub source_start: i64,
    pub source_end: i64,
    pub chunk: Value,
    pub updated_at: i64,
}
