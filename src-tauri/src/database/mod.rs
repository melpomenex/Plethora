//! Database layer for Incrementum

pub mod ai_conversation_repository;
pub mod ai_provenance_repository;
pub mod audio_edition_repository;
pub mod capture_repository;
pub mod concept_repository;
pub mod connection;
pub mod document_privacy;
pub mod daqe_model_cache_repository;
pub mod element_tree_repository;
pub mod item_activity_repository;
pub mod item_stats_repository;
pub mod language_profile_repository;
pub mod language_lexicon_repository;
pub mod language_knowledge_repository;
pub mod language_practice_repository;
pub mod learning_object_source_repository;
pub mod learning_item_source;
pub mod migrations;
pub mod neural_queue_repository;
pub mod podcast_transcript_repository;
pub mod priority_rank;
pub mod recording_session_repository;
pub mod repository;
pub mod video_extract_repository;
pub mod saved_queue_repository;
pub mod session_analysis_repository;

pub use learning_object_source_repository::{LearningObjectSource, LearningObjectSourceRepository};
pub use session_analysis_repository::SessionAnalysisRepository;

pub use ai_conversation_repository::{
    AiConversationRepository, ConversationSummary, ImportJournalEntry, ListOptions,
    StoredAttempt, StoredConversationRecord, StoredDraft, StoredMessage, StoredTurn,
};
pub use ai_provenance_repository::{AiProvenance, AiProvenanceRepository};
pub use audio_edition_repository::AudioEditionRepository;
pub use concept_repository::{
    canonical_link_fingerprint, normalize_concept_name, Concept, ConceptBacklink, ConceptLink,
    ConceptLinkProposal, ConceptLinkUpdate, ConceptRepository, LinkProposalOutcome,
    LinkUpdateOutcome, NewConceptDraft, CONCEPT_LINK_ENDPOINT_KINDS, CONCEPT_RELATION_TYPES,
    MAX_AI_LINKS_PER_ANALYSIS, MAX_AI_LINKS_PER_DAY, RELATIONSHIP_POLICY_VERSION,
    SYMMETRIC_CONCEPT_RELATIONS,
};
pub use connection::Database;
pub use element_tree_repository::{
    find_node_id_in_tx, find_node_id_pool, register_node_in_tx, unlink_node_in_tx, ElementKind,
    ElementTreeNode, ElementTreeRepository, ELEMENT_TYPE_ITEM, ELEMENT_TYPE_TOPIC,
};
pub use item_activity_repository::{ItemActivityRepository, ACTIVITY_COALESCE_WINDOW_SECONDS};
pub use item_stats_repository::ItemStatsRepository;
pub use neural_queue_repository::{
    NeuralQueueRepository, NeuralQueueRow, ResolvedNeuralQueueEntry,
};
pub use repository::DocumentQueueInfo;
pub use repository::Repository;
pub use saved_queue_repository::SavedQueueRepository;

/// Stored embedding vector for a queue item
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueItemEmbedding {
    pub item_id: String,
    /// Raw embedding vector bytes (f32 little-endian)
    pub embedding: Vec<f32>,
    pub content_hash: String,
    pub provider: String,
    pub model: String,
    pub dimension: i32,
    pub created_at: i64,
}

/// Stored embedding for a document chunk (whole-library RAG).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentChunkEmbedding {
    pub id: String,
    pub document_id: String,
    pub chunk_index: i32,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
    pub content_hash: String,
    pub provider: String,
    pub model: String,
    pub dimension: i32,
    pub created_at: i64,
}
