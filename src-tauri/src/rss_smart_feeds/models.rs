//! Domain models and IPC contracts for AI-powered RSS Smart Feeds.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceScope {
    All,
    SelectedFeeds,
    SelectedFolders,
    ExternalDiscovery,
}

impl SourceScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::SelectedFeeds => "selected_feeds",
            Self::SelectedFolders => "selected_folders",
            Self::ExternalDiscovery => "external_discovery",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "selected_feeds" => Self::SelectedFeeds,
            "selected_folders" => Self::SelectedFolders,
            "external_discovery" => Self::ExternalDiscovery,
            _ => Self::All,
        }
    }
}

impl Default for SourceScope {
    fn default() -> Self {
        Self::All
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SourceScopeConfig {
    pub feed_ids: Vec<String>,
    pub folder_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClassificationMode {
    FastLocal,
    IntelligentLocal,
    Cloud,
    Hybrid,
}

impl ClassificationMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FastLocal => "fast_local",
            Self::IntelligentLocal => "intelligent_local",
            Self::Cloud => "cloud",
            Self::Hybrid => "hybrid",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "intelligent_local" => Self::IntelligentLocal,
            "cloud" => Self::Cloud,
            "hybrid" => Self::Hybrid,
            _ => Self::FastLocal,
        }
    }
}

impl Default for ClassificationMode {
    fn default() -> Self {
        Self::FastLocal
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurationStrictness {
    Broad,
    Balanced,
    Strict,
}

impl CurationStrictness {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Broad => "broad",
            Self::Balanced => "balanced",
            Self::Strict => "strict",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "broad" => Self::Broad,
            "strict" => Self::Strict,
            _ => Self::Balanced,
        }
    }
}

impl Default for CurationStrictness {
    fn default() -> Self {
        Self::Balanced
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationDepth {
    Fast,
    Adaptive,
    Thorough,
}

impl EvaluationDepth {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Adaptive => "adaptive",
            Self::Thorough => "thorough",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "fast" => Self::Fast,
            "thorough" => Self::Thorough,
            _ => Self::Adaptive,
        }
    }
}

impl Default for EvaluationDepth {
    fn default() -> Self {
        Self::Adaptive
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentProvenance {
    HeadlineOnly,
    SummaryOnly,
    RssEmbedded,
    FullExtracted,
    Partial,
}

impl ContentProvenance {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HeadlineOnly => "headline_only",
            Self::SummaryOnly => "summary_only",
            Self::RssEmbedded => "rss_embedded",
            Self::FullExtracted => "full_extracted",
            Self::Partial => "partial",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "headline_only" => Self::HeadlineOnly,
            "rss_embedded" => Self::RssEmbedded,
            "full_extracted" => Self::FullExtracted,
            "partial" => Self::Partial,
            _ => Self::SummaryOnly,
        }
    }
}

impl Default for ContentProvenance {
    fn default() -> Self {
        Self::SummaryOnly
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SmartFeedMatchDiagnostics {
    pub evaluation_depth: EvaluationDepth,
    pub content_provenance: ContentProvenance,
    pub passages_evaluated: usize,
    pub passages_total: usize,
    pub inference_calls: usize,
    pub token_usage: usize,
    pub unexpected_truncation: bool,
    pub state_tokens_dropped: usize,
    pub exact_tokenizer: bool,
    pub criteria_compacted: bool,
    pub model_id: Option<String>,
    pub pipeline_version: String,
    pub primary_centrality: Option<String>,
    pub supporting_passages: Vec<String>,
    pub contradictory_passages: Vec<String>,
    pub matched_inclusion: Vec<String>,
    pub matched_exclusion: Vec<String>,
    pub evidence_coverage: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartFeedSortOrder {
    Relevance,
    Newest,
    Oldest,
    UnreadFirst,
}

impl SmartFeedSortOrder {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Newest => "newest",
            Self::Oldest => "oldest",
            Self::UnreadFirst => "unread_first",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "newest" => Self::Newest,
            "oldest" => Self::Oldest,
            "unread_first" => Self::UnreadFirst,
            _ => Self::Relevance,
        }
    }
}

impl Default for SmartFeedSortOrder {
    fn default() -> Self {
        Self::Relevance
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchDecision {
    INCLUDE,
    EXCLUDE,
    UNCERTAIN,
    PENDING,
}

impl MatchDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::INCLUDE => "INCLUDE",
            Self::EXCLUDE => "EXCLUDE",
            Self::UNCERTAIN => "UNCERTAIN",
            Self::PENDING => "PENDING",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "INCLUDE" => Self::INCLUDE,
            "EXCLUDE" => Self::EXCLUDE,
            "UNCERTAIN" => Self::UNCERTAIN,
            _ => Self::PENDING,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionSource {
    FastLocal,
    IntelligentLocal,
    Cloud,
    Hybrid,
    UserOverride,
    CandidateFilter,
}

impl DecisionSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FastLocal => "fast_local",
            Self::IntelligentLocal => "intelligent_local",
            Self::Cloud => "cloud",
            Self::Hybrid => "hybrid",
            Self::UserOverride => "user_override",
            Self::CandidateFilter => "candidate_filter",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "intelligent_local" => Self::IntelligentLocal,
            "cloud" => Self::Cloud,
            "hybrid" => Self::Hybrid,
            "user_override" => Self::UserOverride,
            "candidate_filter" => Self::CandidateFilter,
            _ => Self::FastLocal,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationStatus {
    Pending,
    Completed,
    CompletedLexical,
    Deferred,
    Error,
}

impl EvaluationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::CompletedLexical => "completed_lexical",
            Self::Deferred => "deferred",
            Self::Error => "error",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "completed" => Self::Completed,
            "completed_lexical" => Self::CompletedLexical,
            "deferred" => Self::Deferred,
            "error" => Self::Error,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[allow(non_camel_case_types)]
pub enum FeedbackType {
    SHOULD_INCLUDE,
    SHOULD_EXCLUDE,
    UNDO,
}

impl FeedbackType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SHOULD_INCLUDE => "SHOULD_INCLUDE",
            Self::SHOULD_EXCLUDE => "SHOULD_EXCLUDE",
            Self::UNDO => "UNDO",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "SHOULD_INCLUDE" => Some(Self::SHOULD_INCLUDE),
            "SHOULD_EXCLUDE" => Some(Self::SHOULD_EXCLUDE),
            "UNDO" => Some(Self::UNDO),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingRole {
    Positive,
    Negative,
    FeedbackPos,
    FeedbackNeg,
}

impl EmbeddingRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
            Self::FeedbackPos => "feedback_pos",
            Self::FeedbackNeg => "feedback_neg",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeed {
    pub id: String,
    pub name: String,
    pub description: String,
    pub inclusion_criteria: String,
    pub exclusion_criteria: String,
    pub source_scope: SourceScope,
    pub source_scope_config: SourceScopeConfig,
    pub classification_mode: ClassificationMode,
    pub curation_strictness: CurationStrictness,
    #[serde(default)]
    pub evaluation_depth: EvaluationDepth,
    pub minimum_relevance: Option<f64>,
    pub freshness_window_days: Option<i32>,
    pub sort_order: SmartFeedSortOrder,
    pub group_similar_stories: bool,
    pub is_enabled: bool,
    pub cloud_consent_granted: bool,
    pub preferred_provider: Option<String>,
    pub preferred_model: Option<String>,
    pub definition_revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_evaluated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedWithStats {
    #[serde(flatten)]
    pub feed: SmartFeed,
    pub matched_count: i64,
    pub unread_count: i64,
    pub uncertain_count: i64,
    pub excluded_count: i64,
    pub pending_count: i64,
    pub source_feed_count: i64,
    pub lexical_only_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSmartFeedInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub inclusion_criteria: String,
    #[serde(default)]
    pub exclusion_criteria: String,
    #[serde(default)]
    pub source_scope: SourceScope,
    #[serde(default)]
    pub source_scope_config: SourceScopeConfig,
    #[serde(default)]
    pub classification_mode: ClassificationMode,
    #[serde(default)]
    pub curation_strictness: CurationStrictness,
    #[serde(default)]
    pub evaluation_depth: EvaluationDepth,
    pub minimum_relevance: Option<f64>,
    pub freshness_window_days: Option<i32>,
    #[serde(default)]
    pub sort_order: SmartFeedSortOrder,
    #[serde(default = "default_true")]
    pub group_similar_stories: bool,
    #[serde(default = "default_true")]
    pub is_enabled: bool,
    #[serde(default)]
    pub cloud_consent_granted: bool,
    pub preferred_provider: Option<String>,
    pub preferred_model: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateSmartFeedInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub inclusion_criteria: Option<String>,
    pub exclusion_criteria: Option<String>,
    pub source_scope: Option<SourceScope>,
    pub source_scope_config: Option<SourceScopeConfig>,
    pub classification_mode: Option<ClassificationMode>,
    pub curation_strictness: Option<CurationStrictness>,
    pub evaluation_depth: Option<EvaluationDepth>,
    pub minimum_relevance: Option<Option<f64>>,
    pub freshness_window_days: Option<Option<i32>>,
    pub sort_order: Option<SmartFeedSortOrder>,
    pub group_similar_stories: Option<bool>,
    pub is_enabled: Option<bool>,
    pub cloud_consent_granted: Option<bool>,
    pub preferred_provider: Option<Option<String>>,
    pub preferred_model: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedMatch {
    pub smart_feed_id: String,
    pub article_id: String,
    pub decision: MatchDecision,
    pub relevance_score: f64,
    pub ranking_score: f64,
    pub decision_reason: String,
    pub matched_evidence: Vec<String>,
    pub decision_source: DecisionSource,
    pub content_hash: String,
    pub definition_revision: i64,
    pub classifier_version: String,
    pub embedding_provider: String,
    pub embedding_model: String,
    pub evaluation_status: EvaluationStatus,
    pub error_message: Option<String>,
    pub is_user_override: bool,
    pub evaluated_at: String,
    #[serde(default)]
    pub evaluation_depth: EvaluationDepth,
    #[serde(default)]
    pub content_provenance: ContentProvenance,
    #[serde(default)]
    pub passages_evaluated: usize,
    #[serde(default)]
    pub passages_total: usize,
    #[serde(default)]
    pub inference_calls: usize,
    #[serde(default)]
    pub unexpected_truncation: bool,
    #[serde(default)]
    pub diagnostics: Option<SmartFeedMatchDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedBadge {
    pub smart_feed_id: String,
    pub smart_feed_name: String,
    pub relevance_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedClusterMember {
    pub article_id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub title: String,
    pub url: String,
    pub published_date: Option<String>,
    pub similarity_kind: String, // "duplicate" | "same_story"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedArticleItem {
    pub article_id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub url: String,
    pub guid: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub image_url: Option<String>,
    pub categories: Vec<String>,
    pub is_queued: bool,
    pub is_read: bool,
    pub date_added: String,
    pub full_content: Option<String>,
    pub full_content_fetched_at: Option<String>,
    pub decision: MatchDecision,
    pub relevance_score: f64,
    pub ranking_score: f64,
    pub decision_reason: String,
    pub matched_evidence: Vec<String>,
    pub decision_source: DecisionSource,
    pub evaluation_status: EvaluationStatus,
    pub error_message: Option<String>,
    pub is_user_override: bool,
    pub evaluated_at: String,
    pub active_feedback: Option<FeedbackType>,
    pub also_in_smart_feeds: Vec<SmartFeedBadge>,
    pub cluster_id: Option<String>,
    pub cluster_size: usize,
    pub cluster_members: Vec<SmartFeedClusterMember>,
    #[serde(default)]
    pub evaluation_depth: EvaluationDepth,
    #[serde(default)]
    pub content_provenance: ContentProvenance,
    #[serde(default)]
    pub passages_evaluated: usize,
    #[serde(default)]
    pub passages_total: usize,
    #[serde(default)]
    pub unexpected_truncation: bool,
    #[serde(default)]
    pub diagnostics: Option<SmartFeedMatchDiagnostics>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SmartFeedArticlesFilter {
    pub bucket: Option<MatchDecision>,
    pub search: Option<String>,
    pub unread_only: bool,
    pub sort_order: Option<SmartFeedSortOrder>,
    pub group_similar_stories: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedArticlesResponse {
    pub smart_feed: SmartFeedWithStats,
    pub articles: Vec<SmartFeedArticleItem>,
    pub total_in_bucket: i64,
    pub grouped_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedFeedbackEvent {
    pub id: String,
    pub smart_feed_id: String,
    pub article_id: String,
    pub feedback_type: FeedbackType,
    pub previous_decision: Option<MatchDecision>,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedFeedbackResult {
    pub smart_feed_id: String,
    pub article_id: String,
    pub decision: MatchDecision,
    pub active_feedback: Option<FeedbackType>,
    pub is_user_override: bool,
    pub decision_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedProgress {
    pub smart_feed_id: String,
    pub phase: String, // "idle" | "running" | "completed" | "cancelled" | "failed"
    pub total: usize,
    pub evaluated: usize,
    pub matched: usize,
    pub excluded: usize,
    pub uncertain: usize,
    pub remaining: usize,
    pub cache_hits: usize,
    pub lexical_only: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SmartFeedRunMetrics {
    pub smart_feed_id: String,
    pub total_scanned: usize,
    pub evaluated_count: usize,
    pub matched_count: usize,
    pub excluded_count: usize,
    pub uncertain_count: usize,
    pub deferred_count: usize,
    pub error_count: usize,
    pub cache_hits: usize,
    pub embeddings_reused: usize,
    pub embeddings_generated: usize,
    pub provider_calls: usize,
    pub estimated_tokens: usize,
    pub duration_ms: u64,
    pub articles_per_sec: f64,
    pub cancelled: bool,
    pub lexical_only: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFeedLayaConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedCapabilities {
    pub fast_local_available: bool,
    pub semantic_embeddings_available: bool,
    pub embedding_provider: Option<String>,
    pub embedding_model: Option<String>,
    pub intelligent_local_available: bool,
    pub local_llm_model: Option<String>,
    pub cloud_llm_available: bool,
    pub cloud_llm_provider: Option<String>,
    pub cloud_llm_model: Option<String>,
    pub strict_local_only: bool,
    pub paid_embeddings_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedsExportPayload {
    pub schema_version: i32,
    pub exported_at: String,
    pub smart_feeds: Vec<SmartFeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFeedsImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub ids: Vec<String>,
}

/// Internal DB representation of a scoped RSS article with its feed title.
#[derive(Debug, Clone)]
pub struct ScopedArticleRow {
    pub id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub url: String,
    pub guid: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub image_url: Option<String>,
    pub is_queued: bool,
    pub is_read: bool,
    pub date_added: String,
    pub full_content: Option<String>,
    pub full_content_fetched_at: Option<String>,
    pub categories: Vec<String>,
}

/// Persisted embedding vector scoped to a Smart Feed role.
#[derive(Debug, Clone)]
pub struct SmartFeedEmbeddingRecord {
    pub smart_feed_id: String,
    pub role: EmbeddingRole,
    pub definition_revision: i64,
    pub provider: String,
    pub model: String,
    pub dimension: i32,
    pub embedding: Vec<f32>,
    pub weight: f64,
    pub content_hash: String,
    pub updated_at: String,
}
